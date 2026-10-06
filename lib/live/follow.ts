import { query, subscribe } from "../nostr/client.ts"
import type { Filter } from "../nostr/types.ts"
import { KIND_RECORD, KIND_STATE } from "../protocol/kinds.ts"
import type { MatchStateP } from "../protocol/match-state.ts"
import { reduceMatch } from "../protocol/match-state.ts"
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
  // When a relay last answered (ms), for "Stand von 20:14".
  heardAt: number | null
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

export function followMatch(source: MatchSource, onChange: (followed: Followed) => void): { refresh: () => void; close: () => void } {
  const key = source.key ? keyOf(fromHex(source.key)) : null
  const events = new Map<string, SignedEvent>()
  const opened = new Map<string, string | null>()
  let current: Followed = { state: null, problem: null, connection: "connecting", heardAt: null }
  let answeredOnce = false
  let closed = false
  let scheduled = false

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
      const result = reduceMatch([...events.values()], source.match, { open: (event) => opened.get(event.id) ?? null })
      emit(result.state ? { state: result.state, problem: null } : { state: null, problem: answeredOnce ? result.problem : null })
    })
  }

  async function add(event: SignedEvent) {
    if (events.has(event.id)) return
    if (key && event.tags.some((t) => t[0] === "enc")) opened.set(event.id, await openFromMatch(event, await key))
    events.set(event.id, event)
    if (!events.has(source.match)) void check()
    replay()
  }

  const heard = () => emit({ connection: "live", heardAt: Date.now() })

  const sub = subscribe(matchFilters(source.match), source.relays, {
    onevent: (event) => {
      void add(event as SignedEvent)
      heard()
    },
    oneose: ({ answered }) => {
      if (answered.length === 0) return emit({ connection: "interrupted" })
      answeredOnce = true
      heard()
      replay()
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
    answeredOnce = true
    await Promise.all(result.events.map((event) => add(event as SignedEvent)))
    heard()
    replay()
  }

  const timer = setInterval(() => void check(), CHECK_MS)
  const offline = () => emit({ connection: "interrupted" })
  const online = () => void check()
  if (typeof window !== "undefined") {
    window.addEventListener("offline", offline)
    window.addEventListener("online", online)
  }

  return {
    refresh: () => void check(),
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
