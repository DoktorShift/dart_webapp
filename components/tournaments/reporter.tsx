"use client"

import { useEffect, useRef } from "react"
import { useTournament } from "@/components/tournaments/use-tournaments"
import type { SavedMatch } from "@/lib/game/types"
import { openBoardKey, reportResult } from "@/lib/tournaments/board-device"
import type { TournamentExtra } from "@/lib/tournaments/extra"
import { loadBoardDevice } from "@/lib/tournaments/store"

// Once the game stays won for a moment (an Undo right after the winning dart reports nothing),
// the result goes to the tournament, signed by the board key: once per result, again for a
// corrected one. The tournament's current state dates the record; without it (not loaded yet)
// the report waits for the next change of the game.
const SETTLE_MS = 3000

export default function Reporter({ extra, match }: { extra: TournamentExtra; match: SavedMatch }) {
  const { entry } = useTournament(extra.id)
  const state = entry?.read.state ?? null
  const latest = useRef({ match, state })
  latest.current = { match, state }
  const reporting = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    const timer = setTimeout(() => {
      const { match: game, state: current } = latest.current
      if (!current) return
      reporting.current = reporting.current
        .then(async () => {
          const record = await loadBoardDevice(extra.id)
          const key = record && (await openBoardKey(record))
          if (key) await reportResult(extra.id, key, current, extra.slot, game)
        })
        .catch(() => {
          // Signing or storing failed: the next change of the game tries again.
        })
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [extra.id, extra.slot, match, state])

  return null
}
