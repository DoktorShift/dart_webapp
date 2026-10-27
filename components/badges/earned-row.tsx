"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Award } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { BadgeIcon } from "@/components/badges/badge-icon"
import { milestoneTexts } from "@/components/badges/texts"
import { ResultRow } from "@/components/shell/result-row"
import { useDismissedFor } from "@/components/shell/use-dismissed-for"
import { evaluateMilestones, reachedIn, type MilestoneStatus } from "@/lib/badges/milestones"
import { BADGES_TEXTS } from "@/lib/i18n/features/badges.screens"
import { useMatchHistory } from "@/lib/leaderboard"
import type { SlotListProps } from "@/lib/shell/registry"
import { isUnnamed } from "@/lib/storage/players"
import { playerKey } from "@/lib/storage/stats"

// The row and sheet of the success card (./earned-card.tsx), as a guest and a profile see them
// alike: worked out from the archive and the milestones only, nothing of the session or relays.
// What a profile adds (showing its own badges in its profile) comes in as the sheet's `action`.

// Games whose card was put away; device-wide, not part of any profile.
const DISMISSED_KEY = "badges.dismissed"

export interface Reached {
  seat: number
  name: string
  // The signed-in profile's own seat.
  own: boolean
  statuses: MilestoneStatus[]
}

// The signed-in profile as the card counts it: its statistics key here and who counts as it
// (lib/profile/claim.ts); null for a guest.
export interface CountedProfile {
  pubkey: string
  key: string | null
  sameAs: Map<string, string>
}

// Every named seat with what the game made its player reach; the profile's seat counts the
// profile's games on this device as one player's.
export function useReached(match: SlotListProps["result.actions"]["match"], own: CountedProfile | null): Reached[] {
  const { all, aliases } = useMatchHistory()
  return useMemo<Reached[]>(() => {
    const archived = all.find((m) => m.id === match.id)
    if (!archived) return []
    return archived.players.flatMap((player, seat) => {
      if (player.unnamed || isUnnamed(player.name)) return []
      const mine = !!own?.key && player.pubkey === own.pubkey
      const key = mine ? own.key : playerKey(archived, player, aliases)
      if (!key) return []
      const statuses = reachedIn(evaluateMilestones(all, key, { aliases, sameAs: mine ? own.sameAs : undefined }), match.id)
      return statuses.length > 0 ? [{ seat, name: player.name.trim(), own: mine, statuses }] : []
    })
  }, [all, aliases, match.id, own])
}

export function EarnedRow({ match, placement, reached, action }: SlotListProps["result.actions"] & { reached: Reached[]; action?: (open: boolean) => ReactNode }) {
  const tx = useAreaT(BADGES_TEXTS)
  const e = tx.earned
  const { dismissed, dismiss } = useDismissedFor(DISMISSED_KEY, match.id)
  const [open, setOpen] = useState(false)
  if (dismissed !== false || reached.length === 0) return null

  const count = reached.reduce((n, r) => n + r.statuses.length, 0)
  const first = reached[0]
  const firstName = milestoneTexts(tx, first.statuses[0].milestone).name
  const label = count > 1 ? e.several(count) : match.players.length > 1 ? e.oneOf(first.name, firstName) : e.one(firstName)

  return (
    <>
      <ResultRow icon={Award} label={label} tone="warning" placement={placement} onClick={() => setOpen(true)} trailing={{ kind: "dismiss", label: e.dismiss, onClick: () => void dismiss() }} />
      <EarnedSheet open={open} onOpenChange={setOpen} reached={reached}>
        {action?.(open)}
      </EarnedSheet>
    </>
  )
}

function EarnedSheet({ open, onOpenChange, reached, children }: { open: boolean; onOpenChange: (open: boolean) => void; reached: Reached[]; children: ReactNode }) {
  const t = useT()
  const tx = useAreaT(BADGES_TEXTS)
  const e = tx.earned
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
                    <span className="min-w-0 flex-1 wrap-anywhere">
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
      {children}
      <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem] xshort:h-11">
        {t.common.done}
      </Button>
    </Sheet>
  )
}
