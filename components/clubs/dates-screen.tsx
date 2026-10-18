"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { SlotItems } from "@/components/shell/slot-items"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDateTime } from "@/lib/i18n"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { answerCounts } from "@/components/clubs/date-answer"
import { DateFormSheet, DateSheet } from "@/components/clubs/date-sheets"
import { useClub } from "@/components/clubs/use-clubs"
import { isLeader } from "@/lib/clubs/club"
import type { ClubDate } from "@/lib/clubs/dates"
import { nowSeconds } from "@/lib/nostr/time"
import { getSlotItems, type ScreenProps } from "@/lib/shell/registry"

// A date counts as over four hours after its start when it names no end.
const DEFAULT_LENGTH = 4 * 3600

// "Termine & Turniere": the club's dates, coming up and past, each with who is coming; a
// leader enters the next club night. Tournaments come from the tournaments area through the
// registry slot "club.tournaments".
export default function DatesScreen({ params }: ScreenProps) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const { view } = useClub(params.club ?? null)
  const [open, setOpen] = useState<ClubDate | null>(null)
  const [adding, setAdding] = useState(false)
  useRegistryVersion()
  const state = view?.state
  if (!view || !state) return null
  const now = nowSeconds()
  const leader = isLeader(view.me.role) && !state.info.archived
  const over = (d: ClubDate) => (d.ends ?? d.starts + DEFAULT_LENGTH) <= now
  const upcoming = view.dates.filter((d) => !over(d))
  const past = view.dates.filter(over).reverse().slice(0, 10)
  const shown = open ? (view.dates.find((d) => d.id === open.id) ?? open) : null
  const tournaments = getSlotItems("club.tournaments").length > 0
  const row = (d: ClubDate) => (
    <ListRow
      key={d.id}
      title={d.title}
      subtitle={[formatDateTime(t, d.starts * 1000), d.place].filter(Boolean).join(" · ")}
      value={d.cancelled ? tx.dates.cancelled : tx.dates.coming(answerCounts(d).yes, answerCounts(d).maybe)}
      onClick={() => setOpen(d)}
    />
  )

  return (
    <div className="pb-4">
      {leader && (
        <Button onClick={() => setAdding(true)} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {tx.dates.add}
        </Button>
      )}
      <Group title={tx.dates.upcoming}>{upcoming.length === 0 ? <ListRow title={tx.dates.none} subtitle={leader ? tx.dates.noneLeader : undefined} /> : upcoming.map(row)}</Group>
      {past.length > 0 && <Group title={tx.dates.past}>{past.map(row)}</Group>}
      <Group title={tx.dates.tournaments}>
        {tournaments ? <SlotItems list="club.tournaments" props={() => ({ club: view.id, name: params.name ?? "", leader, compact: false })} /> : <ListRow title={t.shell.comingSoon} />}
      </Group>
      <DateSheet view={view} state={state} date={shown} open={shown !== null} onOpenChange={(next) => !next && setOpen(null)} />
      <DateFormSheet state={state} open={adding} onOpenChange={setAdding} />
    </div>
  )
}
