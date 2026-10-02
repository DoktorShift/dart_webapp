"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Info, Settings, Target, Trophy } from "lucide-react"
import { useT } from "@/components/i18n-provider"
import type { Messages } from "@/lib/i18n"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"

export type Tab = "play" | "leaderboard" | "settings"

const TABS: { id: Tab; label: (t: Messages) => string; icon: typeof Target }[] = [
  { id: "play", label: (t) => t.nav.play, icon: Target },
  { id: "leaderboard", label: (t) => t.nav.leaderboard, icon: Trophy },
  { id: "settings", label: (t) => t.nav.settings, icon: Settings },
]

// Top-level navigation, following the HIG: a tab bar at the bottom on phones and iPads in
// portrait, a sidebar on wide screens (iPad in landscape, desktop). Games hide both.
export function AppShell({ tab, onTabChange, children }: { tab: Tab; onTabChange: (tab: Tab) => void; children: ReactNode }) {
  const t = useT()
  return (
    <div className="absolute inset-0 flex flex-col lg:flex-row">
      <nav
        aria-label={t.nav.sections}
        className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-card/40 pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:flex"
      >
        <p className="px-5 pb-4 pt-6 font-display text-2xl font-semibold tracking-tight">{SITE.name}</p>
        <ul className="space-y-1 px-3">
          {TABS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onTabChange(id)}
                aria-current={tab === id ? "page" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[1.0625rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === id ? "bg-primary font-semibold text-primary-foreground" : "text-foreground hover:bg-secondary/60",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label(t)}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-auto px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <Link
            href="/about"
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[1.0625rem] text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-5 w-5" aria-hidden="true" />
            {t.nav.about}
          </Link>
        </div>
      </nav>

      <main className="relative min-h-0 min-w-0 flex-1">{children}</main>

      <nav
        aria-label={t.nav.sections}
        className="shrink-0 border-t border-border/70 bg-background/85 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto grid h-[3.0625rem] max-w-xl grid-cols-3 xshort:h-10">
          {TABS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onTabChange(id)}
                aria-current={tab === id ? "page" : undefined}
                className={cn(
                  "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[0.625rem] font-medium transition-colors xshort:flex-row xshort:gap-1.5 xshort:text-[0.8125rem]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  tab === id ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-6 w-6 xshort:h-5 xshort:w-5" aria-hidden="true" />
                {label(t)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
