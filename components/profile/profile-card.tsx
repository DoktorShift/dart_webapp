"use client"

import { useId, type ReactNode } from "react"
import { Avatar } from "@/components/ui/avatar"
import { SlotItems } from "@/components/shell/slot-items"
import { useT } from "@/components/i18n-provider"
import { formatNumber, type Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// The head of a profile, like a sports card: picture, name, a line about it, then its figures
// (children). Own profile, someone's public profile and a player known only on this device all
// look alike; what differs is said in the subtitle. Names wrap, never cut off.
export function ProfileCard({
  seed,
  name,
  picture,
  subtitle,
  slot,
  children,
}: {
  // What the drawn picture is made from: the pubkey, or the local player's key.
  seed: string
  name: string | null
  picture?: string | null
  subtitle?: ReactNode
  // Public profiles get the areas' line below the figures ("profile.card": badges, club).
  slot?: { pubkey: string; own: boolean }
  children?: ReactNode
}) {
  const t = useT()
  const id = useId()
  return (
    <section aria-labelledby={id} className="mt-6 rounded-2xl border border-border bg-card px-4 py-4">
      <div className="flex items-center gap-4">
        <Avatar seed={seed} name={name ?? undefined} src={picture} size={64} />
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">
            {name ?? t.profile.unnamed}
          </h2>
          {subtitle && <p className="mt-0.5 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p>}
        </div>
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
  const t = useT()
  const unknown = figures.some((f) => f.value === null)
  return (
    <>
      <dl aria-label={t.profile.figures.label} className="mt-4 grid grid-cols-3 border-t border-border pt-3">
        {figures.map((f, i) => (
          <div key={f.label} className={cn("flex min-w-0 flex-col", i > 0 && "border-l border-border pl-3", i < figures.length - 1 && "pr-2")}>
            <dt className="order-2 text-[0.8125rem] leading-snug text-muted-foreground">{f.label}</dt>
            <dd className="order-1 font-display text-3xl font-semibold tabular-nums leading-tight">
              {f.value ?? (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">{t.profile.figures.unknownShort}</span>
                </>
              )}
            </dd>
            {f.detail && <dd className="order-3 text-[0.8125rem] leading-snug text-muted-foreground">{f.detail}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">
        {caption}
        {unknown && ` ${t.profile.figures.unknown}`}
      </p>
    </>
  )
}

// The three X01 figures of a profile (PLAN.md: Spiele, Gewonnen, Ø Punkte pro 3 Darts), from
// raw counts: this device's archive or a shared stats card. Wins exist only against others.
export function x01Figures(t: Messages, x: { games: number; versus: number; wins: number; points: number; darts: number }): Figure[] {
  return [
    { label: t.profile.figures.games, value: formatNumber(t, x.games) },
    {
      label: t.profile.figures.won,
      value: x.versus > 0 ? formatNumber(t, x.wins) : null,
      detail: x.versus > 0 && x.versus < x.games ? t.profile.figures.ofVersus(x.versus) : undefined,
    },
    { label: t.profile.figures.average, value: x.darts > 0 ? formatNumber(t, Math.round((x.points / x.darts) * 30) / 10) : null },
  ]
}
