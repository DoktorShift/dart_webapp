"use client"

import { useState } from "react"
import { Group } from "@/components/ui/group"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useAreaT } from "@/components/i18n-provider"
import { EntryDetail } from "@/components/payments/entry-detail"
import { groupByDay, useEntryGames } from "@/components/payments/entry-game"
import { EntryRow, entryLabel, entryTitle } from "@/components/payments/entry-status"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { useJournal } from "@/lib/payments/hooks"

// Zahlungen › Alle Zahlungen: every payment made on this device, by day, each with its game.
export default function HistoryScreen() {
  const p = useAreaT(PAYMENTS_TEXTS)
  const journal = useJournal()
  const { game, day } = useEntryGames()
  const [openId, setOpenId] = useState<string | null>(null)
  if (journal === undefined) return null
  const entry = openId ? journal.find((e) => e.id === openId) : undefined
  return (
    <>
      {groupByDay(journal, day).map((group) => (
        <Group key={group.label} title={group.label}>
          {group.entries.map((item) => (
            <EntryRow key={item.id} entry={item} title={entryLabel(p, item, game(item).text)} onClick={() => setOpenId(item.id)} />
          ))}
        </Group>
      ))}
      <Sheet open={entry !== undefined} onOpenChange={(next) => !next && setOpenId(null)} title={entry ? entryTitle(p, entry) : ""}>
        <SheetBody>{entry && <EntryDetail entry={entry} onDone={() => setOpenId(null)} />}</SheetBody>
      </Sheet>
    </>
  )
}
