import { drawOrder, lotKey } from "./draw.ts"
import { computeStandings } from "./standings.ts"
import { doubleElimination, groupsThenKnockout, roundRobin, singleElimination } from "./structure.ts"
import { TournamentError } from "./types.ts"
import type {
  Consequence,
  MatchFormat,
  MatchRecord,
  MatchSpec,
  MatchState,
  MatchView,
  NextMatch,
  Participant,
  ParticipantStatus,
  Placement,
  RoundProgress,
  Score,
  SlotSource,
  Standings,
  Tournament,
  TournamentFormat,
  TournamentErrorCode,
  TournamentSetup,
  TournamentView,
  WalkoverReason,
  WithdrawalKind,
} from "./types.ts"

// The tournament engine: pure functions, no network, no clock. createTournament() makes the draw
// and the fixed match plan; every change (result, walkover, board, withdrawal) returns a new
// Tournament; resolveTournament() derives who plays whom, what is ready, tables and places from
// it. A correction is "enter the result again": matches after it that have not started simply
// get their new players, matches that have started or finished keep their record and are marked
// affected until the organizer decides (resetMatch, or a result for the new pairing). The rules
// in plain German: docs/implementation/evidence/P6.01/ENGINE.md.

export * from "./types.ts"
export { commitSeed, createDrawSeed, drawOrder, verifySeed } from "./draw.ts"

// The load the engine is released for (PLAN.md: 128 participants, 16 boards). A round robin, and
// each group, is limited to 64 (2016 matches in 63 rounds): 128 would be 8128 matches in 127
// rounds, no playable tournament; large fields play groups first.
const MAX_PARTICIPANTS = 128
export const MAX_ROUND_ROBIN = 64
export const MIN_PARTICIPANTS: Record<TournamentFormat, number> = { single: 2, double: 3, roundRobin: 2, groups: 3 }
const MAX_LEGS = 99

function fail(code: TournamentErrorCode, message: string): never {
  throw new TournamentError(code, message)
}

const isCount = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max

function checkFormat(format: MatchFormat | undefined, what: string) {
  if (!format || !isCount(format.legsToWin, 1, MAX_LEGS)) fail("invalidSetup", `${what}: legsToWin must be 1–${MAX_LEGS}`)
  if (format?.setsToWin !== undefined && !isCount(format.setsToWin, 1, MAX_LEGS)) fail("invalidSetup", `${what}: setsToWin must be 1–${MAX_LEGS}`)
}

// Only the fields of a match format, so a stored tournament carries nothing else.
const formatOf = (f: MatchFormat): MatchFormat => ({ legsToWin: f.legsToWin, ...(f.setsToWin !== undefined && { setsToWin: f.setsToWin }) })

function checkParticipants(participants: Participant[]) {
  const seen = new Set<string>()
  for (const p of participants) {
    if (!p || typeof p.id !== "string" || p.id === "" || typeof p.name !== "string" || p.name.trim() === "")
      fail("invalidParticipant", "every entry needs an id and a name")
    if (seen.has(p.id)) fail("duplicateParticipant", `${p.id} is entered twice`)
    seen.add(p.id)
  }
}

// --- Before the draw -------------------------------------------------------------------------

// Late entry: allowed until the draw, which is createTournament(). The draw keys keep everyone
// else's order among themselves.
export function addEntry(setup: TournamentSetup, participant: Participant): TournamentSetup {
  const participants = [...setup.participants, participant]
  checkParticipants(participants)
  if (participants.length > MAX_PARTICIPANTS) fail("tooManyParticipants", `at most ${MAX_PARTICIPANTS} participants`)
  return { ...setup, participants }
}

// Withdrawal before the draw: the entry simply leaves the field (no walkover).
export function removeEntry(setup: TournamentSetup, id: string): TournamentSetup {
  const index = setup.participants.findIndex((p) => p.id === id)
  if (index < 0) fail("unknownParticipant", `${id} is not entered`)
  const participants = setup.participants.filter((p) => p.id !== id)
  const seeded = setup.seeded !== undefined && index < setup.seeded ? setup.seeded - 1 : setup.seeded
  return { ...setup, participants, seeded }
}

// --- The draw ------------------------------------------------------------------------------

export function createTournament(setup: TournamentSetup): Tournament {
  const { format } = setup
  if (!Object.hasOwn(MIN_PARTICIPANTS, format)) fail("invalidSetup", `unknown format ${String(format)}`)
  if (!Array.isArray(setup.participants)) fail("invalidSetup", "participants missing")
  checkParticipants(setup.participants)
  const n = setup.participants.length
  if (n < MIN_PARTICIPANTS[format]) fail("tooFewParticipants", `${format} needs at least ${MIN_PARTICIPANTS[format]} participants`)
  if (n > MAX_PARTICIPANTS) fail("tooManyParticipants", `at most ${MAX_PARTICIPANTS} participants`)
  if (format === "roundRobin" && n > MAX_ROUND_ROBIN) fail("tooManyParticipants", `a round robin takes at most ${MAX_ROUND_ROBIN} participants`)
  if (typeof setup.seed !== "string" || setup.seed === "") fail("invalidSetup", "the draw needs a seed")
  const seeded = setup.seeded ?? 0
  if (!isCount(seeded, 0, n)) fail("invalidSetup", "seeded must be between 0 and the number of participants")
  checkFormat(setup.rules, "rules")
  if (setup.rules.final) checkFormat(setup.rules.final, "final")

  let advance = 0
  if (format === "groups") {
    const count = setup.groups?.count
    advance = setup.groups?.advance ?? 0
    if (!isCount(count, 1, Math.floor(n / 2))) fail("invalidSetup", "every group needs at least two players")
    if (Math.ceil(n / count!) > MAX_ROUND_ROBIN) fail("invalidSetup", `a group takes at most ${MAX_ROUND_ROBIN} players`)
    if (!isCount(advance, 1, Math.floor(n / count!)) || count! * advance < 2) fail("invalidSetup", "advance must fit the smallest group and give at least two knockout players")
  }

  const participants = drawOrder(setup.participants, setup.seed, seeded).map((p) => ({ id: p.id, name: p.name }))
  const id = (seed: number) => participants[seed - 1].id
  const double = setup.doubleRoundRobin === true
  const base = {
    engine: 1 as const,
    format,
    rules: { ...formatOf(setup.rules), ...(setup.rules.final && { final: formatOf(setup.rules.final) }) },
    grandFinalReset: format === "double" && setup.grandFinalReset !== false,
    doubleRoundRobin: (format === "roundRobin" || format === "groups") && double,
    advance,
    seed: setup.seed,
    seeded,
    participants,
    records: {},
    boards: {},
    withdrawals: {},
  }
  switch (format) {
    case "single":
      return { ...base, groups: [], rests: [], matches: singleElimination(n) }
    case "double":
      return { ...base, groups: [], rests: [], matches: doubleElimination(n, base.grandFinalReset) }
    case "roundRobin": {
      const plan = roundRobin(n, double)
      return { ...base, groups: [], rests: plan.rests.map((r) => ({ group: null, round: r.round, participant: id(r.seed) })), matches: plan.matches }
    }
    case "groups": {
      const plan = groupsThenKnockout(n, setup.groups!.count, advance, double)
      return {
        ...base,
        groups: plan.groups.map((g) => ({ label: g.label, members: g.seeds.map(id) })),
        rests: plan.rests.map((r) => ({ group: r.group, round: r.round, participant: id(r.seed) })),
        matches: plan.matches,
      }
    }
  }
}

// --- Deriving the state ----------------------------------------------------------------------

// A slot while resolving: a participant id, null (not known yet) or false (nobody will come).
type Occupant = string | null | false

interface Decision {
  state: MatchState
  winner: Occupant
  loser: Occupant
  score: Score | null
  walkover: MatchView["walkover"]
  affected: boolean
}

const views = new WeakMap<Tournament, TournamentView>()

// Derived state, computed once per Tournament object (they are never changed in place).
export function resolveTournament(t: Tournament): TournamentView {
  let view = views.get(t)
  if (!view) {
    // Stored by a newer app with other draw or bracket rules: never guess.
    if (t.engine !== 1) fail("unsupportedEngine", `tournament engine ${String(t.engine)} is not supported`)
    view = compute(t)
    views.set(t, view)
  }
  return view
}

const isDecided = (m: MatchView) => (m.state === "finished" || m.state === "walkover") && !m.affected

// What never changes after the draw, worked out once per match plan and field: rounds per
// bracket, the stage at which each match knocks its loser out, the matches each slot takes its
// player from (as positions), which matches form each table, and the lot keys. Every change to a
// tournament shares these arrays, so this runs once.
interface Plan {
  index: Map<string, number>
  // Per slot (2 per match): position of the match it takes the winner or loser from, else -1.
  from: Int32Array
  rounds: number[]
  stage: number[]
  tables: Map<string | null, number[]>
  lots: Map<string, string>
  // The last state derived for this plan. A new state reuses its match views and tables where
  // nothing differs, so a result costs little more than the matches it changes.
  last: TournamentView | null
}
const plans = new WeakMap<MatchSpec[], WeakMap<Participant[], Plan>>()

function planOf(t: Tournament): Plan {
  let byField = plans.get(t.matches)
  if (!byField) plans.set(t.matches, (byField = new WeakMap()))
  let plan = byField.get(t.participants)
  if (plan) return plan
  const index = new Map(t.matches.map((m, i) => [m.id, i]))
  const from = new Int32Array(t.matches.length * 2).fill(-1)
  t.matches.forEach((m, i) =>
    m.slots.forEach((s, k) => {
      if (s.type === "winner" || s.type === "loser") from[2 * i + k] = index.get(s.match)!
    }),
  )
  // Rounds per bracket, and per group within the group stage.
  const most = new Map<string | null, number>()
  const key = (m: MatchSpec) => (m.bracket === "group" ? m.group : m.bracket)
  for (const m of t.matches) most.set(key(m), Math.max(most.get(key(m)) ?? 0, m.round))
  // Stage at which the loser of a match leaves: knockout and losers' rounds by round, the finals
  // after the last losers' round, a winners' match at the losers' round its loser drops to.
  const losersRounds = t.format === "double" ? (most.get("losers") ?? 0) : 0
  const dropRound = new Map<string, number>()
  for (const m of t.matches) for (const s of m.slots) if (s.type === "loser") dropRound.set(s.match, m.bracket === "losers" ? m.round : losersRounds + 1)
  const tables = new Map<string | null, number[]>()
  t.matches.forEach((m, i) => {
    if (m.bracket !== "group") return
    const list = tables.get(m.group) ?? []
    list.push(i)
    tables.set(m.group, list)
  })
  plan = {
    index,
    from,
    rounds: t.matches.map((m) => most.get(key(m))!),
    stage: t.matches.map((m) => (m.bracket === "winners" ? dropRound.get(m.id)! : m.bracket === "final" ? losersRounds + 1 : m.round)),
    tables,
    lots: new Map(t.participants.map((p) => [p.id, lotKey(t.seed, p.id)])),
    last: null,
  }
  byField.set(t.participants, plan)
  return plan
}

const put = (into: Decision, state: MatchState, winner: Occupant, loser: Occupant, walkover: MatchView["walkover"], score: Score | null, affected: boolean) => {
  into.state = state
  into.winner = winner
  into.loser = loser
  into.walkover = walkover
  into.score = score
  into.affected = affected
  return into
}

// A player who withdrew loses; when both did, nobody moves on.
const forfeit = (into: Decision, x: string, y: string, inactive: (p: string) => boolean) =>
  inactive(x) && inactive(y)
    ? put(into, "walkover", false, false, "withdrawn", null, false)
    : inactive(x)
      ? put(into, "walkover", y, x, "withdrawn", null, false)
      : put(into, "walkover", x, y, "withdrawn", null, false)

// The outcome of one match, written into `into` (one object reused for every match while
// resolving, so a large round robin does not allocate per match).
function decide(into: Decision, a: Occupant, b: Occupant, record: MatchRecord | undefined, inactive: (p: string) => boolean): Decision {
  if (record) {
    if (a !== record.players[0] || b !== record.players[1]) return put(into, record.state, null, null, null, null, true)
    if (record.state === "live") return inactive(a) || inactive(b) ? forfeit(into, a, b, inactive) : put(into, "live", null, null, null, null, false)
    const w = record.winner ?? 0
    const walkover = record.state === "walkover" ? (record.reason ?? "noShow") : null
    return put(into, record.state, w === 0 ? a : b, w === 0 ? b : a, walkover, record.score ?? null, false)
  }
  if (a === null || b === null) return put(into, "pending", null, null, null, null, false)
  if (a === false && b === false) return put(into, "void", false, false, null, null, false)
  if (a === false || b === false) {
    const p = (a === false ? b : a) as string
    return inactive(p) ? put(into, "void", false, p, null, null, false) : put(into, "walkover", p, false, "bye", null, false)
  }
  if (inactive(a) || inactive(b)) return forfeit(into, a, b, inactive)
  return put(into, "ready", null, null, null, null, false)
}

function compute(t: Tournament): TournamentView {
  const plan = planOf(t)
  const ids = t.participants.map((p) => p.id)
  const gone = new Set(Object.keys(t.withdrawals))
  // Withdrawn players lose every match not yet decided; in a table they count as inactive unless
  // they withdrew after their group was complete.
  const inactive = gone.size === 0 ? () => false : (p: string) => gone.has(p)
  const inactiveInTable = gone.size === 0 ? () => false : (p: string) => gone.has(p) && !t.withdrawals[p].afterGroup
  const count = t.matches.length
  // Outcomes by match position: who moves on as winner and as loser.
  const winners: Occupant[] = new Array(count)
  const losers: Occupant[] = new Array(count)
  // Entries for ids that are not in the plan (damaged data) are ignored.
  const records: (MatchRecord | undefined)[] = new Array(count)
  for (const id in t.records) if (plan.index.has(id)) records[plan.index.get(id)!] = t.records[id]
  const boards: (string | undefined)[] = new Array(count)
  for (const id in t.boards) if (plan.index.has(id)) boards[plan.index.get(id)!] = t.boards[id]
  const matches: MatchView[] = []
  const match = lookup(plan.index, matches)
  const scratch: Decision = { state: "pending", winner: null, loser: null, score: null, walkover: null, affected: false }
  const normal = formatOf(t.rules)
  const final = t.rules.final ?? normal
  const options = { sets: (t.rules.setsToWin ?? 1) > 1, lot: (p: string) => plan.lots.get(p)!, inactive: inactiveInTable }
  const last = plan.last
  const lastTables = new Map(last ? last.standings.map((s) => [s.group, s]) : [])
  const table = (group: string | null, members: string[]) => {
    const positions = plan.tables.get(group) ?? []
    const before = lastTables.get(group)
    if (before && last!.tournament.withdrawals === t.withdrawals && positions.every((i) => matches[i] === last!.matches[i])) return before
    return computeStandings(
      members,
      positions.map((i) => matches[i]),
      { group, ...options },
    )
  }
  let groupTables: Map<string, Standings> | null = null
  // Group matches all come before the knockout, so the tables are final once a knockout slot asks.
  const tables = () => (groupTables ??= new Map(t.groups.map((g) => [g.label, table(g.label, g.members)])))

  const resolveSource = (s: SlotSource, from: number): Occupant => {
    switch (s.type) {
      case "seed":
        return ids[s.seed - 1]
      case "winner":
        return winners[from]
      case "loser":
        return losers[from]
      case "group": {
        const standings = tables().get(s.group)!
        if (!standings.complete) return null
        const row = standings.rows[s.rank - 1]
        return row && !row.inactive ? row.participant : false
      }
    }
  }

  t.matches.forEach((spec, i) => {
    let a: Occupant
    let b: Occupant
    if (spec.reset) {
      // Needed only when the losers' bracket player won the grand final.
      const gf = match("GF")!
      const needed = isDecided(gf) && gf.winner !== null && gf.winner === gf.slots[1].participant
      a = !isDecided(gf) ? null : needed ? gf.slots[0].participant : false
      b = !isDecided(gf) ? null : needed ? gf.slots[1].participant : false
    } else {
      a = resolveSource(spec.slots[0], plan.from[2 * i])
      b = resolveSource(spec.slots[1], plan.from[2 * i + 1])
    }
    const record = records[i]
    const d = decide(scratch, a, b, record, inactive)
    // Nobody wins a tournament after leaving it. The winner of the deciding match can only have
    // withdrawn since while a correction had that match marked (a complete tournament refuses
    // withdrawals). It then waits for the organizer like any affected match: play it again,
    // correct it, or take the withdrawal back.
    if (record && !d.affected && typeof d.winner === "string" && gone.has(d.winner) && decides(t, spec, d.winner === a))
      put(d, d.state, null, null, null, null, true)
    winners[i] = d.affected ? null : d.winner
    losers[i] = d.affected ? null : d.loser
    const format = spec.final ? final : normal
    const board = d.state === "ready" || d.state === "live" || d.state === "finished" ? (boards[i] ?? null) : null
    const before = last?.matches[i]
    if (before && sameView(before, a, b, d, format, board, record)) {
      matches.push(before)
      return
    }
    const view: MatchView = {
      id: spec.id,
      number: i + 1,
      bracket: spec.bracket,
      group: spec.group,
      round: spec.round,
      index: spec.index,
      rounds: plan.rounds[i],
      final: spec.final,
      reset: spec.reset,
      format,
      slots: [
        { source: spec.slots[0], participant: typeof a === "string" ? a : null, empty: a === false },
        { source: spec.slots[1], participant: typeof b === "string" ? b : null, empty: b === false },
      ],
      state: d.state,
      winner: typeof d.winner === "string" ? d.winner : null,
      loser: typeof d.loser === "string" ? d.loser : null,
      score: d.score,
      walkover: d.walkover,
      board,
      affected: d.affected,
      recorded: record ? record.players : null,
    }
    matches.push(view)
  })

  const standings: Standings[] =
    t.format === "roundRobin" ? [table(null, ids)] : t.format === "groups" ? t.groups.map((g) => tables().get(g.label)!) : []
  // No winner while a match waits for the organizer's decision after a correction (a reset that
  // was played and no longer fits, for example).
  const champion = matches.some((m) => m.affected) ? null : championOf(t, matches, match, standings)
  const placements = placementsOf(t, plan, matches, standings, champion)
  const placed = new Set(placements.map((p) => p.participant))
  const status: Record<string, ParticipantStatus> = {}
  for (const id of ids) status[id] = t.withdrawals[id]?.kind ?? (id === champion ? "champion" : placed.has(id) ? "eliminated" : "active")
  const view: TournamentView = {
    tournament: t,
    matches,
    match,
    standings,
    placements,
    status,
    champion,
    complete: matches.every((m) => m.state === "void" || isDecided(m)),
  }
  plan.last = view
  return view
}

// Made outside compute() on purpose: a closure there would share its scope, keep the previous
// state alive through `last`, and so every state ever derived.
const lookup = (index: Map<string, number>, matches: MatchView[]) => (id: string) => {
  const i = index.get(id)
  return i === undefined ? undefined : matches[i]
}

// Whether a match view from an earlier state still says exactly this (its static fields come
// from the same plan).
const sameSlot = (s: MatchView["slots"][number], o: Occupant) => s.participant === (typeof o === "string" ? o : null) && s.empty === (o === false)

function sameView(v: MatchView, a: Occupant, b: Occupant, d: Decision, format: MatchFormat, board: string | null, record: MatchRecord | undefined) {
  return (
    sameSlot(v.slots[0], a) &&
    sameSlot(v.slots[1], b) &&
    v.state === d.state &&
    v.winner === (typeof d.winner === "string" ? d.winner : null) &&
    v.loser === (typeof d.loser === "string" ? d.loser : null) &&
    v.score === d.score &&
    v.walkover === d.walkover &&
    v.board === board &&
    v.affected === d.affected &&
    v.recorded === (record ? record.players : null) &&
    v.format.legsToWin === format.legsToWin &&
    v.format.setsToWin === format.setsToWin
  )
}

// Whether the winner of this match wins the tournament: the knockout final, the reset, and the
// grand final when the winners' bracket player won it or there is no reset.
const decides = (t: Tournament, spec: MatchSpec, firstSlotWon: boolean) =>
  spec.reset || (spec.final && (spec.bracket === "main" || !t.grandFinalReset || firstSlotWon))

function championOf(t: Tournament, matches: MatchView[], match: (id: string) => MatchView | undefined, standings: Standings[]): string | null {
  if (t.format === "roundRobin") {
    const top = standings[0].rows[0]
    return standings[0].complete && top && !top.inactive ? top.participant : null
  }
  if (t.format === "double") {
    const gf = match("GF")!
    if (!isDecided(gf)) return null
    if (gf.winner === gf.slots[0].participant || !t.grandFinalReset) return gf.winner
    const reset = match("GF2")!
    return isDecided(reset) ? reset.winner : null
  }
  const final = matches.find((m) => m.bracket === "main" && m.final)!
  return isDecided(final) ? final.winner : null
}

// Places. Everyone knocked out at the same stage shares a place: place = field size − players
// out at this stage or before + 1, placeTo = field size − players out before this stage. Stages
// count up: group stage by group rank (below every knockout stage), then knockout rounds; in
// double elimination only the losers' rounds and the final knock out. A round robin places by
// the final table. Places are fixed as soon as a player is out. Disqualified players get no place
// and do not count: the others share the places 1 … field size − disqualified.
function placementsOf(t: Tournament, plan: Plan, matches: MatchView[], standings: Standings[], champion: string | null): Placement[] {
  const dq = (p: string | null) => p !== null && t.withdrawals[p]?.kind === "disqualified"
  const n = t.participants.filter((p) => !dq(p.id)).length
  if (t.format === "roundRobin") {
    const table = standings[0]
    if (!table.complete) return []
    let place = 0
    return table.rows.filter((r) => !dq(r.participant)).map((r) => ({ participant: r.participant, place: ++place, placeTo: place }))
  }

  const capacity = new Map<number, number>()
  const out = new Map<string, number>()
  const add = (stage: number, count: number) => capacity.set(stage, (capacity.get(stage) ?? 0) + count)
  const knockOut = (p: string, stage: number) => {
    if (dq(p)) return
    out.set(p, stage)
    add(stage, 1)
  }

  matches.forEach((m, i) => {
    if (m.bracket === "group") return
    const stage = plan.stage[i]
    const a = m.slots[0].participant
    const b = m.slots[1].participant
    const decided = (m.state === "finished" || m.state === "walkover" || m.state === "void") && !m.affected
    if (!decided) {
      // Not decided yet: one player will leave here. Not in the winners' bracket, not in a reset
      // that is not known to be needed, not against an empty place (a free pass) and not when a
      // disqualified player is the one who will lose.
      const leaves = m.bracket === "main" || m.bracket === "losers" || (m.bracket === "final" && (!m.reset || m.state !== "pending"))
      if (leaves && !m.slots.some((s) => s.empty || dq(s.participant))) add(stage, 1)
      return
    }
    if (m.winner === null && a !== null && b !== null) {
      // Both sides forfeited.
      knockOut(a, stage)
      knockOut(b, stage)
    } else if (m.loser !== null) {
      // A winners' bracket loser drops instead; in the grand final the winners' champion only
      // leaves when there is no reset.
      const leaves =
        m.bracket === "main" ||
        m.bracket === "losers" ||
        (m.bracket === "final" && (m.reset || !t.grandFinalReset || m.winner === a || m.winner === null))
      if (leaves) knockOut(m.loser, stage)
    }
  })
  for (const s of standings) {
    if (!s.complete) {
      const counted = s.rows.filter((r) => !dq(r.participant)).length
      for (let rank = t.advance + 1; rank <= counted; rank++) add(-rank, 1)
      continue
    }
    // Out after the groups: everyone below the qualifying places, and players who stopped playing.
    for (const row of s.rows) if (row.rank > t.advance || row.inactive) knockOut(row.participant, -row.rank)
  }

  const stages = [...capacity.keys()].sort((x, y) => x - y)
  const before = new Map<number, number>()
  let sum = 0
  for (const stage of stages) {
    before.set(stage, sum)
    sum += capacity.get(stage)!
  }
  const placements: Placement[] = []
  if (champion !== null && !dq(champion)) placements.push({ participant: champion, place: 1, placeTo: 1 })
  for (const [participant, stage] of out) {
    const below = before.get(stage)!
    placements.push({ participant, place: n - below - capacity.get(stage)! + 1, placeTo: n - below })
  }
  const seedOf = new Map(t.participants.map((p, i) => [p.id, i]))
  return placements.sort((x, y) => x.place - y.place || seedOf.get(x.participant)! - seedOf.get(y.participant)!)
}

// --- Changes ------------------------------------------------------------------------------

function find(t: Tournament, id: string): MatchView {
  const m = resolveTournament(t).match(id)
  if (!m) return fail("unknownMatch", `no match ${id}`)
  return m
}

const players = (m: MatchView): [string, string] | null => {
  const [a, b] = m.slots.map((s) => s.participant)
  return a !== null && b !== null ? [a, b] : null
}

// A result or walkover can be entered for a match with two known players that is ready, live,
// decided (a correction) or affected (the result of the new pairing). A player who withdrew plays
// no more: their match can only take a correction of what was entered for these same two players
// before (a result or walkover, not just a start). Otherwise a withdrawn or disqualified player
// could be entered as the winner of the matches their withdrawal gives away.
function enterable(t: Tournament, id: string): { m: MatchView; pair: [string, string] } {
  const m = find(t, id)
  const pair = players(m)
  const open = m.affected || m.state === "ready" || m.state === "live" || m.state === "finished" || (m.state === "walkover" && m.walkover !== "bye")
  if (!open || !pair) return fail("notReady", `${id} has no two players to enter a result for`)
  const record = t.records[id]
  const enteredBefore = record !== undefined && record.state !== "live" && record.players[0] === pair[0] && record.players[1] === pair[1]
  if (!enteredBefore && pair.some((p) => t.withdrawals[p])) fail("notReady", `a player of ${id} has withdrawn`)
  return { m, pair }
}

function busyElsewhere(t: Tournament, id: string, pair: [string, string]) {
  for (const other of resolveTournament(t).matches)
    if (other.id !== id && other.state === "live" && !other.affected && other.slots.some((s) => s.participant !== null && pair.includes(s.participant)))
      fail("playerBusy", `a player of ${id} is playing ${other.id}`)
}

// Winner slot for a score, or an error when the score cannot end a match in this format.
export function scoreWinner(format: MatchFormat, score: Score): 0 | 1 {
  const legsToWin = format.legsToWin
  const setsToWin = format.setsToWin ?? 1
  const pair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((x) => isCount(x, 0, 999))
  if (!score || !pair(score.legs)) return fail("invalidScore", "legs must be two whole numbers")
  const [l0, l1] = score.legs
  if (setsToWin <= 1) {
    if (score.sets !== undefined) fail("invalidScore", "this match has no sets")
    if ((l0 === legsToWin) === (l1 === legsToWin) || l0 > legsToWin || l1 > legsToWin) fail("invalidScore", `exactly one side wins with ${legsToWin} legs`)
    return l0 === legsToWin ? 0 : 1
  }
  if (!pair(score.sets)) return fail("invalidScore", "sets must be two whole numbers")
  const [s0, s1] = score.sets
  if ((s0 === setsToWin) === (s1 === setsToWin) || s0 > setsToWin || s1 > setsToWin) fail("invalidScore", `exactly one side wins with ${setsToWin} sets`)
  const w = s0 === setsToWin ? 0 : 1
  const lost = w === 0 ? s1 : s0
  const legs = [l0, l1]
  // The winner took legsToWin legs in each set won and fewer in each set lost; the loser the reverse.
  const winnerOk = legs[w] >= setsToWin * legsToWin && legs[w] <= setsToWin * legsToWin + lost * (legsToWin - 1)
  const loserOk = legs[1 - w] >= lost * legsToWin && legs[1 - w] <= lost * legsToWin + setsToWin * (legsToWin - 1)
  if (!winnerOk || !loserOk) fail("invalidScore", "legs do not fit the sets")
  return w
}

const withRecord = (t: Tournament, id: string, record: MatchRecord | null): Tournament => {
  const records = { ...t.records }
  if (record) records[id] = record
  else delete records[id]
  return { ...t, records }
}

// Starts a ready match on `board`, or without one on the board it was called to. Either way the
// board must be free.
export function startMatch(t: Tournament, id: string, board?: string): Tournament {
  const m = find(t, id)
  const pair = players(m)
  if (m.state !== "ready" || !pair) return fail("notReady", `${id} is not ready`)
  busyElsewhere(t, id, pair)
  const on = board ?? t.boards[id]
  const boards = on === undefined ? t.boards : withBoard(t, id, on)
  return { ...withRecord(t, id, { state: "live", players: pair }), boards }
}

// Calls a ready match to a board (or moves a live one); null takes the board away.
export function assignBoard(t: Tournament, id: string, board: string | null): Tournament {
  const m = find(t, id)
  if ((m.state !== "ready" && m.state !== "live") || m.affected) return fail("notReady", `${id} cannot get a board now`)
  if (board === null) {
    const boards = { ...t.boards }
    delete boards[id]
    return { ...t, boards }
  }
  return { ...t, boards: withBoard(t, id, board) }
}

// The boards with `board` given to match `id`. A board serves one ready or live match at a time.
// Finished matches keep theirs (where they were played); a match that went back to waiting after a
// correction loses it, so it never shows up again on a board that has moved on.
function withBoard(t: Tournament, id: string, board: string): Record<string, string> {
  if (typeof board !== "string" || board === "") return fail("invalidSetup", "board id missing")
  const view = resolveTournament(t)
  const taken = view.matches.find((o) => o.id !== id && o.board === board && (o.state === "ready" || o.state === "live"))
  if (taken) return fail("boardBusy", `board ${board} is in use by ${taken.id}`)
  const boards: Record<string, string> = {}
  for (const other in t.boards) if (t.boards[other] !== board || view.match(other)?.state === "finished") boards[other] = t.boards[other]
  boards[id] = board
  return boards
}

// Enters or corrects a result.
export function recordResult(t: Tournament, id: string, score: Score): Tournament {
  const { m, pair } = enterable(t, id)
  const winner = scoreWinner(m.format, score)
  const copy: Score = { legs: [score.legs[0], score.legs[1]], ...(score.sets && { sets: [score.sets[0], score.sets[1]] as [number, number] }) }
  return withRecord(t, id, { state: "finished", players: pair, winner, score: copy })
}

// A single match given up: the player did not turn up or gave up during it. The player stays in
// the tournament (in double elimination they drop to the losers' bracket).
export function recordWalkover(t: Tournament, id: string, winner: string, reason: WalkoverReason): Tournament {
  const { pair } = enterable(t, id)
  if (!pair.includes(winner)) return fail("notInMatch", `${winner} does not play ${id}`)
  if (reason !== "noShow" && reason !== "retired") return fail("invalidSetup", "unknown walkover reason")
  return withRecord(t, id, { state: "walkover", players: pair, winner: pair[0] === winner ? 0 : 1, reason })
}

// Takes back what was entered for a match: a start, a result or a walkover. Used for an affected
// match that is to be played again with its new players. A taken-back start keeps its board
// (nobody else can take a board while its match is live). A result or walkover only kept its
// board as the place where it was played, and that board may serve another match by now, so the
// match goes back without one.
export function resetMatch(t: Tournament, id: string): Tournament {
  find(t, id)
  const record = t.records[id]
  if (!record) return fail("noRecord", `nothing entered for ${id}`)
  const reset = withRecord(t, id, null)
  if (record.state === "live" || t.boards[id] === undefined) return reset
  const boards = { ...t.boards }
  delete boards[id]
  return { ...reset, boards }
}

// Withdrawal or disqualification after the draw. Results already played stay; every match of the
// player not yet decided (also a live one) is lost by walkover. In groups then knockout, a player
// whose group is already complete keeps their group place and gives up in the knockout. A
// withdrawal can become a disqualification later; once the tournament is complete, neither.
export function withdraw(t: Tournament, participant: string, kind: WithdrawalKind): Tournament {
  if (!t.participants.some((p) => p.id === participant)) return fail("unknownParticipant", `${participant} is not in the tournament`)
  if (kind !== "withdrawn" && kind !== "disqualified") return fail("invalidSetup", "unknown withdrawal")
  const before = t.withdrawals[participant]
  if (before?.kind === kind) return fail("alreadyWithdrawn", `${participant} is already ${kind}`)
  const view = resolveTournament(t)
  if (view.complete) return fail("tournamentComplete", "the tournament is complete")
  const group = t.groups.find((g) => g.members.includes(participant))
  const afterGroup = before ? before.afterGroup : group !== undefined && view.standings.find((s) => s.group === group.label)!.complete
  return { ...t, withdrawals: { ...t.withdrawals, [participant]: { kind, ...(afterGroup && { afterGroup: true as const }) } } }
}

// Takes a withdrawal back. Before the end, matches already built on it are marked affected. Once
// the tournament is complete, only when that marks nothing: no result entered changes, just the
// walkovers the withdrawal gave away open again (say a finalist was withdrawn or disqualified by
// mistake, which ended the tournament). Otherwise played matches depend on it, and it stays.
export function reinstate(t: Tournament, participant: string): Tournament {
  if (!t.withdrawals[participant]) return fail("notWithdrawn", `${participant} is not withdrawn`)
  const withdrawals = { ...t.withdrawals }
  delete withdrawals[participant]
  const reinstated = { ...t, withdrawals }
  if (resolveTournament(t).complete && previewChange(t, reinstated).some((c) => c.kind === "affected"))
    return fail("tournamentComplete", "the tournament is complete and played matches depend on the withdrawal")
  return reinstated
}

// What a change does, before it is applied: compare the tournament before and after.
export function previewChange(before: Tournament, after: Tournament): Consequence[] {
  const a = resolveTournament(before)
  const b = resolveTournament(after)
  const consequences: Consequence[] = []
  for (const x of a.matches) {
    const y = b.match(x.id)
    if (!y) continue
    const was = x.slots.map((s) => s.participant) as [string | null, string | null]
    const now = y.slots.map((s) => s.participant) as [string | null, string | null]
    const samePlayers = was[0] === now[0] && was[1] === now[1]
    const kind: Consequence["kind"] | null =
      !x.affected && y.affected
        ? "affected"
        : x.affected && !y.affected
          ? "resolved"
          : !samePlayers && !y.affected
            ? "players"
            : x.state !== y.state || x.winner !== y.winner || JSON.stringify(x.score) !== JSON.stringify(y.score)
              ? "result"
              : null
    if (kind) consequences.push({ match: x.id, kind, before: was, after: now })
  }
  return consequences
}

// --- Questions the screens ask -------------------------------------------------------------

// The match a player plays now or next: live, else the first ready, else the first that waits for
// an opponent or, after a correction, for the organizer's decision (match.affected). Null when the
// player is out, withdrawn or done.
export function nextMatch(view: TournamentView, participant: string): NextMatch | null {
  if (view.tournament.withdrawals[participant]) return null
  const open = view.matches.filter(
    (m) => (m.affected || m.state === "live" || m.state === "ready" || m.state === "pending") && m.slots.some((s) => s.participant === participant),
  )
  const live = open.find((m) => m.state === "live" && !m.affected)
  if (live) return { match: live, state: "live" }
  const ready = open.find((m) => m.state === "ready")
  if (ready) return { match: ready, state: "ready" }
  return open[0] ? { match: open[0], state: "waiting" } : null
}

// Ready matches without a board, in playing order.
export const readyMatches = (view: TournamentView) => view.matches.filter((m) => m.state === "ready" && m.board === null)

// Boards not used by a ready or live match.
export function freeBoards(view: TournamentView, boards: string[]): string[] {
  const used = new Set(view.matches.filter((m) => m.board !== null && (m.state === "ready" || m.state === "live")).map((m) => m.board))
  return boards.filter((b) => !used.has(b))
}

// Which ready match goes to which free board: playing order, and no player twice at a time
// (nobody who is playing or already called).
export function suggestBoards(view: TournamentView, boards: string[]): { match: string; board: string }[] {
  const free = freeBoards(view, boards)
  const busy = new Set<string>()
  for (const m of view.matches)
    if (m.state === "live" || (m.state === "ready" && m.board !== null)) for (const s of m.slots) if (s.participant) busy.add(s.participant)
  const suggestions: { match: string; board: string }[] = []
  for (const m of readyMatches(view)) {
    if (suggestions.length === free.length) break
    const pair = players(m)!
    if (pair.some((p) => busy.has(p))) continue
    pair.forEach((p) => busy.add(p))
    suggestions.push({ match: m.id, board: free[suggestions.length] })
  }
  return suggestions
}

// Progress of each round (matches that will not be played are left out).
export function roundProgress(view: TournamentView): RoundProgress[] {
  const rounds = new Map<string, RoundProgress>()
  for (const m of view.matches) {
    if (m.state === "void") continue
    const key = `${m.bracket}/${m.group}/${m.round}`
    let r = rounds.get(key)
    if (!r) {
      r = { bracket: m.bracket, group: m.group, round: m.round, total: 0, decided: 0, live: 0, ready: 0, pending: 0 }
      rounds.set(key, r)
    }
    r.total++
    if (isDecided(m)) r.decided++
    else if (m.state === "live") r.live++
    else if (m.state === "ready") r.ready++
    else r.pending++
  }
  return [...rounds.values()]
}
