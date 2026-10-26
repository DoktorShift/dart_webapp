"use client"

import type { ReactNode } from "react"
import { CircleUserRound, Medal, Target, Trophy, Users } from "lucide-react"
import { FitText } from "@/components/fit-text"
import { useRegistryVersion } from "@/components/nav/use-registry"
import { SlotItems } from "@/components/shell/slot-items"
import { useT } from "@/components/i18n-provider"
import type { Messages } from "@/lib/i18n"
import type { TabId } from "@/lib/shell/nav"
import { getSlot } from "@/lib/shell/registry"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"

export type Tab = TabId

const TABS: { id: Tab; label: (t: Messages) => string; icon: typeof Target }[] = [
  { id: "play", label: (t) => t.shell.tabs.play, icon: Target },
  { id: "leaderboard", label: (t) => t.shell.tabs.leaderboard, icon: Trophy },
  { id: "clubs", label: (t) => t.shell.tabs.clubs, icon: Users },
  { id: "tournaments", label: (t) => t.shell.tabs.tournaments, icon: Medal },
  { id: "profile", label: (t) => t.shell.tabs.profile, icon: CircleUserRound },
]

// The tab's symbol. The profile area can show the player's own picture there (slot
// "profile.tabIcon"), falling back to the standard symbol. An area with something waiting for
// the person under a tab puts its count on the symbol ("tab.badges"); its words are the tab
// button's description (badgeId), so the tab keeps its name.
function TabIcon({ id, icon: Icon, selected, className, badgeId }: { id: Tab; icon: typeof Target; selected: boolean; className: string; badgeId: string }) {
  useRegistryVersion()
  const symbol = <Icon className={className} strokeWidth={selected ? 2.25 : 1.75} aria-hidden="true" />
  const Slot = id === "profile" ? getSlot("profile.tabIcon") : undefined
  return (
    <span className="relative inline-flex shrink-0">
      {Slot ? <Slot fallback={symbol} /> : symbol}
      <SlotItems list="tab.badges" props={() => ({ tab: id, id: badgeId })} />
    </span>
  )
}

// Top-level navigation, following the HIG: a tab bar at the bottom on phones and iPads in
// portrait, a sidebar on wide screens (iPad in landscape, desktop). Game setup and games hide
// both. The open tab is marked by colour, a heavier symbol and bold text, and for VoiceOver. On
// phones the bar floats as a glass capsule above the page's edge (iOS 26); in landscape, where
// every point of height counts, it sits flush.
// `accessory` sits above the tab bar (and under the sidebar's list): the game that waits.
export function AppShell({ tab, onTabChange, accessory, children }: { tab: Tab; onTabChange: (tab: Tab) => void; accessory?: ReactNode; children: ReactNode }) {
  const t = useT()
  return (
    <div className="absolute inset-0 flex flex-col lg:flex-row">
      <nav
        aria-label={t.nav.sections}
        className="hidden w-64 shrink-0 flex-col border-r border-border/70 bg-card/40 pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:flex"
      >
        <p className="px-5 pb-4 pt-6 font-display text-2xl font-semibold tracking-tight">{SITE.name}</p>
        <ul className="space-y-1 px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {TABS.map(({ id, label, icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onTabChange(id)}
                aria-current={tab === id ? "page" : undefined}
                aria-describedby={`tab-badge-side-${id}`}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[1.0625rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === id ? "bg-primary font-semibold text-primary-foreground" : "text-foreground hover:bg-secondary/60",
                )}
              >
                <TabIcon id={id} icon={icon} selected={tab === id} className="h-5 w-5 shrink-0" badgeId={`tab-badge-side-${id}`} />
                {label(t)}
              </button>
            </li>
          ))}
        </ul>
        {accessory && <div className="mt-auto px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">{accessory}</div>}
      </nav>

      <main className="relative min-h-0 min-w-0 flex-1">{children}</main>

      <nav
        aria-label={t.nav.sections}
        className="shrink-0 pb-[max(env(safe-area-inset-bottom),0.625rem)] pl-[max(env(safe-area-inset-left),0.75rem)] pr-[max(env(safe-area-inset-right),0.75rem)] pt-1.5 lg:hidden xshort:border-t xshort:border-border/70 xshort:bg-background/85 xshort:p-0 xshort:pb-[env(safe-area-inset-bottom)] xshort:pl-[env(safe-area-inset-left)] xshort:pr-[env(safe-area-inset-right)] xshort:backdrop-blur-xl"
      >
        {accessory}
        <ul className="mx-auto grid h-[3.0625rem] max-w-2xl grid-cols-5 rounded-[1.625rem] border border-border/70 bg-background/80 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.45)] backdrop-blur-2xl xshort:h-11 xshort:rounded-none xshort:border-0 xshort:bg-transparent xshort:shadow-none xshort:backdrop-blur-none">
          {TABS.map(({ id, label, icon }) => (
            <li key={id} className="min-w-0">
              <button
                type="button"
                onClick={() => onTabChange(id)}
                aria-current={tab === id ? "page" : undefined}
                aria-describedby={`tab-badge-bar-${id}`}
                className={cn(
                  "flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[1.625rem] px-0.5 text-[0.625rem] transition-colors xshort:flex-row xshort:gap-1.5 xshort:rounded-none xshort:text-[0.8125rem]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  tab === id ? "font-semibold text-primary" : "font-medium text-muted-foreground",
                )}
              >
                <TabIcon id={id} icon={icon} selected={tab === id} className="h-6 w-6 shrink-0 xshort:h-5 xshort:w-5" badgeId={`tab-badge-bar-${id}`} />
                {/* A fixed line height: a label shrunk to fit ("Leaderboard") stays on the same line as the others. */}
                <span className="w-full min-w-0 xshort:w-auto">
                  <FitText minScale={0.75} className="text-center leading-[0.78rem] xshort:leading-tight">
                    {label(t)}
                  </FitText>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
