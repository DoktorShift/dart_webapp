import { bracketOrder, nextPowerOfTwo } from "./draw.ts"
import type { Bracket, MatchSpec, SlotSource } from "./types.ts"

// The fixed match plan of each format, built once at the draw. Brackets are laid out at full
// power-of-two size first; byes (seeds above the field) are then taken out, so a seed with a bye
// starts directly in the round after — no match is ever shown for a bye. Rules in plain German:
// docs/implementation/evidence/P6.01/ENGINE.md.

// A slot while building: null is a bye, known at the draw.
type Source = SlotSource | null

interface Draft {
  id: string
  bracket: Bracket
  group: string | null
  round: number
  index: number
  slots: [Source, Source]
  final: boolean
  reset: boolean
}

const seedSource = (seed: number): SlotSource => ({ type: "seed", seed })
const winnerOf = (match: string): SlotSource => ({ type: "winner", match })
const loserOf = (match: string): SlotSource => ({ type: "loser", match })
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

const draft = (id: string, bracket: Bracket, round: number, index: number, slots: [Source, Source], group: string | null = null): Draft => ({
  id,
  bracket,
  group,
  round,
  index,
  slots,
  final: false,
  reset: false,
})

// A knockout bracket for entrants in seed order, as rounds. Match ids are prefix + round + "-" +
// position ("K2-1"). Round 1 pairs the bracket positions 2i and 2i+1 of the standard order.
function eliminationRounds(entrants: SlotSource[], prefix: string, bracket: Bracket): Draft[][] {
  const size = nextPowerOfTwo(entrants.length)
  const order = bracketOrder(size)
  const at = (seed: number): Source => (seed <= entrants.length ? entrants[seed - 1] : null)
  const rounds: Draft[][] = []
  for (let r = 1, count = size / 2; count >= 1; r++, count /= 2) {
    rounds.push(
      range(count).map((i) =>
        draft(
          `${prefix}${r}-${i + 1}`,
          bracket,
          r,
          i + 1,
          r === 1 ? [at(order[2 * i]), at(order[2 * i + 1])] : [winnerOf(`${prefix}${r - 1}-${2 * i + 1}`), winnerOf(`${prefix}${r - 1}-${2 * i + 2}`)],
        ),
      ),
    )
  }
  return rounds
}

// Takes byes out. A match with one bye passes its player on (its loser is a bye); a match with two
// passes a bye on. Later slots that took a player from a removed match take it from where that
// match got it. Drafts must be in playing order (sources before the matches that use them).
function withoutByes(drafts: Draft[]): MatchSpec[] {
  const forward = new Map<string, { winner: Source; loser: Source }>()
  const follow = (s: Source): Source => {
    if (s && (s.type === "winner" || s.type === "loser")) {
      const f = forward.get(s.match)
      if (f) return s.type === "winner" ? f.winner : f.loser
    }
    return s
  }
  const kept: MatchSpec[] = []
  for (const d of drafts) {
    const a = follow(d.slots[0])
    const b = follow(d.slots[1])
    if (a && b) kept.push({ ...d, slots: [a, b] })
    else forward.set(d.id, { winner: a ?? b, loser: null })
  }
  // A round can vanish completely (the first losers' round of a field with many byes); rounds are
  // counted again without gaps. Ids keep their place in the full bracket.
  const rounds = new Map<string, number[]>()
  for (const m of kept) {
    const key = `${m.bracket}/${m.group}`
    const list = rounds.get(key) ?? []
    if (!list.includes(m.round)) list.push(m.round)
    rounds.set(key, list)
  }
  return kept.map((m) => {
    const list = rounds.get(`${m.bracket}/${m.group}`)!.sort((x, y) => x - y)
    return { ...m, round: list.indexOf(m.round) + 1 }
  })
}

export function singleElimination(n: number): MatchSpec[] {
  const rounds = eliminationRounds(range(n).map((i) => seedSource(i + 1)), "K", "main")
  rounds[rounds.length - 1][0].final = true
  return withoutByes(rounds.flat())
}

// Winners' bracket like single elimination ("W"). Losers' bracket ("L") for a bracket of size
// 2^k has 2(k−1) rounds:
//   L1        the losers of W1 play each other: loser of W1-(2i−1) against loser of W1-(2i)
//   L2j       (drop round) the winners of the round before meet the losers of W(j+1)
//   L2j+1     the winners of the drop round play each other
// In each drop round the losers of W(j+1) come in crossed in pairs: the survivor from the area of
// W(j+1)-1 meets the loser of W(j+1)-2 and vice versa. So nobody meets, in the first match after
// dropping, a player they already met in the winners' bracket (for every drop except the loser
// of the winners' final, whose area is the whole bracket). Grand final "GF": winners' champion
// against losers' champion; "GF2" is the reset.
export function doubleElimination(n: number, reset: boolean): MatchSpec[] {
  const winners = eliminationRounds(range(n).map((i) => seedSource(i + 1)), "W", "winners")
  const k = winners.length
  const losers: Draft[][] = []
  if (k >= 2) {
    losers.push(range(winners[0].length / 2).map((i) => draft(`L1-${i + 1}`, "losers", 1, i + 1, [loserOf(`W1-${2 * i + 1}`), loserOf(`W1-${2 * i + 2}`)])))
    for (let j = 1; j < k; j++) {
      const before = losers[losers.length - 1]
      const count = before.length
      const crossed = (i: number) => (count === 1 ? 0 : i ^ 1)
      const drop = before.map((m, i) => draft(`L${2 * j}-${i + 1}`, "losers", 2 * j, i + 1, [winnerOf(m.id), loserOf(`W${j + 1}-${crossed(i) + 1}`)]))
      losers.push(drop)
      if (j < k - 1) {
        losers.push(range(count / 2).map((i) => draft(`L${2 * j + 1}-${i + 1}`, "losers", 2 * j + 1, i + 1, [winnerOf(drop[2 * i].id), winnerOf(drop[2 * i + 1].id)])))
      }
    }
  }
  const losersChampion = k >= 2 ? winnerOf(losers[losers.length - 1][0].id) : loserOf("W1-1")
  const grandFinal = draft("GF", "final", 1, 1, [winnerOf(`W${k}-1`), losersChampion])
  grandFinal.final = true
  const finals = [grandFinal]
  if (reset) finals.push({ ...grandFinal, id: "GF2", round: 2, reset: true })

  // Playing order: W1, L1, W2, L2, L3, W3, L4, L5, W4, …, then the finals.
  const ordered: Draft[] = [...winners[0]]
  for (let j = 1; j < k; j++) ordered.push(...losers[2 * j - 2], ...winners[j], ...losers[2 * j - 1])
  return withoutByes([...ordered, ...finals])
}

// Circle method: the first player stays, the others turn one place each round. With an odd
// number one player rests per round. Pairs list the better seed first; the second cycle of a
// double round robin swaps them. Members are seed numbers in seed order.
export function circleRounds(members: number[], double: boolean): { pairs: [number, number][][]; rests: (number | null)[] } {
  let ring: (number | null)[] = members.length % 2 === 0 ? [...members] : [...members, null]
  const size = ring.length
  const pairs: [number, number][][] = []
  const rests: (number | null)[] = []
  for (let r = 0; r < size - 1; r++) {
    const round: [number, number][] = []
    let rest: number | null = null
    for (let i = 0; i < size / 2; i++) {
      const a = ring[i]
      const b = ring[size - 1 - i]
      if (a === null || b === null) rest = a ?? b
      else round.push(a < b ? [a, b] : [b, a])
    }
    pairs.push(round)
    rests.push(rest)
    ring = [ring[0], ring[size - 1], ...ring.slice(1, size - 1)]
  }
  if (double) {
    pairs.push(...pairs.map((round) => round.map(([a, b]): [number, number] => [b, a])))
    rests.push(...rests)
  }
  return { pairs, rests }
}

export function roundRobin(n: number, double: boolean): { matches: MatchSpec[]; rests: { round: number; seed: number }[] } {
  const { pairs, rests } = circleRounds(
    range(n).map((i) => i + 1),
    double,
  )
  const seeds = seedSources(n)
  const matches = pairs.flatMap((round, r) => round.map(([a, b], i) => roundRobinMatch(`R${r + 1}-${i + 1}`, null, r + 1, i + 1, seeds[a], seeds[b])))
  return { matches, rests: restList(rests) }
}

// One source object per seed, shared by all of its matches (a large round robin has thousands).
const seedSources = (n: number) => range(n + 1).map(seedSource)

const roundRobinMatch = (id: string, group: string | null, round: number, index: number, a: SlotSource, b: SlotSource): MatchSpec => ({
  id,
  bracket: "group",
  group,
  round,
  index,
  slots: [a, b],
  final: false,
  reset: false,
})

const restList = (rests: (number | null)[]) => rests.flatMap((seed, r) => (seed === null ? [] : [{ round: r + 1, seed }]))

// Group labels A … Z, then AA, AB, … like spreadsheet columns.
export function groupLabel(index: number): string {
  let label = ""
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26)) label = String.fromCharCode(65 + ((i - 1) % 26)) + label
  return label
}

// Snake seeding: seeds 1 … G go to groups A … G, the next G back from G to A, and so on. Group
// sizes differ by at most one.
export function snakeGroups(n: number, count: number): number[][] {
  const groups: number[][] = range(count).map(() => [])
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / count)
    const col = i % count
    groups[row % 2 === 0 ? col : count - 1 - col].push(i + 1)
  }
  return groups
}

// Who goes where in the knockout after the groups. Group winners are knockout seeds 1 … G in group
// order, so they meet the lower-placed in the first round. The next ranks fill the following seed
// numbers one by one; each takes the group whose players it would meet latest (players of the same
// group as far apart as possible), on a tie the group paired with its first opponent's group
// (A↔B, C↔D, …), then the first group. With two groups going through two each this is the classic
// cross-over A1–B2, B1–A2; with four groups A1–B2, D1–C2, B1–A2, C1–D2, every runner-up in the
// other half from its group winner.
export function crossoverEntrants(labels: string[], advance: number): SlotSource[] {
  const count = labels.length
  const qualifiers = count * advance
  const size = nextPowerOfTwo(qualifiers)
  const position: number[] = []
  bracketOrder(size).forEach((seed, p) => (position[seed] = p))
  // Round in which two knockout seeds can meet first.
  const meet = (a: number, b: number) => 32 - Math.clz32(position[a] ^ position[b])
  const groupOf: number[] = []
  const placed: number[][] = labels.map(() => [])
  const entrants: SlotSource[] = []
  const place = (seed: number, g: number, rank: number) => {
    entrants[seed - 1] = { type: "group", group: labels[g], rank }
    groupOf[seed] = g
    placed[g].push(seed)
  }
  for (let g = 0; g < count; g++) place(g + 1, g, 1)
  for (let rank = 2; rank <= advance; rank++) {
    const open = range(count)
    for (let seed = (rank - 1) * count + 1; seed <= rank * count; seed++) {
      const opponent = size + 1 - seed
      const partner = opponent <= qualifiers && groupOf[opponent] !== undefined ? groupOf[opponent] ^ 1 : -1
      let best = -1
      let bestKey = -1
      for (const g of open) {
        const key = Math.min(...placed[g].map((other) => meet(seed, other))) * 2 + (g === partner ? 1 : 0)
        if (key > bestKey) {
          best = g
          bestKey = key
        }
      }
      open.splice(open.indexOf(best), 1)
      place(seed, best, rank)
    }
  }
  return entrants
}

export function groupsThenKnockout(
  n: number,
  count: number,
  advance: number,
  double: boolean,
): { matches: MatchSpec[]; groups: { label: string; seeds: number[] }[]; rests: { group: string; round: number; seed: number }[] } {
  const groups = snakeGroups(n, count).map((seeds, g) => ({ label: groupLabel(g), seeds }))
  const sources = seedSources(n)
  const perGroup = groups.map(({ label, seeds }) => {
    const { pairs, rests } = circleRounds(seeds, double)
    return {
      rounds: pairs.map((round, r) => round.map(([a, b], i) => roundRobinMatch(`G${label}${r + 1}-${i + 1}`, label, r + 1, i + 1, sources[a], sources[b]))),
      rests: restList(rests).map((rest) => ({ group: label, ...rest })),
    }
  })
  // Round by round across the groups, so all groups move on together.
  const groupMatches: MatchSpec[] = []
  const most = Math.max(...perGroup.map((g) => g.rounds.length))
  for (let r = 0; r < most; r++) for (const g of perGroup) groupMatches.push(...(g.rounds[r] ?? []))

  const knockout = eliminationRounds(
    crossoverEntrants(
      groups.map((g) => g.label),
      advance,
    ),
    "K",
    "main",
  )
  knockout[knockout.length - 1][0].final = true
  return {
    matches: [...groupMatches, ...withoutByes(knockout.flat())],
    groups,
    rests: perGroup.flatMap((g) => g.rests),
  }
}
