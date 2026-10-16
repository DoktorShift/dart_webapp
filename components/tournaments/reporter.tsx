"use client"

import { useEffect } from "react"
import type { SavedMatch } from "@/lib/game/types"
import { reportGame } from "@/lib/tournaments/board-device"
import type { TournamentExtra } from "@/lib/tournaments/extra"

// The result goes to the tournament the moment the game is won, signed by the board key, once
// per result and again for a corrected one (an Undo and another winning dart). The report runs
// on by itself when the game screen closes right after the winning dart; whatever still fails
// here, the board screen reports when it opens (reportPlayed).
export default function Reporter({ extra, match }: { extra: TournamentExtra; match: SavedMatch }) {
  useEffect(() => {
    void reportGame(extra.id, extra.slot, match).catch(() => {
      // Signing or storing failed: the next change of the game or the board screen tries again.
    })
  }, [extra.id, extra.slot, match])
  return null
}
