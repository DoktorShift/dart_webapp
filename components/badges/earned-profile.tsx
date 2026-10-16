"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { EarnedRow, useReached, type CountedProfile } from "@/components/badges/earned-row"
import { milestoneTexts, problemText } from "@/components/badges/texts"
import { notShownFrom, useOwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile } from "@/components/profile/use-profile"
import { showMilestones } from "@/lib/badges/actions"
import type { MilestoneStatus } from "@/lib/badges/milestones"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { lookupOwnEvents } from "@/lib/profile/own-events"
import type { SlotListProps } from "@/lib/shell/registry"

// The success card for a signed-in profile (./earned-card.tsx loads it only then): the same row
// and sheet as a guest's, and in the sheet the way to show the profile's own new badges in its
// profile. Nothing is published on its own.
export default function ProfileEarned(props: SlotListProps["result.actions"]) {
  const own = useOwnProfile()
  const pubkey = own?.session.pubkey ?? null
  const key = own?.key ?? null
  const sameAs = own?.sameAs
  const counted = useMemo<CountedProfile | null>(() => (pubkey && sameAs ? { pubkey, key, sameAs } : null), [pubkey, key, sameAs])
  const reached = useReached(props.match, counted)
  const badges = useOwnBadges(pubkey)

  // Of the profile's own, what "Im Profil zeigen" still has to publish; null while the
  // profile's badges are being read.
  const missing = useMemo<MilestoneStatus[] | null>(() => {
    const mine = reached.find((r) => r.own)
    if (!pubkey || !mine) return []
    return badges.awards ? notShownFrom(badges, pubkey, mine.statuses, props.match.id) : null
  }, [reached, pubkey, badges, props.match.id])

  const ownSeat = reached.some((r) => r.own)
  return <EarnedRow {...props} reached={reached} action={(open) => (pubkey && ownSeat ? <ShowInProfile open={open} pubkey={pubkey} missing={missing} /> : null)} />
}

// "Im Profil zeigen": all of them in one go, one list, one confirmation (lib/badges/actions.ts
// showMilestones). The status stands in the button's place: the confirmation once published, the
// word that they are in the profile already, else the button, with a problem right above it.
function ShowInProfile({ open, pubkey, missing }: { open: boolean; pubkey: string; missing: MilestoneStatus[] | null }) {
  const tx = useAreaT(BADGES_TEXTS)
  const e = tx.earned
  const [state, setState] = useState<"idle" | "showing" | "shown">("idle")
  const [problem, setProblem] = useState<string | null>(null)

  // Before a change, the profile's list is looked up again (like editing the profile).
  const toShow = missing?.length ?? 0
  useEffect(() => {
    if (open && toShow > 0) void lookupOwnEvents(pubkey, { again: true })
  }, [open, pubkey, toShow])

  const show = async () => {
    if (!missing) return
    setState("showing")
    setProblem(null)
    try {
      const items = missing.flatMap(({ milestone, achieved }) => (achieved ? [{ milestone, achieved, texts: milestoneTexts(tx, milestone) }] : []))
      if ((await showMilestones(pubkey, items, tx.detail.voided)) === "offline") {
        setProblem(problemText(tx, "offline"))
        setState("idle")
      } else setState("shown")
    } catch (error) {
      setProblem(problemText(tx, error))
      setState("idle")
    }
  }

  const slot = "mt-3 min-h-14 shrink-0 items-center xshort:min-h-12"
  return (
    <>
      {problem && (
        <InlineStatus tone="error" className="mt-3 shrink-0">
          {problem}
        </InlineStatus>
      )}
      {state === "shown" ? (
        <InlineStatus tone="success" className={slot}>
          {e.shown}
        </InlineStatus>
      ) : missing?.length === 0 ? (
        <InlineStatus tone="info" className={slot}>
          {e.already}
        </InlineStatus>
      ) : (
        <Button onClick={() => void show()} disabled={!missing || state === "showing"} className="mt-3 h-14 w-full shrink-0 rounded-2xl text-[1.0625rem] font-semibold xshort:h-12">
          {state === "showing" ? e.showing : e.showAll}
        </Button>
      )}
    </>
  )
}
