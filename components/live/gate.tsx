"use client"

import { lazy, useEffect, useState, useSyncExternalStore } from "react"
import type { SavedMatch } from "@/lib/game/types"
import { loadBoard } from "@/lib/live/store"
import type { FinishedMatch } from "@/lib/shell/registry"

// The always-loaded part of the live area on the game screen: it decides whether the live code
// is needed at all. A game that was never made live, the guest's usual game, costs one small
// read from the device's database and nothing else: no live code, no connection.

export type LiveSheet = "watch" | "players" | "handoff"

// Which live sheet the game menu asked for, by game.
let requested: { match: string; sheet: LiveSheet } | null = null
const listeners = new Set<() => void>()
function setRequested(next: typeof requested) {
  requested = next
  for (const listener of listeners) listener()
}

export const openLiveSheet = (match: string, sheet: LiveSheet) => setRequested({ match, sheet })

function useRequestedSheet(match: string): LiveSheet | null {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => requested,
    () => null,
  )
  return current?.match === match ? current.sheet : null
}

// Whether this game is live on this device (a board record exists for it).
function useLiveHere(match: string): [boolean, () => void] {
  const [live, setLive] = useState(false)
  useEffect(() => {
    let current = true
    void loadBoard(match).then(
      (record) => current && setLive(record !== null),
      () => {},
    )
    return () => {
      current = false
    }
  }, [match])
  return [live, () => setLive(true)]
}

const LiveGame = lazy(() => import("@/components/live/live-game"))
const Confirmations = lazy(() => import("@/components/live/confirmations"))

// "game.attachments": the live game with its sheets, once the game is live or a sheet is asked for.
export function LiveGate({ match, close }: { match: SavedMatch; close: () => void }) {
  const sheet = useRequestedSheet(match.id)
  const [live, wentLive] = useLiveHere(match.id)
  if (!live && !sheet) return null
  return <LiveGame match={match} close={close} sheet={sheet} onSheetClose={() => setRequested(null)} onLive={wentLive} />
}

// "result.actions": the players' verdicts on a live game's result.
export function LiveResultGate({ match }: { match: FinishedMatch }) {
  const [live] = useLiveHere(match.id)
  return live ? <Confirmations match={match} /> : null
}
