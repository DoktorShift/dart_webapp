"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { BadgeIcon } from "@/components/badges/badge-icon"
import { awardTexts, problemText } from "@/components/badges/texts"
import { useOwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile } from "@/components/profile/use-profile"
import { arrangeAwards } from "@/lib/badges/actions"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { lookupOwnEvents } from "@/lib/profile/own-events"

// "Anordnen": the order of the badges the profile shows, moved one step at a time with large
// buttons (no dragging needed at a darts night), saved once with one signature.
export default function ArrangeScreen() {
  const tx = useAreaT(BADGES_TEXTS)
  const nav = useNav()
  const own = useOwnProfile()
  const pubkey = own?.session.pubkey ?? ""
  const { shown } = useOwnBadges(pubkey)
  const [order, setOrder] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (pubkey) void lookupOwnEvents(pubkey, { again: true })
  }, [pubkey])
  // The order starts from the list as it is; a badge arriving meanwhile is appended.
  const ids = shown.map((a) => a.award.id)
  const current = order ? [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))] : ids
  if (!own || shown.length === 0) return null
  const byId = new Map(shown.map((a) => [a.award.id, a]))
  const changed = current.some((id, i) => id !== ids[i])

  const move = (index: number, by: -1 | 1) => {
    const next = [...current]
    const [id] = next.splice(index, 1)
    next.splice(index + by, 0, id)
    setOrder(next)
  }

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      if ((await arrangeAwards(pubkey, current)) === "offline") setProblem(problemText(tx, "offline"))
      else nav.pop()
    } catch (error) {
      setProblem(problemText(tx, error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="mt-2 px-1 text-[0.9375rem] text-muted-foreground">{tx.arrange.hint}</p>
      <ol className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {current.map((id, index) => {
          const award = byId.get(id)
          if (!award) return null
          const { name } = awardTexts(tx, award)
          return (
            <li key={id} className="flex min-h-14 items-center gap-3 py-1 pl-4 pr-2">
              <span className="w-5 shrink-0 text-[0.9375rem] tabular-nums text-muted-foreground">{index + 1}</span>
              <BadgeIcon image={award.image} size={32} />
              <span className="min-w-0 flex-1 text-[1.0625rem] leading-snug [overflow-wrap:anywhere]">{name}</span>
              <Button variant="ghost" size="icon" disabled={index === 0 || busy} aria-label={tx.arrange.up(name)} onClick={() => move(index, -1)} className="h-11 w-11 rounded-xl text-primary">
                <ChevronUp className="h-6 w-6" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon" disabled={index === current.length - 1 || busy} aria-label={tx.arrange.down(name)} onClick={() => move(index, 1)} className="h-11 w-11 rounded-xl text-primary">
                <ChevronDown className="h-6 w-6" aria-hidden="true" />
              </Button>
            </li>
          )
        })}
      </ol>
      <Button disabled={!changed || busy} onClick={() => void save()} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {tx.arrange.save}
      </Button>
      {problem && (
        <InlineStatus tone="error" className="mt-3">
          {problem}
        </InlineStatus>
      )}
    </>
  )
}
