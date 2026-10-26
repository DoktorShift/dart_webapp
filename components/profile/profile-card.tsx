"use client"

import { useId, type ReactNode } from "react"
import { Avatar } from "@/components/ui/avatar"
import { SlotItems } from "@/components/shell/slot-items"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { fixed } from "@/components/profile/format"
import { formatPercent, type Messages } from "@/lib/i18n"
import type { ProfileTexts } from "@/lib/i18n/features/profile.screens"
import type { PlayerSummary } from "@/lib/storage/stats"
import { cn } from "@/lib/utils"

// The head of a profile, like a sports card: picture, name, a line about it, then its figures
// (children). Own profile, someone's public profile and a player known only on this device all
// look alike; what differs is said in the subtitle. Names wrap, never cut off.
export function ProfileCard({
  seed,
  name,
  placeholder,
  picture,
  subtitle,
  slot,
  action,
  children,
}: {
  // What the drawn picture is made from: the pubkey, or the local player's key.
  seed: string
  name: string | null
  // In place of a missing name: by default "Ohne Namen", or why it is missing (still loading).
  placeholder?: string
  picture?: string | null
  subtitle?: ReactNode
  // Public profiles get the areas' line below the figures ("profile.card": badges, club).
  slot?: { pubkey: string; own: boolean }
  // One quiet action in the head's corner ("Bearbeiten").
  action?: ReactNode
  children?: ReactNode
}) {
  const tx = useAreaT(PROFILE_TEXTS)
  const id = useId()
  return (
    <section aria-labelledby={id} className="mt-6 rounded-2xl border border-border bg-card px-4 py-4">
      <div className="flex items-center gap-4">
        <Avatar seed={seed} name={name ?? undefined} src={picture} size={64} />
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">
            {name ?? placeholder ?? tx.unnamed}
          </h2>
          {subtitle && <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>}
        </div>
        {action && <div className="ml-auto shrink-0 self-start">{action}</div>}
      </div>
      {children}
      {slot && <SlotItems list="profile.card" props={() => slot} className="mt-3 border-t border-border pt-3 empty:hidden" />}
    </section>
  )
}

export interface Figure {
  label: string
  // Formatted; null when it isn't known (shown as "—").
  value: string | null
  detail?: string
}

// Up to three figures side by side, with what they cover (caption). Unknown is "—" and
// explained, never 0 (PLAN.md "Kennzahlen").
export function Figures({ figures, caption }: { figures: Figure[]; caption: ReactNode }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const unknown = figures.some((f) => f.value === null)
  return (
    <>
      <dl aria-label={tx.figures.label} className="mt-4 grid grid-cols-3 border-t border-border pt-3">
        {figures.map((f, i) => (
          <div key={f.label} className={cn("flex min-w-0 flex-col", i > 0 && "border-l border-border pl-3", i < figures.length - 1 && "pr-2")}>
            <dt className="order-2 text-[0.8125rem] leading-snug text-muted-foreground">{f.label}</dt>
            <dd className="order-1 font-display text-3xl font-semibold tabular-nums leading-tight">
              {f.value ?? (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">{tx.figures.unknownShort}</span>
                </>
              )}
            </dd>
            {f.detail && <dd className="order-3 text-[0.8125rem] leading-snug text-muted-foreground">{f.detail}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">{caption}</p>
      {unknown && <p className="mt-1 text-[0.8125rem] leading-snug text-muted-foreground">{tx.figures.unknown}</p>}
    </>
  )
}

// The three figures every darts player knows (proposal 2026-10-26, "Zahlen und Begriffe"):
// points per three darts, the checkout rate (darts at a double), the win rate with its games.
// Only games against others; training never moves them.
export interface SportFigures {
  average: number | null
  checkoutRate: number | null
  // The rate's basis, when known: legs finished of darts thrown at a double.
  checkouts?: number
  dartsAtDouble?: number
  wins: number
  versus: number
}

export function sportFigures(t: Messages, tx: ProfileTexts, s: SportFigures): Figure[] {
  return [
    { label: tx.card.average, value: s.average === null ? null : fixed(t, s.average) },
    { label: tx.card.checkout, value: s.checkoutRate === null ? null : formatPercent(t, s.checkoutRate), detail: s.checkoutRate !== null && s.checkouts !== undefined && s.dartsAtDouble ? tx.card.checkoutDetail(s.checkouts, s.dartsAtDouble) : undefined },
    { label: tx.card.wins, value: s.versus > 0 ? formatPercent(t, s.wins / s.versus) : null, detail: s.versus > 0 ? tx.card.winsDetail(s.wins, s.versus) : undefined },
  ]
}

export const sportFiguresOf = (s: PlayerSummary): SportFigures => ({
  average: s.x01?.average ?? null,
  checkoutRate: s.x01?.checkoutRate ?? null,
  checkouts: s.x01?.checkouts,
  dartsAtDouble: s.x01?.dartsAtDouble,
  wins: s.wins,
  versus: s.versus,
})

// A quiet text button for the card's corner, 44 pt tall.
export function CardAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-mr-2 -mt-1 flex min-h-11 items-center rounded-xl px-2 text-[1.0625rem] font-medium text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/10">
      {label}
    </button>
  )
}
