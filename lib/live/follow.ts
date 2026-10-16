import { query, subscribe } from "../nostr/client.ts"
import { syncClock } from "../nostr/time.ts"
import type { Filter } from "../nostr/types.ts"
import { KIND_RECORD, KIND_STATE } from "../protocol/kinds.ts"
import type { Agreement } from "../protocol/match.ts"
import type { MatchStateP } from "../protocol/match-state.ts"
import { reduceMatch } from "../protocol/match-state.ts"
import { parseRecord } from "../protocol/records.ts"
import type { FoundingProblem } from "../protocol/replay.ts"
import type { SignedEvent } from "../protocol/tags.ts"
import { fromHex, keyOf, openFromMatch } from "./keys.ts"

// Following a match from the relays: what a spectator, a seated player and the board itself
// read. Everything of the match arrives on one subscription (founding, sessions, seats, results,
// verdicts and the live snapshot) and is replayed by reduceMatch (lib/protocol), decrypted with
// the match key of a private match. Relays that stay silent are a broken connection, never an
// empty match: a light query every CHECK_MS tells which relays still answer.

export type Connection = "connecting" | "live" | "interrupted"

export interface Followed {
  // null until the founding is known.
  state: MatchStateP | null
  // Why there is no state although relays answered: "missing" (no such match there) and the like.
  problem: FoundingProblem | null
  connection: Connection
  // When a relay last answered (ms), for "zuletzt aktualisiert 20:14".
  heardAt: number | null
  // The relays that answer have sent what they had (their first EOSE): a seat or a result that
  // is not in `state` now is not merely on its way.
  settled: boolean
}

export interface MatchSource {
  match: string
  // The match key of a private match, hex.
  key: string | null
  relays: readonly string[]
}

const CHECK_MS = 15_000

export const matchFilters = (match: string): Filter[] => [
  { ids: [match] },
  { kinds: [KIND_RECORD], "#e": [match] },
  { kinds: [KIND_STATE], "#d": [match] },
]

// What arrived of the match, decrypted with its key where sealed, and the state it replays to.
function collect(source: MatchSource) {
  const key = source.key ? keyOf(fromHex(source.key)) : null
  const events = new Map<string, SignedEvent>()
  const opened = new Map<string, string | null>()
  return {
    has: (id: string) => events.has(id),
    // False for an event that was in already.
    async take(event: SignedEvent) {
      if (events.has(event.id)) return false
      if (key && event.tags.some((t) => t[0] === "enc")) opened.set(event.id, await openFromMatch(event, await key))
      events.set(event.id, event)
      return true
    },
    reduce: () => reduceMatch([...events.values()], source.match, { open: (event) => opened.get(event.id) ?? null }),
  }
}

// The match as the relays have it now, asked once: enough to notice a correction of a result
// this phone confirmed, without following the match for the rest of the day. Null when no
// relay answered or the match is not there.
export async function readMatch(source: MatchSource): Promise<MatchStateP | null> {
  const result = await query(matchFilters(source.match), source.relays).catch(() => null)
  if (!result || result.answered.length === 0) return null
  const events = collect(source)
  for (const event of result.events) await events.take(event as SignedEvent)
  return events.reduce().state
}

export function followMatch(source: MatchSource, onChange: (followed: Followed) => void): { close: () => void } {
  const events = collect(source)
  let current: Followed = { state: null, problem: null, connection: "connecting", heardAt: null, settled: false }
  let closed = false
  let scheduled = false
  // Events are taken in one line, decryption included, so an EOSE counts only once everything
  // that came before it is in.
  let taking: Promise<void> = Promise.resolve()

  const emit = (next: Partial<Followed>) => {
    current = { ...current, ...next }
    if (!closed) onChange(current)
  }

  // Bursts of events (the first load, a reconnect) are replayed once.
  const replay = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      const result = events.reduce()
      emit(result.state ? { state: result.state, problem: null } : { state: null, problem: current.settled ? result.problem : null })
    })
  }
  // Records are read against the app's clock (one further than 15 minutes ahead waits): set it by
  // the app's server, as the board that signs them did, so a device whose clock runs behind still
  // sees the match, and read again once it is set.
  void syncClock().then((set) => set && replay())

  const add = (event: SignedEvent) => (taking = taking.then(() => take(event)).catch(() => {}))

  async function take(event: SignedEvent) {
    if (!(await events.take(event))) return
    if (!events.has(source.match)) void check()
    replay()
  }

  const heard = () => emit({ connection: "live", heardAt: Date.now() })
  // The relays have sent what they had: from now on, what is missing is missing there.
  const settle = () =>
    void taking.then(() => {
      emit({ connection: "live", heardAt: Date.now(), settled: true })
      replay()
    })

  const sub = subscribe(matchFilters(source.match), source.relays, {
    onevent: (event) => {
      add(event as SignedEvent)
      heard()
    },
    oneose: ({ answered }) => {
      if (answered.length === 0) return emit({ connection: "interrupted" })
      settle()
    },
  })

  // Some relays send new events only for tag and kind filters, not for an id: the founding,
  // which has no tag naming the match, comes by asking again as soon as the match shows signs
  // of life without it (and every CHECK_MS anyway). One question at a time.
  let checking: Promise<void> | null = null
  const check = () => (checking ??= ask().finally(() => (checking = null)))

  async function ask() {
    const result = await query(matchFilters(source.match), source.relays).catch(() => null)
    if (closed) return
    if (!result || result.answered.length === 0) return emit({ connection: "interrupted" })
    for (const event of result.events) add(event as SignedEvent)
    settle()
  }

  const timer = setInterval(() => void check(), CHECK_MS)
  const offline = () => emit({ connection: "interrupted" })
  const online = () => void check()
  if (typeof window !== "undefined") {
    window.addEventListener("offline", offline)
    window.addEventListener("online", online)
  }

  return {
    close() {
      closed = true
      clearInterval(timer)
      sub.close()
      if (typeof window !== "undefined") {
        window.removeEventListener("offline", offline)
        window.removeEventListener("online", online)
      }
    },
  }
}

// A public match founded by one of `authors`: a tournament's board (lib/tournaments) founds the
// matches it scores under the key the organizer authorized, so the tournament finds them by
// those keys alone, with no record of its own for "this slot is being played". The agreement
// names the tournament and the slot.
export interface Founding {
  match: string
  by: string
  at: number
  agreement: Agreement
}

// Follows the foundings of public matches by `authors` (what relays have, then new ones), e.g.
// a tournament's boards; a founding that isn't a readable sv 1 session is left out.
export function watchFoundings(source: { authors: readonly string[]; relays: readonly string[] }, onFounding: (founding: Founding) => void): { close: () => void } {
  const seen = new Set<string>()
  const take = (event: unknown) => {
    const parsed = parseRecord(event)
    if (parsed.status !== "ok" || parsed.record.type !== "match.session" || seen.has(parsed.record.id)) return
    const { content } = parsed.record
    if (content.sv !== 1 || !content.agreement) return
    seen.add(parsed.record.id)
    onFounding({ match: parsed.record.id, by: parsed.record.pubkey, at: parsed.record.created_at, agreement: content.agreement })
  }
  if (source.authors.length === 0) return { close() {} }
  return subscribe([{ kinds: [KIND_RECORD], authors: [...source.authors], "#l": ["match.session"] }], source.relays, { onevent: take })
}
