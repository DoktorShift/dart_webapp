"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { importV1Matches, loadArchive, type ArchivedMatch } from "@/lib/storage/archive"
import { onStorageChange, storageUnavailable } from "@/lib/storage/db"
import { listPlayers, type PlayerRecord } from "@/lib/storage/players"
import { getInitialSaveState, getSaveState, subscribeSaveState } from "@/lib/storage/save-status"
import { V1_KEYS } from "@/lib/storage/v1"

// React access to the stored data. Each hook loads once, then follows changes from this tab and
// from other tabs.

// 1.0.0 results are taken over once per page load (and again when another tab adds one).
let v1Import: Promise<unknown> | null = null

// Keeps only the newest of overlapping loads.
function useLatest<T>(load: () => Promise<T>, apply: (value: T) => void) {
  const counter = useRef(0)
  return () => {
    const id = ++counter.current
    void load().then((value) => {
      if (id === counter.current) apply(value)
    })
  }
}

// Every archived game, newest first (1.0.0 results included).
export function useArchive() {
  const [matches, setMatches] = useState<ArchivedMatch[]>([])
  const [loaded, setLoaded] = useState(false)
  const alive = useRef(true)
  const refresh = useLatest(loadArchive, (value) => {
    if (!alive.current) return
    setMatches(value)
    setLoaded(true)
  })

  useEffect(() => {
    alive.current = true
    refresh()
    v1Import ??= importV1Matches().catch(() => 0)
    const stop = onStorageChange((message) => {
      if (message.type === "change" && message.stores.includes("matches")) refresh()
    })
    // A tab still running 1.0.0 finished a game: take it over.
    const onStorage = (event: StorageEvent) => {
      if (event.key === V1_KEYS.matches || event.key === null) void importV1Matches().catch(() => 0).then(refresh)
    }
    window.addEventListener("storage", onStorage)
    return () => {
      alive.current = false
      stop()
      window.removeEventListener("storage", onStorage)
    }
    // refresh only reads refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { matches, loaded }
}

// The player directory; null until loaded.
export function usePlayers() {
  const [players, setPlayers] = useState<PlayerRecord[] | null>(null)
  const alive = useRef(true)
  const refresh = useLatest(
    () => listPlayers().catch((): PlayerRecord[] => []),
    (value) => alive.current && setPlayers(value),
  )

  useEffect(() => {
    alive.current = true
    refresh()
    const stop = onStorageChange((message) => {
      if (message.type === "change" && message.stores.includes("players")) refresh()
    })
    return () => {
      alive.current = false
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return players
}

export const useSaveState = () => useSyncExternalStore(subscribeSaveState, getSaveState, getInitialSaveState)

// True when this browser can't keep data beyond the open page.
export function useStorageUnavailable() {
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let alive = true
    void storageUnavailable().then((value) => alive && setUnavailable(value))
    return () => {
      alive = false
    }
  }, [])
  return unavailable
}
