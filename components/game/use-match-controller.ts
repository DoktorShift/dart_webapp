"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  correctDart,
  correctVisitTotal,
  replay,
  restartLegLog,
  tagThrow,
  visitBySeq,
  type CorrectionPlan,
  type MatchState,
} from "@/lib/game/engine"
import { announce, announceUndo } from "@/lib/game/announce"
import { calloutFor, type Callout } from "@/components/game/callout"
import type { AppSettings } from "@/lib/game/storage"
import type { Dart, SavedMatch, Throw } from "@/lib/game/types"
import { recordMatch, removeMatch } from "@/lib/leaderboard"
import type { CorrectionTarget } from "@/components/game/visit-panel"

const BOUNCE_MS = 70

// Everything that changes a running game: entering darts, undo, corrections and turn
// changes. The game screen only lays things out and calls these.
export function useMatchController({
  match,
  settings,
  onMatchChange,
}: {
  match: SavedMatch
  settings: AppSettings
  onMatchChange: (match: SavedMatch) => void
}) {
  const state = useMemo(() => replay(match.config, match.throws), [match.config, match.throws])
  const [typed, setTyped] = useState("")
  const [correction, setCorrectionState] = useState<CorrectionTarget | null>(null)
  const [plan, setPlan] = useState<CorrectionPlan | null>(null)
  // A big, short flash for moments a loud room won't hear: 180, bust, nine marks.
  const [callout, setCallout] = useState<Callout | null>(null)
  const calloutTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Handlers read the latest values through refs so the keypads get stable callbacks.
  const matchRef = useRef(match)
  const settingsRef = useRef(settings)
  const correctionRef = useRef(correction)
  const lastTap = useRef({ key: "", at: 0 })
  matchRef.current = match
  settingsRef.current = settings

  const setCorrection = useCallback((c: CorrectionTarget | null) => {
    correctionRef.current = c
    setCorrectionState(c)
  }, [])

  // Every change goes through here. Corrections are remembered so Undo takes them back whole.
  const commit = useCallback(
    (throws: Throw[], { edit = false } = {}) => {
      const m = matchRef.current
      const next = replay(m.config, throws)
      const edits = edit ? [...(m.edits ?? []), { before: m.throws, afterLength: throws.length }].slice(-10) : m.edits
      onMatchChange({ ...m, throws, edits, status: "playing", acknowledgedLegs: Math.min(m.acknowledgedLegs, next.legResults.length) })
      return next
    },
    [onMatchChange],
  )

  const addThrow = useCallback(
    (t: Throw) => {
      // A second identical tap within 70 ms is a bounce (one touch registered twice), not a
      // dart: no one taps the same key that fast on purpose, two quick single 20s still count.
      const key = JSON.stringify(t)
      const now = Date.now()
      if (lastTap.current.key === key && now - lastTap.current.at < BOUNCE_MS) return
      lastTap.current = { key, at: now }

      const m = matchRef.current
      const next = commit([...m.throws, tagThrow(replay(m.config, m.throws), t)])
      announce(next, t.kind === "noScore" || (t.kind === "dart" && t.dart.segment === 0), settingsRef.current)
      const kind = calloutFor(next)
      if (kind) {
        clearTimeout(calloutTimer.current)
        setCallout({ id: now, kind })
        calloutTimer.current = setTimeout(() => setCallout(null), 1500)
      }
    },
    [commit],
  )

  useEffect(() => () => clearTimeout(calloutTimer.current), [])

  const finishCorrection = useCallback(
    (throws: Throw[]) => {
      const next = commit(throws, { edit: true })
      announce(next, false, settingsRef.current)
      setCorrection(null)
      setTyped("")
      setPlan(null)
    },
    [commit, setCorrection],
  )

  // Simple corrections apply at once; ones that remove darts or touch a finished leg's
  // result wait for the players to choose in the correction sheet.
  const propose = useCallback(
    (p: CorrectionPlan) => {
      if (p.keepResult || p.dropped > 0) setPlan(p)
      else finishCorrection(p.rescored)
    },
    [finishCorrection],
  )

  const onDart = useCallback(
    (dart: Dart) => {
      const c = correctionRef.current
      if (!c) return addThrow({ kind: "dart", dart })
      if (c.slot === null) return
      const m = matchRef.current
      const visit = visitBySeq(replay(m.config, m.throws), c.seq)
      if (visit) propose(correctDart(m.config, m.throws, visit, c.slot, dart))
      else setCorrection(null)
    },
    [addThrow, propose, setCorrection],
  )

  const onNoScore = useCallback(() => {
    if (correctionRef.current) onDart({ segment: 0, multiplier: 1 })
    else addThrow({ kind: "noScore" })
  }, [addThrow, onDart])

  const onVisit = useCallback(
    (total: number, darts: number, atDouble?: number) => {
      const c = correctionRef.current
      const m = matchRef.current
      if (!c) return addThrow({ kind: "visit", total, darts, atDouble })
      const visit = visitBySeq(replay(m.config, m.throws), c.seq)
      if (visit?.enteredAsTotal) propose(correctVisitTotal(m.config, m.throws, visit, total, darts, atDouble))
      else setCorrection(null)
    },
    [addThrow, propose, setCorrection],
  )

  const undo = useCallback(() => {
    const m = matchRef.current
    setCorrection(null)
    setTyped("")
    setCallout(null)
    if (!hasUndo(m)) return
    const edit = m.edits?.at(-1)
    if (edit && edit.afterLength === m.throws.length) {
      const next = replay(m.config, edit.before)
      onMatchChange({
        ...m,
        throws: edit.before,
        edits: m.edits!.slice(0, -1),
        status: "playing",
        acknowledgedLegs: Math.min(m.acknowledgedLegs, next.legResults.length),
      })
    } else {
      commit(m.throws.slice(0, -1))
    }
    announceUndo(settingsRef.current)
  }, [commit, onMatchChange, setCorrection])

  const startCorrection = useCallback(
    (seq: number) => {
      const visit = visitBySeq(state, seq)
      if (!visit) return
      setCorrection({ seq, slot: null })
      if (visit.enteredAsTotal) setTyped(visit.bust ? "" : `${visit.total}`)
    },
    [setCorrection, state],
  )

  const cancelCorrection = useCallback(() => {
    setCorrection(null)
    setTyped("")
  }, [setCorrection])

  const restartLeg = useCallback(() => {
    const throws = restartLegLog(matchRef.current.throws, state.legIndex)
    if (throws) commit(throws, { edit: true })
  }, [commit, state.legIndex])

  useLeaderboardSync(match, state)

  return {
    state,
    callout,
    typed,
    setTyped,
    correction,
    setCorrection,
    startCorrection,
    cancelCorrection,
    plan,
    applyPlan: (choice: "keep" | "rescore") => plan && finishCorrection(choice === "keep" && plan.keepResult ? plan.keepResult.throws : plan.rescored),
    dismissPlan: () => setPlan(null),
    onDart,
    onNoScore,
    onVisit,
    undo,
    canUndo: hasUndo(match),
    changeThrower: (player: number) => addThrow({ kind: "turn", player }),
    retire: (player: number) => addThrow({ kind: "retire", player }),
    restartLeg,
    acknowledgeLeg: () => onMatchChange({ ...match, acknowledgedLegs: state.legResults.length }),
  }
}

// Undo steps back one throw, or takes back the last correction or leg restart in one step,
// even when that left the log empty.
function hasUndo(match: SavedMatch) {
  return match.throws.length > 0 || match.edits?.at(-1)?.afterLength === match.throws.length
}

// Finished games with two or more players are on the Rangliste. If a correction or Undo
// reopens the game, its entry is taken off again until it finishes.
function useLeaderboardSync(match: SavedMatch, state: MatchState) {
  const recorded = useRef(false)
  useEffect(() => {
    if (match.config.players.length < 2) return
    if (state.winner === null) {
      if (recorded.current) removeMatch(match.id)
      recorded.current = false
      return
    }
    recordMatch({
      id: match.id,
      finishedAt: new Date().toISOString(),
      modeId: match.config.modeId,
      modeName: match.config.modeName,
      modeType: match.config.type,
      players: match.config.players.map((p, i) => ({
        name: p.name,
        won: i === state.winner,
        darts: state.stats[i].darts,
        points: match.config.type === "x01" ? state.stats[i].points : 0,
      })),
    })
    recorded.current = true
  }, [match.id, match.config, state])
}
