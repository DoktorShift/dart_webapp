import { assembleChunks } from "../protocol/chunks.ts"
import type { Agreement } from "../protocol/match.ts"
import type { MatchStateP } from "../protocol/match-state.ts"
import { archiveFinished, unarchive } from "../storage/archive.ts"
import { kvGet, kvSet } from "../storage/db.ts"
import { withLock } from "../storage/lock.ts"
import { listPlayers } from "../storage/players.ts"
import { resultGame } from "./content.ts"

// A player's own copy of a game scored on another device (PLAN.md "Gemeinsam bestätigte
// Resultate … persönliche Kopien"): a live result they confirmed at the board (join.ts), a club
// result they confirmed (lib/clubs), a tournament match of theirs the organizer approved
// (lib/tournaments). The copy is the game replayed from the result's throws, kept in this
// device's archive under the id of the match it comes from, so it stays one game however often
// it is kept and on however many of the profile's devices; lib/sync carries it like every game
// of the profile. It follows the record it rests on: a correction or a withdrawal takes it out
// again, until there is a record to rest on again.

// The game a copy is made of: the match's agreement, the result's throws and end, and the
// player's seat with the profile they played under (null: a guest at a board).
export interface Played {
  agreement: Agreement
  throws: string
  finishedAt: number
  seat: number
  profile: string | null
}

// What the copy of a match should rest on now: the record (the confirmed result, the approval;
// null: no copy), and the game, asked for only when a copy is to be made; null while it can't be
// read yet, and the copy stays as it is until the next time.
export interface Wanted {
  match: string
  record: string | null
  played: () => Played | null | Promise<Played | null>
}

// The current result of a match as the game of the player in `seat`; null without a result, or
// while pieces of its throw log are missing.
export function resultPlayed(state: MatchStateP, seat: number, profile: string | null): Played | null {
  const result = state.result
  if (!result) return null
  let throws = result.throws ?? null
  if (throws === null && result.log) {
    try {
      throws = assembleChunks(state.logs[result.log.head] ?? [], { head: result.log.head, total: result.log.total, bytes: result.log.bytes })
    } catch {
      return null
    }
  }
  return throws === null ? null : { agreement: state.agreement, throws, finishedAt: result.finishedAt, seat, profile }
}

// Brings the copy of `wanted.match` in line with what it should rest on, from the record it rests
// on now (`kept`, null: there is none); resolves with the record it rests on afterwards.
export async function keepCopy(kept: string | null, wanted: Wanted): Promise<string | null> {
  if (wanted.record === kept) return kept
  const played = wanted.record ? await wanted.played() : null
  if (wanted.record && !played) return kept
  if (kept) await unarchive(wanted.match)
  if (played) await archiveFinished(resultGame(played.agreement, played, { id: wanted.match, own: await ownSeat(played) }), undefined, new Date(played.finishedAt * 1000))
  return wanted.record
}

// The records the copies of a profile's club and tournament games rest on, by match ("kv"
// copies:<profile>). A live seat keeps its own with the seat (join.ts).
const copiesKey = (profile: string) => `copies:${profile}`

// Brings the copies of these matches in line, one change after another in every tab. Matches
// not named keep their copies as they are.
export function keepCopies(profile: string, wanted: readonly Wanted[]): Promise<void> {
  return withLock(copiesKey(profile), async () => {
    const kept = (await kvGet<Record<string, string>>(copiesKey(profile))) ?? {}
    const next = { ...kept }
    for (const w of wanted) {
      const record = await keepCopy(kept[w.match] ?? null, w)
      if (record) next[w.match] = record
      else delete next[w.match]
    }
    if (wanted.some((w) => next[w.match] !== kept[w.match])) await kvSet(copiesKey(profile), next)
  })
}

// The player in their seat: the directory's player linked to the profile, else the seat's name.
async function ownSeat({ agreement, seat, profile }: Played) {
  const alias = agreement.seats[seat]?.alias ?? `${seat + 1}`
  const linked = profile ? (await listPlayers().catch(() => [])).find((p) => p.pubkey === profile) : undefined
  return { seat, id: linked?.id ?? `seat${seat}`, name: linked?.name ?? alias }
}
