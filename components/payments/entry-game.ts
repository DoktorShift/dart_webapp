"use client"

import { useCallback } from "react"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDate, modeName } from "@/lib/i18n"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { describeAction } from "@/lib/payments/actions"
import type { PaymentEntry } from "@/lib/payments/journal"
import type { ArchivedMatch } from "@/lib/storage/archive"
import { useArchive } from "@/lib/storage/hooks"

// A payment and its game: the archived game a payment's action names (lib/payments/actions.ts),
// and the words for it ("301 gegen Ben"), for lists and the detail. Also the day a payment
// belongs to, as lists group them ("Heute", "Gestern", the date).
export function useEntryGames() {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const { matches, loaded } = useArchive()
  const game = useCallback(
    (entry: PaymentEntry): { matchId: string | null; match: ArchivedMatch | null; text: string | null } => {
      const { matchId } = describeAction(entry.action)
      if (!matchId) return { matchId: null, match: null, text: null }
      const match = matches.find((m) => m.id === matchId) ?? null
      if (!match) return { matchId, match: null, text: null }
      const mode = modeName(t, match.modeId, match.modeName)
      return { matchId, match, text: entry.counterpart.name ? tx.entry.game(mode, entry.counterpart.name) : mode }
    },
    [matches, t, tx],
  )
  const day = useCallback(
    (ms: number) => {
      const date = new Date(ms)
      const now = new Date()
      if (date.toDateString() === now.toDateString()) return tx.home.today
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      if (date.toDateString() === yesterday.toDateString()) return tx.home.yesterday
      return formatDate(t, ms)
    },
    [t, tx],
  )
  return { game, day, loaded }
}

// Payments in the order they stand, grouped by the day they last changed.
export function groupByDay(entries: readonly PaymentEntry[], day: (ms: number) => string): { label: string; entries: PaymentEntry[] }[] {
  const groups: { label: string; entries: PaymentEntry[] }[] = []
  for (const entry of entries) {
    const label = day(entry.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}
