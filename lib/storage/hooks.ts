"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { importV1Matches, loadArchive, type ArchivedMatch } from "@/lib/storage/archive"
import { onStorageChange, storageUnavailable, type StoreName } from "@/lib/storage/db"
import { listPlayers, type PlayerRecord } from "@/lib/storage/players"
import { getInitialSaveState, getSaveState, subscribeSaveState } from "@/lib/storage/save-status"
import { V1_KEYS } from "@/lib/storage/v1"

// React access to the stored data. Each hook loads once, then follows changes from this tab and
// from other tabs.

// A value read from the database: read now, and again whenever one of `stores` changes in any tab
// or all data is deleted. Only the newest of overlapping reads counts. `load` must not reject, and
// both arguments stay the same for the component's life. Returns the value (undefined until the
// first read) and `reload`, for changes the database doesn't announce.
export function useStored<T>(stores: StoreName | readonly StoreName[], load: () => Promise<T>) {
  const [value, setValue] = useState<T | undefined>(undefined)
  const latest = useRef(0)
  const alive = useRef(false)
  const reload = useCallback(() => {
    const id = ++latest.current
    void load().then((next) => {
      if (alive.current && id === latest.current) setValue(next)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    alive.current = true
    reload()
    const watched: readonly StoreName[] = typeof stores === "string" ? [stores] : stores
    const stop = onStorageChange((message) => {
      if (message.type === "wipe" || message.stores.some((store) => watched.includes(store))) reload()
    })
    return () => {
      alive.current = false
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [value, reload] as const
}

// 1.0.0 results are taken over once per page load (and again when another tab adds one).
let v1Import: Promise<unknown> | null = null

const NO_MATCHES: ArchivedMatch[] = []

// Every archived game, newest first (1.0.0 results included).
export function useArchive() {
  const [matches, reload] = useStored("matches", loadArchive)

  useEffect(() => {
    v1Import ??= importV1Matches().catch(() => 0)
    // A tab still running 1.0.0 finished a game: take it over. Read again also when the database
    // couldn't take it, so the game shows from the 1.0.0 history.
    const onStorage = (event: StorageEvent) => {
      if (event.key === V1_KEYS.matches || event.key === null) void importV1Matches().catch(() => 0).then(reload)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [reload])

  return { matches: matches ?? NO_MATCHES, loaded: matches !== undefined }
}

const loadPlayers = () => listPlayers().catch((): PlayerRecord[] => [])

// The player directory; null until loaded.
export const usePlayers = (): PlayerRecord[] | null => useStored("players", loadPlayers)[0] ?? null

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
