"use client"

import { useEffect, useState } from "react"
import { kvGet, kvSet } from "@/lib/storage/db"

// A result row that was put away for a game ("Später", an X): the games are kept under `kvKey`
// in the device's database, newest last, the last 50 of them, device-wide and not part of any
// profile. `dismissed` is null until the database has answered, so a row shows only once it
// knows it wasn't put away; `dismiss` hides the row at once and remembers the game.
const REMEMBERED = 50

export function useDismissedFor(kvKey: string, matchId: string): { dismissed: boolean | null; dismiss: () => Promise<void> } {
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    kvGet<string[]>(kvKey).then(
      (ids) => alive && setDismissed(!!ids?.includes(matchId)),
      () => alive && setDismissed(false),
    )
    return () => {
      alive = false
    }
  }, [kvKey, matchId])

  const dismiss = async () => {
    setDismissed(true)
    const ids = (await kvGet<string[]>(kvKey).catch(() => undefined)) ?? []
    await kvSet(kvKey, [...ids.filter((id) => id !== matchId), matchId].slice(-REMEMBERED)).catch(() => {})
  }

  return { dismissed, dismiss }
}
