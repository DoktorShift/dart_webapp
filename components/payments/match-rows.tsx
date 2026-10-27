"use client"

import { useState } from "react"
import { Group } from "@/components/ui/group"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { EntryDetail } from "@/components/payments/entry-detail"
import { EntryRow, entryLabel, entryTitle } from "@/components/payments/entry-status"
import { PAYMENTS_TEXTS } from "@/lib/i18n/features/payments.screens"
import { describeAction } from "@/lib/payments/actions"
import { useJournal } from "@/lib/payments/hooks"
import type { SlotListProps } from "@/lib/shell/registry"

// A finished game in the archive ("match.rows"): the payments that belong to it (its stake, a
// payment or a congratulation after it), each opening its detail. Nothing when it has none.
export default function MatchPayments({ matchId }: SlotListProps["match.rows"]) {
  const t = useT()
  const tx = useAreaT(PAYMENTS_TEXTS)
  const journal = useJournal()
  const [openId, setOpenId] = useState<string | null>(null)
  const entries = journal?.filter((entry) => describeAction(entry.action).matchId === matchId) ?? []
  if (entries.length === 0) return null
  const entry = openId ? entries.find((e) => e.id === openId) : undefined
  return (
    <>
      <Group title={t.payments.title}>
        {entries.map((item) => (
          <EntryRow key={item.id} entry={item} title={entryLabel(tx, item, null)} onClick={() => setOpenId(item.id)} />
        ))}
      </Group>
      <Sheet open={entry !== undefined} onOpenChange={(next) => !next && setOpenId(null)} title={entry ? entryTitle(tx, entry) : ""}>
        <SheetBody>{entry && <EntryDetail entry={entry} onDone={() => setOpenId(null)} />}</SheetBody>
      </Sheet>
    </>
  )
}
