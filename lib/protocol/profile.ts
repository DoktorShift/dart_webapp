import type { RecordSpec } from "./common.ts"
import { KIND_STATE } from "./kinds.ts"
import type { Infer } from "./schema.ts"
import { arr, hex, int, nullable, obj, refine } from "./schema.ts"

// The stats card (docs/protocol/families/profile.md): totals a player chose to show in their
// public profile, signed by themselves. Addressable kind 31180 with "d" = "stats", so relays
// keep only the newest. Readers label it "shared by the player": these are the player's own
// figures, backed by no public results unless `refs` names some.
//
// Raw counts only, never averages or rates, so every reader derives figures the same way
// (points per three darts = points / darts × 3) and a card can be checked against its results.
// A card with every mode null shares nothing: that is how a player takes their figures back.

export const STATS_CARD_D = "stats"

const counts = {
  games: int(0, 1_000_000, "Games in these figures, practice included"),
  versus: int(0, 1_000_000, "Games against at least one other player"),
  wins: int(0, 1_000_000, "Games won against others"),
  darts: int(0, 1_000_000_000, "Darts thrown"),
}

const winsWithinGames = (c: { games: number; versus: number; wins: number }) => (c.wins <= c.versus && c.versus <= c.games ? null : "wins ≤ versus ≤ games")

const x01 = refine(
  obj({
    ...counts,
    points: int(0, 2_000_000_000, "Points scored"),
    highestFinish: nullable(int(1, 180, "Highest checkout; null when no leg was won with a known checkout")),
    bestLeg: nullable(int(1, 100_000, "Fewest darts in a leg won")),
    visits180: nullable(int(0, 10_000_000, "Visits of 180; null when no game has its throws")),
  }),
  winsWithinGames,
)

const cricket = refine(obj({ ...counts, marks: int(0, 1_000_000_000, "Marks scored") }), winsWithinGames)

const clock = refine(obj({ ...counts, hits: int(0, 1_000_000_000, "Targets hit") }), winsWithinGames)

const statsCard = obj({
  x01: nullable(x01),
  cricket: nullable(cricket),
  clock: nullable(clock),
  refs: arr(hex(32, "match.result record id"), { max: 100, unique: true, description: "Public match results these figures include" }),
})
export type StatsCard = Infer<typeof statsCard>

export const PROFILE_TYPES = {
  "profile.stats": { kind: KIND_STATE, root: "self", d: true, encryption: "none", schema: statsCard, description: "Stats card a player shows in their public profile" },
} satisfies Record<string, RecordSpec>

export const EMPTY_STATS_CARD: StatsCard = { x01: null, cricket: null, clock: null, refs: [] }

export const sharesNothing = (card: StatsCard) => card.x01 === null && card.cricket === null && card.clock === null
