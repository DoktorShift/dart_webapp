"use client"

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { HandoffSheet, MovedSheet, PlayersSheet, WatchSheet } from "@/components/live/board-sheets"
import type { LiveSheet } from "@/components/live/gate"
import type { SavedMatch } from "@/lib/game/types"
import { attachBoard, boardView, detachBoard, goLive, subscribeBoards, updateBoard } from "@/lib/live/board"

// A live game on its board: follows every change of the game for the spectators and players
// (lib/live/board.ts) and shows the live sheets over the game screen. Adds nothing else to the
// screen; the game itself never waits for any of it.
export default function LiveGame({
  match,
  close,
  sheet,
  onSheetClose,
  onLive,
}: {
  match: SavedMatch
  close: () => void
  sheet: LiveSheet | null
  onSheetClose: () => void
  onLive: () => void
}) {
  const latest = useRef(match)
  const wentLive = useRef(onLive)
  latest.current = match
  wentLive.current = onLive

  useEffect(() => {
    void attachBoard(latest.current).then((live) => {
      if (!live) return
      wentLive.current()
      updateBoard(latest.current)
    })
    return () => detachBoard(latest.current)
  }, [match.id])

  useEffect(() => updateBoard(match), [match])

  const view = useSyncExternalStore(
    subscribeBoards,
    () => boardView(match.id),
    () => null,
  )
  const start = useCallback(async () => {
    await goLive(latest.current)
    wentLive.current()
  }, [])

  const props = { onClose: onSheetClose, match, view, start }
  return (
    <>
      <WatchSheet open={sheet === "watch"} {...props} />
      <PlayersSheet open={sheet === "players"} {...props} />
      <HandoffSheet open={sheet === "handoff"} {...props} closeGame={close} />
      <MovedSheet match={match} view={view} closeGame={close} />
    </>
  )
}
