// Talking to relays (docs/decisions/0002, section 5). Built on nostr-core's Relay, with what the
// app needs on top (nostr-core gaps NC-10 in docs/implementation/evidence/P0.03/CORE.md):
//
// - publish() reports every relay's answer with its machine-readable reason, never throws for a
//   relay that refused or was unreachable, and leaves no unhandled rejection behind.
// - query() waits for each relay's real EOSE (nostr-core fakes one after a timeout) and says
//   which relays answered. "No relay answered" is unknown, never empty.
// - subscribe() keeps live subscriptions per relay under the public relays' limits by merging
//   filters, survives reconnects and retries relays that were down at the start.
// - NIP-42: a relay that answers "auth-required:" gets one AUTH signed by the configured Signer,
//   then the request is repeated once. No AUTH is sent unless a relay asks for it.
import type { Filter as CoreFilter, Relay, Subscription } from "nostr-core"
import { loadCore, type Core } from "./core.ts"
import { normalizeRelayUrl } from "./relays.ts"
import { nowSeconds } from "./time.ts"
import type { Filter, NostrEvent, Signer } from "./types.ts"

// Machine-readable prefixes relays put in OK and CLOSED messages (NIP-01).
const RELAY_PREFIXES = ["duplicate", "pow", "blocked", "rate-limited", "invalid", "restricted", "mute", "error", "auth-required"] as const
export type RelayPrefix = (typeof RELAY_PREFIXES)[number]
// The prefix, or a local code: "timeout" (no answer in time), "unreachable" (no connection, or it
// broke), "" (the relay gave no machine-readable reason).
export type RelayCode = RelayPrefix | "timeout" | "unreachable" | ""

export interface PublishResult {
  url: string
  // OK true from the relay, including "duplicate:" (it already has the event).
  ok: boolean
  code: RelayCode
  reason: string
}

export interface RelayFailure {
  url: string
  code: RelayCode
  reason: string
}

export interface QueryResult {
  // Deduplicated by id; for replaceable and addressable kinds only the newest per coordinate.
  // Newest first.
  events: NostrEvent[]
  // Relays that sent EOSE: their part of the answer is complete.
  answered: string[]
  failed: RelayFailure[]
  // Every relay answered. With answered empty, the result is unknown, not empty.
  complete: boolean
}

export interface QueryOptions {
  timeoutMs?: number
  // Signs NIP-42 AUTH for this call instead of the client's auth signer; null never authenticates.
  auth?: Signer | null
}

export interface PublishOptions {
  auth?: Signer | null
}

export interface SubscribeHandlers {
  // Each event once per subscription, whichever relay delivers it first.
  onevent: (event: NostrEvent, url: string) => void
  // Once, when every relay sent EOSE, failed, or the EOSE wait ran out.
  oneose?: (status: { answered: string[]; failed: RelayFailure[] }) => void
  // A relay ended the subscription for good (for example "invalid:" or "blocked:").
  onclose?: (url: string, reason: string) => void
}

export interface SubscribeOptions {
  eoseTimeoutMs?: number
}

export interface Closer {
  close: () => void
}

export interface RelayClient {
  publish(event: NostrEvent, relays: readonly string[], options?: PublishOptions): Promise<PublishResult[]>
  query(filters: Filter[], relays: readonly string[], options?: QueryOptions): Promise<QueryResult>
  subscribe(filters: Filter[], relays: readonly string[], handlers: SubscribeHandlers, options?: SubscribeOptions): Closer
  // The Signer that answers NIP-42 challenges; null disables AUTH.
  setAuthSigner(signer: Signer | null): void
  // Closes every connection and subscription.
  close(): void
}

export interface RelayClientOptions {
  connectTimeoutMs?: number
  publishTimeoutMs?: number
  queryTimeoutMs?: number
  // REQs open at once per relay. nos.lol and Primal allow 20 per connection; 15 leaves room.
  maxSubscriptionsPerRelay?: number
  // An unused connection closes after this long.
  idleCloseMs?: number
  websocket?: typeof WebSocket
}

const DEFAULTS = {
  connectTimeoutMs: 6000,
  publishTimeoutMs: 10_000,
  queryTimeoutMs: 8000,
  maxSubscriptionsPerRelay: 15,
  idleCloseMs: 60_000,
}

// Part of every relay's subscription budget stays free for one-off queries; live subscriptions
// beyond the rest are merged.
const QUERY_RESERVE = 5
const MAX_RETRY_DELAY_MS = 60_000
// nostr-core fires a fake EOSE after Relay.eoseTimeout. Set far beyond any wait of ours, so an
// EOSE we see is the relay's own. (setTimeout caps delays at 2^31 - 1 ms.)
const NO_FAKE_EOSE_MS = 2_000_000_000
// How long an AUTH waits for the relay's challenge when it asked for AUTH before sending one.
const CHALLENGE_WAIT_MS = 3000
// Remembered event ids per live subscription, for deduplication across relays and replays.
const SEEN_LIMIT = 5000

// Splits a relay message into its machine-readable prefix and the full text.
export function parseRelayMessage(message: string): { code: RelayPrefix | ""; reason: string } {
  const match = /^([a-z-]+):/.exec(message)
  const prefix = match?.[1]
  const code = RELAY_PREFIXES.find((p) => p === prefix) ?? ""
  return { code, reason: message }
}

// Errors from nostr-core's Relay are either the relay's own words or local conditions.
function classify(message: string): { code: RelayCode; reason: string } {
  if (message === "publish timed out" || message === "auth timed out") return { code: "timeout", reason: message }
  if (/^(relay connection closed|giving up reconnecting|not connected|connection (failed|timed out))/.test(message)) return { code: "unreachable", reason: message }
  return parseRelayMessage(message)
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const unrefTimer = <T>(timer: T): T => {
  ;(timer as { unref?: () => void }).unref?.()
  return timer
}

export const isReplaceableKind = (kind: number) => kind === 0 || kind === 3 || (kind >= 10_000 && kind < 20_000)
export const isAddressableKind = (kind: number) => kind >= 30_000 && kind < 40_000

// The key under which relays keep only the newest version, or null for regular events.
export function coordinateOf(event: Pick<NostrEvent, "kind" | "pubkey" | "tags">): string | null {
  if (isReplaceableKind(event.kind)) return `${event.kind}:${event.pubkey}:`
  if (isAddressableKind(event.kind)) return `${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === "d")?.[1] ?? ""}`
  return null
}

// NIP-01: the newer created_at wins; on a tie, the lowest id. Whether `a` replaces `b` on relays.
export const supersedes = (a: NostrEvent, b: NostrEvent) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id)

// Deduplicates by id and keeps only the newest event per replaceable or addressable coordinate.
export function latestEvents(events: Iterable<NostrEvent>): NostrEvent[] {
  const kept = new Map<string, NostrEvent>()
  for (const event of events) {
    const key = coordinateOf(event) ?? event.id
    const current = kept.get(key)
    if (!current || supersedes(event, current)) kept.set(key, event)
  }
  return [...kept.values()].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

interface Connection {
  url: string
  relay: Relay
  challenge: string | null
  challengeWaiters: Set<(challenge: string) => void>
  authing: Promise<boolean> | null
  slots: Slot[]
  queries: number
  queryQueue: (() => void)[]
  users: number
  idleTimer: ReturnType<typeof setTimeout> | null
}

// One REQ on one relay, shared by one or more live subscriptions.
interface Slot {
  conn: Connection
  members: Set<Live>
  sub: Subscription | null
  generation: number
  attempts: number
  authTried: boolean
  retryTimer: ReturnType<typeof setTimeout> | null
}

// One subscribe() call.
interface Live {
  filters: Filter[]
  handlers: SubscribeHandlers
  seen: Set<string>
  pending: Set<string>
  answered: string[]
  failed: RelayFailure[]
  eoseSent: boolean
  eoseTimer: ReturnType<typeof setTimeout> | null
  closed: boolean
  urls: string[]
}

export function createRelayClient(options: RelayClientOptions = {}): RelayClient {
  const settings = { ...DEFAULTS, ...options }
  const liveLimit = Math.max(1, settings.maxSubscriptionsPerRelay - QUERY_RESERVE)
  const connections = new Map<string, Connection>()
  const inflight = new Map<string, Promise<PublishResult>>()
  const lives = new Set<Live>()
  let authSigner: Signer | null = null
  let core: Core | null = null
  let closed = false

  async function getCore() {
    core ??= await loadCore()
    return core
  }

  // --- connections -------------------------------------------------------------------------

  async function connection(url: string): Promise<Connection> {
    const existing = connections.get(url)
    if (existing) {
      claim(existing)
      return existing
    }
    const { Relay } = await getCore()
    // Another caller may have created it while the library loaded.
    const raced = connections.get(url)
    if (raced) {
      claim(raced)
      return raced
    }
    const relay = new Relay(url, { websocketImplementation: settings.websocket, reconnect: { maxDelay: 30_000 } })
    relay.eoseTimeout = NO_FAKE_EOSE_MS
    relay.publishTimeout = settings.publishTimeoutMs
    const conn: Connection = {
      url,
      relay,
      challenge: null,
      challengeWaiters: new Set(),
      authing: null,
      slots: [],
      queries: 0,
      queryQueue: [],
      users: 0,
      idleTimer: null,
    }
    relay.onauth = (challenge) => {
      conn.challenge = challenge
      for (const waiter of conn.challengeWaiters) waiter(challenge)
      conn.challengeWaiters.clear()
    }
    // A new connection gets a new challenge; the old one is worthless.
    relay.ondisconnect = () => {
      conn.challenge = null
    }
    // nostr-core replays open REQs after a reconnect; a relay that wants AUTH again gets it.
    relay.onreconnect = () => {
      for (const slot of conn.slots) slot.authTried = false
    }
    connections.set(url, conn)
    claim(conn)
    return conn
  }

  function claim(conn: Connection) {
    conn.users++
    if (conn.idleTimer) clearTimeout(conn.idleTimer)
    conn.idleTimer = null
  }

  function release(conn: Connection) {
    conn.users = Math.max(0, conn.users - 1)
    if (conn.users > 0 || conn.slots.length > 0 || closed) return
    conn.idleTimer = unrefTimer(
      setTimeout(() => {
        if (conn.users > 0 || conn.slots.length > 0) return
        connections.delete(conn.url)
        conn.relay.close()
      }, settings.idleCloseMs),
    )
  }

  async function open(conn: Connection, timeoutMs = settings.connectTimeoutMs) {
    if (conn.relay.connected) return
    await conn.relay.connect({ timeout: Math.max(1, timeoutMs) })
  }

  // --- NIP-42 --------------------------------------------------------------------------------

  function waitForChallenge(conn: Connection): Promise<string | null> {
    if (conn.challenge) return Promise.resolve(conn.challenge)
    return new Promise((resolve) => {
      const timer = unrefTimer(setTimeout(() => {
        conn.challengeWaiters.delete(waiter)
        resolve(null)
      }, CHALLENGE_WAIT_MS))
      const waiter = (challenge: string) => {
        clearTimeout(timer)
        resolve(challenge)
      }
      conn.challengeWaiters.add(waiter)
    })
  }

  // Answers the relay's challenge once; concurrent callers share the attempt.
  function authenticate(conn: Connection, explicit: Signer | null | undefined): Promise<boolean> {
    const signer = explicit === undefined ? authSigner : explicit
    if (!signer) return Promise.resolve(false)
    conn.authing ??= (async () => {
      try {
        const challenge = await waitForChallenge(conn)
        if (!challenge) return false
        const { createAuthEventTemplate } = await getCore()
        const event = await signer.signEvent({ ...createAuthEventTemplate({ relay: conn.relay.url, challenge }), created_at: nowSeconds() })
        // nostr-core's Relay.auth leaves a dangling timer that rejects unobserved when the socket
        // is already gone, so only send on a live connection.
        if (!conn.relay.connected) return false
        await conn.relay.auth(event)
        return true
      } catch {
        return false
      } finally {
        conn.authing = null
      }
    })()
    return conn.authing
  }

  // --- publish -------------------------------------------------------------------------------

  async function sendEvent(conn: Connection, event: NostrEvent): Promise<PublishResult> {
    // Same dangling-timer problem as auth: Relay.publish on a closed socket throws after arming
    // a timeout whose rejection nobody would observe.
    if (!conn.relay.connected) return { url: conn.url, ok: false, code: "unreachable", reason: "not connected" }
    try {
      const message = await conn.relay.publish(event)
      return { url: conn.url, ok: true, ...parseRelayMessage(message ?? "") }
    } catch (error) {
      return { url: conn.url, ok: false, ...classify(errorText(error)) }
    }
  }

  function publishTo(url: string, event: NostrEvent, auth: Signer | null | undefined): Promise<PublishResult> {
    // nostr-core tracks open publishes by event id per relay; sending the same event twice at
    // once would orphan the first promise. Share it instead.
    const key = `${url} ${event.id}`
    const running = inflight.get(key)
    if (running) return running
    const attempt = (async (): Promise<PublishResult> => {
      const conn = await connection(url)
      try {
        try {
          await open(conn)
        } catch (error) {
          return { url, ok: false, code: "unreachable", reason: errorText(error) }
        }
        let result = await sendEvent(conn, event)
        if (result.code === "auth-required" && (await authenticate(conn, auth))) result = await sendEvent(conn, event)
        return result
      } finally {
        release(conn)
      }
    })()
    inflight.set(key, attempt)
    void attempt.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    )
    return attempt
  }

  async function publish(event: NostrEvent, relays: readonly string[], publishOptions: PublishOptions = {}): Promise<PublishResult[]> {
    await getCore()
    const { valid, invalid } = splitUrls(relays)
    const results = await Promise.all(valid.map((url) => publishTo(url, event, publishOptions.auth)))
    return [...results, ...invalid.map((url): PublishResult => ({ url, ok: false, code: "unreachable", reason: "invalid relay address" }))]
  }

  // --- query ---------------------------------------------------------------------------------

  // Waits for a free subscription on this relay; live subscriptions keep their share.
  function acquireQuery(conn: Connection): Promise<void> {
    if (conn.queries < settings.maxSubscriptionsPerRelay - conn.slots.length) {
      conn.queries++
      return Promise.resolve()
    }
    return new Promise((resolve) =>
      conn.queryQueue.push(() => {
        conn.queries++
        resolve()
      }),
    )
  }

  function releaseQuery(conn: Connection) {
    conn.queries--
    if (conn.queries < settings.maxSubscriptionsPerRelay - conn.slots.length) conn.queryQueue.shift()?.()
  }

  type Outcome = { url: string; answered: true } | ({ answered: false } & RelayFailure)

  async function queryOne(url: string, filters: Filter[], deadline: number, auth: Signer | null | undefined, onevent: (event: NostrEvent) => void): Promise<Outcome> {
    const conn = await connection(url)
    let acquired = false
    let done = false
    let sub: Subscription | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<Outcome>((resolve) => {
        const finish = (outcome: Outcome) => {
          if (done) return
          done = true
          clearTimeout(timer)
          const open = sub
          sub = null
          open?.close()
          resolve(outcome)
        }
        const fail = (code: RelayCode, reason: string) => finish({ url, answered: false, code, reason })
        timer = unrefTimer(setTimeout(() => fail("timeout", "no answer in time"), Math.max(0, deadline - Date.now())))

        let authTried = false
        const request = () => {
          if (done) return
          try {
            const current = conn.relay.subscribe(filters as CoreFilter[], {
              onevent: (event) => {
                if (!done) onevent(event)
              },
              oneose: () => finish({ url, answered: true }),
              onclose: (message) => {
                if (done || sub !== current) return
                sub = null
                const { code, reason } = classify(message)
                if (code === "auth-required" && !authTried) {
                  authTried = true
                  void authenticate(conn, auth).then((ok) => (ok ? request() : fail(code, reason)))
                } else fail(code, reason)
              },
            })
            sub = current
          } catch (error) {
            fail("unreachable", errorText(error))
          }
        }

        void (async () => {
          await acquireQuery(conn)
          // Timed out while waiting for a free subscription: give it straight back.
          if (done) return releaseQuery(conn)
          acquired = true
          try {
            await open(conn, Math.min(settings.connectTimeoutMs, deadline - Date.now()))
          } catch (error) {
            return fail("unreachable", errorText(error))
          }
          request()
        })()
      })
    } finally {
      if (acquired) releaseQuery(conn)
      release(conn)
    }
  }

  async function query(filters: Filter[], relays: readonly string[], queryOptions: QueryOptions = {}): Promise<QueryResult> {
    await getCore()
    const deadline = Date.now() + (queryOptions.timeoutMs ?? settings.queryTimeoutMs)
    const { valid, invalid } = splitUrls(relays)
    const byId = new Map<string, NostrEvent>()
    const outcomes = await Promise.all(
      valid.map((url) =>
        queryOne(url, filters, deadline, queryOptions.auth, (event) => {
          if (!byId.has(event.id)) byId.set(event.id, event)
        }),
      ),
    )
    const answered: string[] = []
    const failed: RelayFailure[] = invalid.map((url) => ({ url, code: "unreachable", reason: "invalid relay address" }))
    for (const outcome of outcomes) {
      if (outcome.answered) answered.push(outcome.url)
      else failed.push({ url: outcome.url, code: outcome.code, reason: outcome.reason })
    }
    return { events: latestEvents(byId.values()), answered, failed, complete: answered.length > 0 && failed.length === 0 }
  }

  // --- live subscriptions --------------------------------------------------------------------

  function deliver(live: Live, event: NostrEvent, url: string) {
    if (live.closed || live.seen.has(event.id) || !core?.matchFilters(live.filters as CoreFilter[], event)) return
    live.seen.add(event.id)
    if (live.seen.size > SEEN_LIMIT) live.seen.delete(live.seen.values().next().value as string)
    live.handlers.onevent(event, url)
  }

  function settle(live: Live, url: string, failure?: RelayFailure) {
    if (!live.pending.delete(url)) return
    if (failure) live.failed.push(failure)
    else live.answered.push(url)
    if (live.pending.size === 0) sendEose(live)
  }

  function sendEose(live: Live) {
    if (live.eoseSent || live.closed) return
    live.eoseSent = true
    if (live.eoseTimer) clearTimeout(live.eoseTimer)
    live.handlers.oneose?.({ answered: [...live.answered], failed: [...live.failed] })
  }

  function scheduleRetry(slot: Slot, failure: RelayFailure) {
    for (const live of slot.members) settle(live, slot.conn.url, failure)
    if (slot.retryTimer || closed) return
    const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** slot.attempts) * (0.7 + Math.random() * 0.6)
    slot.attempts++
    slot.retryTimer = unrefTimer(
      setTimeout(() => {
        slot.retryTimer = null
        void fire(slot)
      }, delay),
    )
  }

  function dropSlot(slot: Slot) {
    const conn = slot.conn
    conn.slots = conn.slots.filter((s) => s !== slot)
    if (slot.retryTimer) clearTimeout(slot.retryTimer)
    slot.retryTimer = null
    slot.generation++
    const open = slot.sub
    slot.sub = null
    open?.close()
    // A freed subscription may let a waiting query run.
    if (conn.queries < settings.maxSubscriptionsPerRelay - conn.slots.length) conn.queryQueue.shift()?.()
  }

  function slotClosed(slot: Slot, message: string) {
    const { code, reason } = classify(message)
    const url = slot.conn.url
    if (code === "auth-required" && !slot.authTried) {
      slot.authTried = true
      void authenticate(slot.conn, undefined).then((ok) => (ok ? fire(slot) : slotClosed(slot, message)))
      return
    }
    if (code === "unreachable" || code === "rate-limited") {
      scheduleRetry(slot, { url, code, reason })
      return
    }
    // The relay refuses these filters for good: tell the subscribers, stop asking.
    const members = [...slot.members]
    dropSlot(slot)
    for (const live of members) {
      settle(live, url, { url, code, reason })
      if (!live.closed) live.handlers.onclose?.(url, message)
    }
  }

  async function fire(slot: Slot) {
    const generation = ++slot.generation
    const previous = slot.sub
    slot.sub = null
    previous?.close()
    if (slot.members.size === 0 || closed) return
    try {
      await open(slot.conn)
    } catch (error) {
      if (generation === slot.generation) scheduleRetry(slot, { url: slot.conn.url, code: "unreachable", reason: errorText(error) })
      return
    }
    if (generation !== slot.generation || slot.members.size === 0) return
    // One REQ with every member's filters; identical filters only once.
    const filters = [...new Map([...slot.members].flatMap((live) => live.filters).map((filter) => [JSON.stringify(filter), filter])).values()]
    try {
      slot.sub = slot.conn.relay.subscribe(filters as CoreFilter[], {
        onevent: (event) => {
          for (const live of slot.members) deliver(live, event, slot.conn.url)
        },
        oneose: () => {
          if (generation !== slot.generation) return
          slot.attempts = 0
          for (const live of slot.members) settle(live, slot.conn.url)
        },
        onclose: (message) => {
          if (generation !== slot.generation) return
          slot.sub = null
          slotClosed(slot, message)
        },
      })
    } catch (error) {
      scheduleRetry(slot, { url: slot.conn.url, code: "unreachable", reason: errorText(error) })
    }
  }

  async function attach(live: Live, url: string) {
    const conn = await connection(url)
    if (live.closed || closed) return release(conn)
    let slot: Slot
    if (conn.slots.length < liveLimit) {
      slot = { conn, members: new Set(), sub: null, generation: 0, attempts: 0, authTried: false, retryTimer: null }
      conn.slots.push(slot)
    } else {
      slot = conn.slots.reduce((a, b) => (b.members.size < a.members.size ? b : a))
    }
    slot.members.add(live)
    await fire(slot)
  }

  function detach(live: Live) {
    for (const url of live.urls) {
      const conn = connections.get(url)
      if (!conn) continue
      for (const slot of conn.slots) {
        if (!slot.members.delete(live)) continue
        if (slot.members.size === 0) dropSlot(slot)
        release(conn)
      }
    }
  }

  function subscribe(filters: Filter[], relays: readonly string[], handlers: SubscribeHandlers, subscribeOptions: SubscribeOptions = {}): Closer {
    const { valid, invalid } = splitUrls(relays)
    const live: Live = {
      filters,
      handlers,
      seen: new Set(),
      pending: new Set(valid),
      answered: [],
      failed: invalid.map((url) => ({ url, code: "unreachable", reason: "invalid relay address" })),
      eoseSent: false,
      eoseTimer: null,
      closed: false,
      urls: valid,
    }
    lives.add(live)
    live.eoseTimer = unrefTimer(
      setTimeout(() => {
        for (const url of [...live.pending]) settle(live, url, { url, code: "timeout", reason: "no answer in time" })
      }, subscribeOptions.eoseTimeoutMs ?? settings.queryTimeoutMs),
    )
    if (valid.length === 0) queueMicrotask(() => sendEose(live))
    void getCore()
      .then(() => Promise.all(valid.map((url) => attach(live, url))))
      .catch((error: unknown) => {
        for (const url of [...live.pending]) settle(live, url, { url, code: "unreachable", reason: errorText(error) })
      })
    return {
      close: () => {
        if (live.closed) return
        live.closed = true
        if (live.eoseTimer) clearTimeout(live.eoseTimer)
        lives.delete(live)
        detach(live)
      },
    }
  }

  return {
    publish,
    query,
    subscribe,
    setAuthSigner(signer) {
      authSigner = signer
    },
    close() {
      closed = true
      for (const live of lives) {
        live.closed = true
        if (live.eoseTimer) clearTimeout(live.eoseTimer)
      }
      lives.clear()
      for (const conn of connections.values()) {
        for (const slot of [...conn.slots]) dropSlot(slot)
        if (conn.idleTimer) clearTimeout(conn.idleTimer)
        conn.queryQueue.length = 0
        conn.relay.close()
      }
      connections.clear()
    },
  }
}

// Normalized, deduplicated relay URLs; unusable entries are reported, not silently dropped.
function splitUrls(relays: readonly string[]) {
  const valid: string[] = []
  const invalid: string[] = []
  for (const relay of relays) {
    const url = normalizeRelayUrl(relay)
    if (!url) invalid.push(relay)
    else if (!valid.includes(url)) valid.push(url)
  }
  return { valid, invalid }
}

// --- the app's shared client ----------------------------------------------------------------

let shared: RelayClient | null = null

export function relayClient(): RelayClient {
  shared ??= createRelayClient()
  return shared
}

export const publish: RelayClient["publish"] = (...args) => relayClient().publish(...args)
export const query: RelayClient["query"] = (...args) => relayClient().query(...args)
export const subscribe: RelayClient["subscribe"] = (...args) => relayClient().subscribe(...args)
export const setAuthSigner: RelayClient["setAuthSigner"] = (signer) => relayClient().setAuthSigner(signer)

// --- time -----------------------------------------------------------------------------------

// The skew-corrected clock lives in ./time.ts (no dependencies); re-exported for convenience.
export { adjustClock, clockOffset, createdAt, nowSeconds, syncClock } from "./time.ts"
