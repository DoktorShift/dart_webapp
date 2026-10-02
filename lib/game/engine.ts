import type { Dart, MatchConfig, Throw } from "./types"

// The match is never mutated in place: every screen state is rebuilt by replaying the
// throw log. Undo is "drop the last throw", resume is "replay what was saved", and a
// correction is "change one entry and replay".

export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25]

// Totals no three darts can make.
export const IMPOSSIBLE_VISITS = new Set([163, 166, 169, 172, 173, 175, 176, 178, 179])

const MISS: Dart = { segment: 0, multiplier: 1 }

export const dartValue = (d: Dart) => d.segment * d.multiplier

export const isDoubleDart = (d: Dart) => d.multiplier === 2 && d.segment > 0

// Remaining scores that one dart at a double (or the bull) can finish.
export const onADouble = (remaining: number, doubleOut: boolean) =>
  doubleOut ? (remaining <= 40 && remaining % 2 === 0 && remaining > 0) || remaining === 50 : remaining <= 60 && remaining > 0

export function dartLabel(d: Dart) {
  if (d.segment === 0) return "Miss"
  if (d.segment === 25) return d.multiplier === 2 ? "Bull" : "25"
  if (d.multiplier === 3) return `T${d.segment}`
  if (d.multiplier === 2) return `D${d.segment}`
  return `${d.segment}`
}

export interface PlayerStats {
  darts: number
  points: number
  visits: number
  first9Points: number
  first9Darts: number
  highestVisit: number
  highestCheckout: number
  checkouts: number
  dartsAtDouble: number
  tons: number
  ton40s: number
  max180s: number
  marks: number
  hits: number
}

export interface Visit {
  // Visit number across the match; corrections address visits by it.
  seq: number
  leg: number
  player: number
  darts: Dart[]
  // Log position of each dart, used to correct a dart after the fact.
  throwIndexes: number[]
  // Darts used (also when the visit was entered as a total).
  dartCount: number
  total: number
  bust: boolean
  checkout: boolean
  enteredAsTotal: boolean
  edited: boolean
  // The leg ended on this visit because its result was kept after a correction.
  keptResult?: boolean
}

// An X01 leg won in the fewest darts possible (60 is the most one dart can score): nine darts
// in 501, six in 301. Returns that number of darts for a perfect leg, otherwise null.
export function perfectLegDarts(config: MatchConfig, result: LegResult): number | null {
  if (config.type !== "x01") return null
  const fewest = Math.ceil(config.startScore / 60)
  return result.dartsUsed === fewest ? fewest : null
}

export interface LegResult {
  winner: number
  dartsUsed: number
  checkout: number
  lastVisit: Visit
  // The set the leg was played in (0 when the game has no sets), and whether it won that set.
  set: number
  wonSet: boolean
}

export type Outcome =
  | { type: "none" }
  | { type: "dart"; player: number }
  | { type: "visit"; player: number; total: number }
  | { type: "bust"; player: number }
  | { type: "leg"; player: number; total: number }
  | { type: "set"; player: number; total: number }
  | { type: "match"; player: number; total: number }
  | { type: "turn"; player: number }

export interface MatchState {
  config: MatchConfig
  legIndex: number
  legStarter: number
  current: number
  active: boolean[]
  // x01 remaining per player
  scores: number[]
  visitStartScore: number
  // Double In: whether each player's score has started this leg (always true without it).
  opened: boolean[]
  // cricket
  marks: Record<number, number>[]
  points: number[]
  // around the clock: index into the target sequence
  progress: number[]
  clockTargets: number[]
  visitDarts: Dart[]
  visitThrows: number[]
  visitEdited: boolean
  // Throw log position -> visit number it was applied to.
  throwVisit: number[]
  // Log positions that replay ignored: darts of a visit or leg that a correction ended earlier.
  skipped: number[]
  visitSeq: number
  legVisits: Visit[]
  // Visits of legs that have finished, by leg number.
  pastLegs: Visit[][]
  // Legs whose result was kept after a correction: they end only at their closing throw.
  lockedLegs: Set<number>
  closing: boolean
  lastVisit: (Visit | null)[]
  dartsInLeg: number[]
  visitsInLeg: number[]
  // Legs won in the current set (in the game, when it has no sets).
  legsWon: number[]
  setsWon: number[]
  setIndex: number
  // Who threw first in the current set: the next set starts with the player after them.
  setStarter: number
  // The set of each leg, by leg number.
  legSets: number[]
  legResults: LegResult[]
  stats: PlayerStats[]
  winner: number | null
  outcome: Outcome
  throwCount: number
}

const emptyStats = (): PlayerStats => ({
  darts: 0,
  points: 0,
  visits: 0,
  first9Points: 0,
  first9Darts: 0,
  highestVisit: 0,
  highestCheckout: 0,
  checkouts: 0,
  dartsAtDouble: 0,
  tons: 0,
  ton40s: 0,
  max180s: 0,
  marks: 0,
  hits: 0,
})

const activeOthers = (s: MatchState, p: number) => s.config.players.map((_, i) => i).filter((i) => i !== p && s.active[i])

function nextActive(s: MatchState, p: number) {
  const n = s.config.players.length
  for (let k = 1; k <= n; k++) {
    const q = (p + k) % n
    if (s.active[q]) return q
  }
  return p
}

function startLeg(s: MatchState) {
  const n = s.config.players.length
  const last = s.legResults.at(-1)
  if (!last) {
    s.legStarter = s.active[0] ? 0 : nextActive(s, 0)
    s.setStarter = s.legStarter
  } else if (s.config.startRule === "loser") {
    s.legStarter = n === 2 ? 1 - last.winner : nextActive(s, last.winner)
  } else if (last.wonSet) {
    // A new set starts with the next player; its legs take turns from there.
    s.setStarter = nextActive(s, s.setStarter)
    s.legStarter = s.setStarter
  } else {
    s.legStarter = nextActive(s, s.legStarter)
  }
  s.current = s.legStarter
  s.legSets[s.legIndex] = s.setIndex
  s.scores = s.config.players.map(() => s.config.startScore)
  s.opened = s.config.players.map(() => !s.config.doubleIn)
  s.visitStartScore = s.config.startScore
  s.marks = s.config.players.map(() => Object.fromEntries(CRICKET_TARGETS.map((t) => [t, 0])))
  s.points = s.config.players.map(() => 0)
  s.progress = s.config.players.map(() => 0)
  s.visitDarts = []
  s.visitThrows = []
  s.visitEdited = false
  s.legVisits = []
  s.lastVisit = s.config.players.map(() => null)
  s.dartsInLeg = s.config.players.map(() => 0)
  s.visitsInLeg = s.config.players.map(() => 0)
}

export function newMatchState(config: MatchConfig): MatchState {
  const s: MatchState = {
    config,
    legIndex: 0,
    legStarter: 0,
    current: 0,
    active: config.players.map(() => true),
    scores: [],
    visitStartScore: config.startScore,
    opened: [],
    marks: [],
    points: [],
    progress: [],
    clockTargets: [...Array.from({ length: 20 }, (_, i) => i + 1), ...(config.bullFinish ? [25] : [])],
    visitDarts: [],
    visitThrows: [],
    visitEdited: false,
    throwVisit: [],
    skipped: [],
    visitSeq: 0,
    legVisits: [],
    pastLegs: [],
    lockedLegs: new Set(),
    closing: false,
    lastVisit: [],
    dartsInLeg: [],
    visitsInLeg: [],
    legsWon: config.players.map(() => 0),
    setsWon: config.players.map(() => 0),
    setIndex: 0,
    setStarter: 0,
    legSets: [],
    legResults: [],
    stats: config.players.map(emptyStats),
    winner: null,
    outcome: { type: "none" },
    throwCount: 0,
  }
  startLeg(s)
  return s
}

function visitOf(s: MatchState, p: number, extra: Partial<Visit>): Visit {
  return {
    seq: s.visitSeq,
    leg: s.legIndex,
    player: p,
    darts: s.visitDarts,
    throwIndexes: s.visitThrows,
    dartCount: s.visitDarts.length,
    total: 0,
    bust: false,
    checkout: false,
    enteredAsTotal: false,
    edited: s.visitEdited,
    ...extra,
  }
}

function endVisit(s: MatchState, visit: Visit) {
  // A leg kept as played only ends at its closing throw, not where the corrected scores finish.
  if (visit.checkout && s.lockedLegs.has(s.legIndex) && !s.closing) visit = { ...visit, checkout: false }
  const p = visit.player
  const st = s.stats[p]
  st.visits++
  if (s.config.type === "x01") {
    st.points += visit.total
    st.highestVisit = Math.max(st.highestVisit, visit.total)
    if (visit.total === 180) st.max180s++
    else if (visit.total >= 140) st.ton40s++
    else if (visit.total >= 100) st.tons++
    if (s.visitsInLeg[p] < 3) {
      st.first9Points += visit.total
      st.first9Darts += visit.dartCount
    }
  }
  s.visitsInLeg[p]++
  s.legVisits.push(visit)
  s.lastVisit[p] = visit
  s.visitDarts = []
  s.visitThrows = []
  s.visitEdited = false
  s.visitSeq++

  if (visit.checkout) {
    winLeg(s, p, visit)
    return
  }
  s.current = nextActive(s, p)
  s.visitStartScore = s.scores[s.current]
  s.outcome = visit.bust ? { type: "bust", player: p } : { type: "visit", player: p, total: visit.total }
}

function winLeg(s: MatchState, p: number, visit: Visit) {
  const st = s.stats[p]
  s.legsWon[p]++
  if (s.config.type === "x01") {
    st.checkouts++
    st.highestCheckout = Math.max(st.highestCheckout, visit.total)
  }
  const wonSet = s.legsWon[p] >= s.config.legsToWin
  if (wonSet) s.setsWon[p]++
  s.legResults.push({ winner: p, dartsUsed: s.dartsInLeg[p], checkout: visit.total, lastVisit: visit, set: s.setIndex, wonSet })

  if (s.setsWon[p] >= setsToWin(s.config)) {
    s.winner = p
    s.outcome = { type: "match", player: p, total: visit.total }
    return
  }
  s.outcome = { type: wonSet ? "set" : "leg", player: p, total: visit.total }
  s.pastLegs[s.legIndex] = s.legVisits
  if (wonSet) {
    s.setIndex++
    s.legsWon = s.legsWon.map(() => 0)
  }
  s.legIndex++
  startLeg(s)
}

// Ends the visit in progress with the darts entered so far (used when a correction
// means a visit needs fewer darts than were recorded, or a player leaves mid-visit).
function closeVisitEarly(s: MatchState) {
  const p = s.current
  const total = s.config.type === "x01" ? s.visitStartScore - s.scores[p] : 0
  endVisit(s, visitOf(s, p, { total }))
}

function applyX01Dart(s: MatchState, dart: Dart) {
  const p = s.current
  const st = s.stats[p]
  const before = s.scores[p]
  if (s.visitDarts.length === 0) s.visitStartScore = before

  st.darts++
  s.dartsInLeg[p]++
  s.visitDarts = [...s.visitDarts, dart]

  // Double In: darts score nothing until a double (or the bull) starts the player's score.
  if (!s.opened[p] && !isDoubleDart(dart)) {
    if (s.visitDarts.length === 3) endVisit(s, visitOf(s, p, { total: 0 }))
    else s.outcome = { type: "dart", player: p }
    return
  }
  s.opened[p] = true

  const after = before - dartValue(dart)
  if (onADouble(before, s.config.doubleOut)) st.dartsAtDouble++

  const bust =
    after < 0 || (s.config.doubleOut && after === 1) || (after === 0 && s.config.doubleOut && !isDoubleDart(dart))

  if (bust) {
    s.scores[p] = s.visitStartScore
    endVisit(s, visitOf(s, p, { bust: true }))
    return
  }
  s.scores[p] = after
  if (after === 0) {
    endVisit(s, visitOf(s, p, { total: s.visitStartScore, checkout: true }))
    return
  }
  if (s.visitDarts.length === 3) {
    endVisit(s, visitOf(s, p, { total: s.visitStartScore - after }))
    return
  }
  s.outcome = { type: "dart", player: p }
}

function applyX01Visit(s: MatchState, total: number, darts: number, atDouble: number | undefined, index: number) {
  if (s.visitDarts.length > 0) return
  const p = s.current
  const st = s.stats[p]
  const before = s.scores[p]
  const after = before - total
  s.visitStartScore = before
  st.darts += darts
  s.dartsInLeg[p] += darts

  const bust = after < 0 || (s.config.doubleOut && after === 1)
  const checkout = !bust && after === 0
  // Double In: a total is what counted, so any points mean the double was hit.
  if (total > 0) s.opened[p] = true
  // Darts at a double, for the checkout rate. When the scorer wasn't asked: a visit that started
  // on a finishing double used every dart at it, any other checkout used one.
  st.dartsAtDouble += atDouble ?? (onADouble(before, s.config.doubleOut) ? darts : checkout ? 1 : 0)
  const base = { darts: [], throwIndexes: [index], dartCount: darts, enteredAsTotal: true }
  if (bust) {
    endVisit(s, visitOf(s, p, { ...base, bust: true }))
    return
  }
  s.scores[p] = after
  endVisit(s, visitOf(s, p, { ...base, total, checkout }))
}

function applyCricketDart(s: MatchState, dart: Dart) {
  const p = s.current
  const st = s.stats[p]
  const others = activeOthers(s, p)
  st.darts++
  s.dartsInLeg[p]++
  s.visitDarts = [...s.visitDarts, dart]

  if (CRICKET_TARGETS.includes(dart.segment)) {
    const t = dart.segment
    for (let hit = 0; hit < dart.multiplier; hit++) {
      if (s.marks[p][t] < 3) {
        s.marks[p][t]++
        st.marks++
        continue
      }
      const open = others.filter((q) => s.marks[q][t] < 3)
      if (open.length === 0) break
      st.marks++
      if (s.config.cutThroat) open.forEach((q) => (s.points[q] += t))
      else s.points[p] += t
    }
  }

  const closedAll = CRICKET_TARGETS.every((t) => s.marks[p][t] >= 3)
  const ahead = others.every((q) => (s.config.cutThroat ? s.points[p] <= s.points[q] : s.points[p] >= s.points[q]))
  if (closedAll && ahead) {
    endVisit(s, visitOf(s, p, { checkout: true }))
    return
  }
  if (s.visitDarts.length === 3) {
    endVisit(s, visitOf(s, p, {}))
    return
  }
  s.outcome = { type: "dart", player: p }
}

function applyClockDart(s: MatchState, dart: Dart) {
  const p = s.current
  const st = s.stats[p]
  st.darts++
  s.dartsInLeg[p]++
  s.visitDarts = [...s.visitDarts, dart]

  if (dart.segment === s.clockTargets[s.progress[p]]) {
    s.progress[p]++
    st.hits++
  }
  if (s.progress[p] >= s.clockTargets.length) {
    endVisit(s, visitOf(s, p, { checkout: true }))
    return
  }
  if (s.visitDarts.length === 3) {
    endVisit(s, visitOf(s, p, {}))
    return
  }
  s.outcome = { type: "dart", player: p }
}

function applyDart(s: MatchState, dart: Dart, index: number) {
  s.visitThrows = [...s.visitThrows, index]
  if (s.config.type === "x01") applyX01Dart(s, dart)
  else if (s.config.type === "cricket") applyCricketDart(s, dart)
  else applyClockDart(s, dart)
}

// Ends the leg at a kept result's closing throw, crediting the player who threw it.
function forceLegEnd(s: MatchState, thrower: number) {
  if (s.visitDarts.length > 0 && s.current === thrower) {
    const total = s.config.type === "x01" ? s.visitStartScore - s.scores[thrower] : 0
    endVisit(s, visitOf(s, thrower, { total, checkout: true, keptResult: true }))
    return
  }
  // The closing throw already ended its visit (third dart or a bust): mark that visit as the win.
  const last = s.legVisits.at(-1)
  if (!last || last.player !== thrower) return
  const won = { ...last, checkout: true, keptResult: true }
  s.legVisits[s.legVisits.length - 1] = won
  s.lastVisit[thrower] = won
  winLeg(s, thrower, won)
}

function retire(s: MatchState, p: number) {
  if (!s.active[p]) return
  if (p === s.current && s.visitDarts.length > 0) closeVisitEarly(s)
  s.active[p] = false
  const left = s.active.filter(Boolean).length
  if (left === 1 && s.config.players.length > 1) {
    // Last player standing wins the game.
    s.winner = s.active.indexOf(true)
    s.outcome = { type: "match", player: s.winner, total: 0 }
    return
  }
  if (left === 0) return
  if (s.current === p) {
    s.current = nextActive(s, p)
    s.visitStartScore = s.scores[s.current]
  }
  if (s.legStarter === p && s.legVisits.length === 0) s.legStarter = s.current
}

export function applyThrow(s: MatchState, t: Throw) {
  const index = s.throwCount++
  s.throwVisit[index] = s.visitSeq
  const skip = () => s.skipped.push(index)
  if (s.winner !== null) return skip()

  // Tagged throws stay in their own leg and visit, whatever a correction changed before them.
  if (t.leg !== undefined && t.leg !== s.legIndex) return skip()
  if (t.visit !== undefined) {
    if (t.visit < s.visitSeq) return skip()
    while (t.visit > s.visitSeq && s.winner === null && (t.leg === undefined || t.leg === s.legIndex)) closeVisitEarly(s)
    if (s.winner !== null || (t.leg !== undefined && t.leg !== s.legIndex)) return skip()
    s.throwVisit[index] = s.visitSeq
  }

  if (t.edited) s.visitEdited = true
  if (t.closesLeg) {
    const leg = s.legIndex
    const thrower = s.current
    s.closing = true
    applyKind(s, t, index)
    s.closing = false
    if (s.legIndex === leg && s.winner === null) forceLegEnd(s, thrower)
    return
  }
  applyKind(s, t, index)
}

function applyKind(s: MatchState, t: Throw, index: number) {
  switch (t.kind) {
    case "visit":
      if (s.config.type === "x01") applyX01Visit(s, t.total, t.darts, t.atDouble, index)
      return
    case "noScore": {
      const left = 3 - s.visitDarts.length
      for (let k = 0; k < left && s.visitSeq === s.throwVisit[index]; k++) applyDart(s, MISS, index)
      return
    }
    case "turn":
      if (s.visitDarts.length === 0 && s.active[t.player]) {
        if (s.legVisits.length === 0) s.legStarter = t.player
        if (s.legVisits.length === 0 && legsPlayedInSet(s) === 0) s.setStarter = t.player
        s.current = t.player
        s.visitStartScore = s.scores[t.player]
        s.outcome = { type: "turn", player: t.player }
      }
      return
    case "retire":
      retire(s, t.player)
      return
    case "dart":
      if (s.active[s.current]) applyDart(s, t.dart, index)
      return
  }
}

export function replay(config: MatchConfig, throws: Throw[]): MatchState {
  const s = newMatchState(config)
  for (const t of throws) if (t.closesLeg && t.leg !== undefined) s.lockedLegs.add(t.leg)
  for (const t of throws) applyThrow(s, t)
  return s
}

// Drops entries that replay ignores (darts of a visit or leg that a correction ended
// earlier), so the saved log only holds darts that count.
export function cleanLog(config: MatchConfig, throws: Throw[]) {
  const skipped = new Set(replay(config, throws).skipped)
  return skipped.size === 0 ? throws : throws.filter((_, i) => !skipped.has(i))
}

// The visit a correction is aimed at: the one in progress, or any earlier visit of the match.
export function visitBySeq(s: MatchState, seq: number): Visit | undefined {
  if (seq === s.visitSeq && s.winner === null)
    return visitOf(s, s.current, { total: s.config.type === "x01" ? s.visitStartScore - s.scores[s.current] : 0 })
  return s.legVisits.find((v) => v.seq === seq) ?? s.pastLegs.flat().find((v) => v.seq === seq)
}

export interface CorrectionPlan {
  // The corrected log scored by the normal rules, without darts that no longer count.
  rescored: Throw[]
  // How many darts were removed from `rescored` because they no longer count.
  dropped: number
  // Only for a correction in a finished leg that would change how that leg ended: the same
  // correction with the leg's result kept as played (darts rules: a finished leg stands).
  keepResult?: { throws: Throw[]; leg: number; winner: number }
}

const sameResults = (a: MatchState, b: MatchState) =>
  a.winner === b.winner &&
  a.legResults.length === b.legResults.length &&
  a.legResults.every((r, i) => r.winner === b.legResults[i].winner)

function plan(config: MatchConfig, throws: Throw[], raw: Throw[], leg: number | undefined): CorrectionPlan {
  // Rescoring follows the rules, so a kept result on this leg no longer applies.
  const unlocked = raw.map((t) => (t.closesLeg && t.leg === leg ? { ...t, closesLeg: undefined } : t))
  const dropped = replay(config, unlocked).skipped.length
  const rescored = dropped > 0 ? cleanLog(config, unlocked) : unlocked

  const before = replay(config, throws)
  const finishedLeg = leg !== undefined && leg < before.legResults.length
  if (!finishedLeg || (dropped === 0 && sameResults(before, replay(config, rescored)))) return { rescored, dropped }

  const closer = raw.findLastIndex((t) => t.leg === leg)
  const kept = cleanLog(
    config,
    raw.map((t, i) => (i === closer ? { ...t, closesLeg: true } : t)),
  )
  return { rescored, dropped, keepResult: { throws: kept, leg, winner: before.legResults[leg].winner } }
}

// Replaces one dart of a visit.
export function correctDart(config: MatchConfig, throws: Throw[], visit: Visit, slot: number, dart: Dart): CorrectionPlan {
  const index = visit.throwIndexes[slot]
  const original = throws[index]
  if (original === undefined) return { rescored: throws, dropped: 0 }
  const meta = { visit: original.visit, leg: original.leg, edited: true, closesLeg: original.closesLeg }

  let replacement: Throw[] = [{ kind: "dart", dart, ...meta }]
  if (original.kind === "noScore") {
    // "No score" stands for several missed darts; spell them out and change the one tapped.
    const first = visit.throwIndexes.indexOf(index)
    const count = visit.throwIndexes.filter((i) => i === index).length
    replacement = Array.from({ length: count }, (_, k): Throw => ({
      kind: "dart",
      dart: k === slot - first ? dart : MISS,
      ...meta,
      closesLeg: k === count - 1 ? original.closesLeg : undefined,
    }))
  }
  return plan(config, throws, [...throws.slice(0, index), ...replacement, ...throws.slice(index + 1)], original.leg)
}

// Replaces a visit entered as a total.
export function correctVisitTotal(
  config: MatchConfig,
  throws: Throw[],
  visit: Visit,
  total: number,
  darts: number,
  atDouble?: number,
): CorrectionPlan {
  const index = visit.throwIndexes[0]
  const original = throws[index]
  const raw = throws.map((t, k): Throw =>
    k === index
      ? { kind: "visit", total, darts, atDouble, visit: original?.visit, leg: original?.leg, edited: true, closesLeg: original?.closesLeg }
      : t,
  )
  return plan(config, throws, raw, original?.leg)
}

// The log with the darts of one leg cleared, ready to play it again. Players who left stay
// gone: their departure is kept without its visit tag so it applies at once.
export function restartLegLog(throws: Throw[], leg: number): Throw[] | null {
  const start = throws.findIndex((t) => t.leg === leg)
  if (start < 0) return null
  const departures = throws.slice(start).flatMap((t): Throw[] => (t.kind === "retire" ? [{ ...t, visit: undefined }] : []))
  return [...throws.slice(0, start), ...departures]
}

// Sets to win the game: 1 when it's played in legs only.
export const setsToWin = (config: MatchConfig) => Math.max(1, config.setsToWin ?? 1)

export const playsSets = (config: MatchConfig) => setsToWin(config) > 1

// Legs finished in the current set (every finished leg has one winner).
const legsPlayedInSet = (s: MatchState) => s.legsWon.reduce((sum, won) => sum + won, 0)

// Where a leg sits in the game, for names like "Leg 3" or "Set 2, Leg 1": the set (from 1, or
// null without sets) and the leg's number within it.
export function legPosition(s: MatchState, leg: number): { set: number | null; leg: number } {
  const set = s.legSets[leg] ?? s.setIndex
  if (!playsSets(s.config)) return { set: null, leg: leg + 1 }
  return { set: set + 1, leg: s.legSets.slice(0, leg).filter((other) => other === set).length + 1 }
}

// Legs each player won in a set, from the results.
export const setScore = (s: MatchState, set: number) =>
  s.config.players.map((_, p) => s.legResults.filter((r) => r.set === set && r.winner === p).length)

// Legs a player won in the whole game.
export const legsWonInGame = (s: MatchState, p: number) => s.legResults.filter((r) => r.winner === p).length

// Tags a new throw with the visit and leg it belongs to.
export const tagThrow = (s: MatchState, t: Throw): Throw => ({ ...t, visit: s.visitSeq, leg: s.legIndex })

export const threeDartAverage = (st: PlayerStats) =>
  st.darts > 0 ? Math.round((st.points / st.darts) * 3 * 10) / 10 : null

export const first9Average = (st: PlayerStats) =>
  st.first9Darts > 0 ? Math.round((st.first9Points / st.first9Darts) * 3 * 10) / 10 : null

export const marksPerRound = (st: PlayerStats) =>
  st.darts > 0 ? Math.round((st.marks / st.darts) * 3 * 100) / 100 : null

// Rates are ratios from 0 to 1; screens show them as percentages.
export const checkoutRate = (st: PlayerStats) => (st.dartsAtDouble > 0 ? st.checkouts / st.dartsAtDouble : null)

export const hitRate = (st: PlayerStats) => (st.darts > 0 ? st.hits / st.darts : null)
