"use client"

import { lazy, useEffect, useState, useSyncExternalStore } from "react"
import type { SavedMatch } from "@/lib/game/types"
import { listBoards, loadBoard, recentJoined, type JoinedRecord } from "@/lib/live/store"
import type { FinishedMatch } from "@/lib/shell/registry"
import { onStorageChange } from "@/lib/storage/db"

// The always-loaded part of the live area on the game screen and the Play tab: it decides
// whether the live code is needed at all. A game that was never made live, the guest's usual
// game, costs one small read from the device's database and nothing else: no live code, no
// connection. The same for a device that never joined a board.

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

// Records of an earlier live game that never reached a relay (the app was closed right after
// it): sent now that a game is on the screen again.
function useLeftoverBoards(match: string) {
  useEffect(() => {
    void listBoards().then(
      (records) => {
        if (records.some((r) => r.local !== match)) void import("@/lib/live/board").then((board) => board.settleBoards(match))
      },
      () => {},
    )
  }, [match])
}

// The seats this phone holds at boards, read once and again whenever the records change.
function useJoinedSeats(): JoinedRecord[] {
  const [records, setRecords] = useState<JoinedRecord[]>([])
  useEffect(() => {
    let current = true
    const load = () => void recentJoined().then((found) => current && setRecords(found), () => {})
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "wipe" || message.stores.includes("pending")) load()
    })
    return () => {
      current = false
      stop()
    }
  }, [])
  return records
}

const LiveGame = lazy(() => import("@/components/live/live-game"))
const Confirmations = lazy(() => import("@/components/live/confirmations"))
const JoinedRows = lazy(() => import("@/components/live/joined-rows"))

// "game.attachments": the live game with its sheets, once the game is live or a sheet is asked for.
export function LiveGate({ match, close }: { match: SavedMatch; close: () => void }) {
  const sheet = useRequestedSheet(match.id)
  const [live, wentLive] = useLiveHere(match.id)
  useLeftoverBoards(match.id)
  if (!live && !sheet) return null
  return <LiveGame match={match} close={close} sheet={sheet} onSheetClose={() => setRequested(null)} onLive={wentLive} />
}

// "result.actions": the players' verdicts on a live game's result.
export function LiveResultGate({ match }: { match: FinishedMatch }) {
  const [live] = useLiveHere(match.id)
  return live ? <Confirmations match={match} /> : null
}

// "play.rows": the way back to a seat at a board, once this phone holds one.
export function JoinedGate() {
  const records = useJoinedSeats()
  return records.length > 0 ? <JoinedRows records={records} /> : null
}
