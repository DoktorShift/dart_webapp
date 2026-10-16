"use client"

import { useEffect, useMemo, useState } from "react"
import { Award } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { BadgeIcon } from "@/components/badges/badge-icon"
import { milestoneTexts, problemText } from "@/components/badges/texts"
import { notShownFrom, useOwnBadges } from "@/components/badges/use-badges"
import { useOwnProfile } from "@/components/profile/use-profile"
import { ResultRow } from "@/components/shell/result-row"
import { useDismissedFor } from "@/components/shell/use-dismissed-for"
import { showMilestones } from "@/lib/badges/actions"
import { evaluateMilestones, reachedIn, type MilestoneStatus } from "@/lib/badges/milestones"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { useMatchHistory } from "@/lib/leaderboard"
import { lookupOwnEvents } from "@/lib/profile/own-events"
import type { SlotListProps } from "@/lib/shell/registry"
import { isUnnamed } from "@/lib/storage/players"
import { playerKey } from "@/lib/storage/stats"

// The success card on the result of a finished game (registry "result.actions"): one quiet row
// naming what this game made a player reach, worked out from the archive once the game is in it
// (PLAN.md "Auszeichnungen": a small card that can be put away, never interrupting the game).
// A tap shows the badges; a signed-in player can show their own in their profile from there.
// Nothing is published on its own, and a guest's milestones stay "Auf diesem Gerät erreicht".
// The row is the result's shared ResultRow in the warning tone (something worth a look), which
// carries the sizes and placements the result asks of its pieces.

// Games whose card was put away; device-wide, not part of any profile.
const DISMISSED_KEY = "badges.dismissed"

interface Reached {
  seat: number
  name: string
  // The signed-in profile's own seat.
  own: boolean
  statuses: MilestoneStatus[]
}

export default function EarnedCard({ match, placement }: SlotListProps["result.actions"]) {
  const tx = useAreaT(BADGES_TEXTS)
  const e = tx.earned
  const { all, aliases } = useMatchHistory()
  const own = useOwnProfile()
  const badges = useOwnBadges(own?.session.pubkey ?? null)
  const { dismissed, dismiss } = useDismissedFor(DISMISSED_KEY, match.id)
  const [open, setOpen] = useState(false)

  // Every named seat with what the game made its player reach; the profile's seat counts the
  // profile's games on this device as one player's.
  const reached = useMemo<Reached[]>(() => {
    const archived = all.find((m) => m.id === match.id)
    if (!archived) return []
    return archived.players.flatMap((player, seat) => {
      if (player.unnamed || isUnnamed(player.name)) return []
      const mine = !!own?.key && player.pubkey === own.session.pubkey
      const key = mine ? own.key : playerKey(archived, player, aliases)
      if (!key) return []
      const statuses = reachedIn(evaluateMilestones(all, key, { aliases, sameAs: mine ? own.sameAs : undefined }), match.id)
      return statuses.length > 0 ? [{ seat, name: player.name.trim(), own: mine, statuses }] : []
    })
  }, [all, aliases, match.id, own])

  // Of the profile's own, what "Im Profil zeigen" still has to publish; null while the
  // profile's badges are being read.
  const missing = useMemo<MilestoneStatus[] | null>(() => {
    const mine = reached.find((r) => r.own)
    if (!own || !mine) return []
    return badges.awards ? notShownFrom(badges, own.session.pubkey, mine.statuses, match.id) : null
  }, [reached, own, badges, match.id])

  if (dismissed !== false || reached.length === 0) return null

  const count = reached.reduce((n, r) => n + r.statuses.length, 0)
  const first = reached[0]
  const firstName = milestoneTexts(tx, first.statuses[0].milestone).name
  const label = count > 1 ? e.several(count) : match.players.length > 1 ? e.oneOf(first.name, firstName) : e.one(firstName)

  return (
    <>
      <ResultRow icon={Award} label={label} tone="warning" placement={placement} onClick={() => setOpen(true)} trailing={{ kind: "dismiss", label: e.dismiss, onClick: () => void dismiss() }} />
      <EarnedSheet open={open} onOpenChange={setOpen} reached={reached} pubkey={own?.session.pubkey ?? null} missing={missing} />
    </>
  )
}

function EarnedSheet({
  open,
  onOpenChange,
  reached,
  pubkey,
  missing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reached: Reached[]
  pubkey: string | null
  missing: MilestoneStatus[] | null
}) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const e = tx.earned
  const ownSeat = reached.some((r) => r.own)
  const [state, setState] = useState<"idle" | "showing" | "shown">("idle")
  const [problem, setProblem] = useState<string | null>(null)

  // Before a change, the profile's list is looked up again (like editing the profile).
  const toShow = missing?.length ?? 0
  useEffect(() => {
    if (open && pubkey && toShow > 0) void lookupOwnEvents(pubkey, { again: true })
  }, [open, pubkey, toShow])

  // All of them in one go: one list, one confirmation (lib/badges/actions.ts showMilestones).
  const show = async () => {
    if (!pubkey || !missing) return
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

  // The list may be longer than the screen; the status never is, it stands in the button's
  // place: the confirmation once published, the word that they are in the profile already, else
  // the button, with a problem right above it.
  const slot = "mt-3 min-h-14 shrink-0 items-center xshort:min-h-12"
  const action =
    pubkey && ownSeat ? (
      state === "shown" ? (
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
      )
    ) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={e.title} description={e.description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {reached.map((r) => (
          <section key={r.seat} className="mt-2 first:mt-0">
            {reached.length > 1 && <h3 className="mb-2 px-1 text-[0.8125rem] text-muted-foreground">{r.name}</h3>}
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {r.statuses.map(({ milestone }) => {
                const words = milestoneTexts(tx, milestone)
                return (
                  <li key={milestone.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                    <BadgeIcon size={36} />
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      <span className="block text-[1.0625rem] leading-snug">{words.name}</span>
                      <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">{words.description}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      {problem && (
        <InlineStatus tone="error" className="mt-3 shrink-0">
          {problem}
        </InlineStatus>
      )}
      {action}
      <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem] xshort:h-11">
        {t.common.done}
      </Button>
    </Sheet>
  )
}
