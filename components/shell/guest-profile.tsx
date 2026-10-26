"use client"

import { useMemo, useState } from "react"
import { ArchiveRestore, AppWindow, Info, Settings, Smartphone } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { Sheet } from "@/components/ui/sheet"
import { FitText } from "@/components/fit-text"
import { SlotItems } from "@/components/shell/slot-items"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { computeStandings, useMatchHistory } from "@/lib/leaderboard"
import { SCREENS, runAction, type ShellAction } from "@/lib/shell/registry"

// Who plays here, as far as this device knows: the number of finished games and who has won
// most of them. Nothing is shown until the history has been read, so it never flashes a 0.
function DeviceCard() {
  const t = useT()
  const { matches, loaded } = useMatchHistory()
  const leader = useMemo(() => computeStandings(matches, { sortBy: "wins", minGames: 1 }).ranked.find((s) => s.wins > 0) ?? null, [matches])

  return (
    <section aria-labelledby="guest-name" className="mt-6 rounded-2xl border border-border bg-card px-4 py-4">
      <div className="flex items-center gap-4">
        <Avatar seed="blueline-guest" size={64} />
        <div className="min-w-0">
          <h2 id="guest-name" className="text-xl font-semibold leading-tight">
            {t.profile.guest.name}
          </h2>
          <p className="mt-0.5 text-[0.9375rem] text-muted-foreground">{t.profile.guest.onDevice}</p>
        </div>
      </div>

      {loaded &&
        (matches.length === 0 ? (
          <p className="mt-4 border-t border-border pt-3 text-[0.9375rem] leading-snug text-muted-foreground">{t.profile.guest.noGames}</p>
        ) : (
          <dl aria-label={t.profile.guest.stats} className="mt-4 grid grid-cols-2 border-t border-border pt-3">
            <div className="flex min-w-0 flex-col pr-3">
              <dt className="order-2 text-[0.8125rem] text-muted-foreground">{t.profile.guest.games(matches.length)}</dt>
              <dd className="order-1 font-display text-3xl font-semibold tabular-nums leading-tight">{matches.length}</dd>
            </div>
            {leader && (
              <div className="flex min-w-0 flex-col border-l border-border pl-4">
                <dt className="order-2 text-[0.8125rem] text-muted-foreground">{t.profile.guest.mostWins}</dt>
                <dd className="order-1 font-display text-3xl font-semibold tabular-nums leading-tight">{leader.wins}</dd>
                <dd className="order-3 text-[0.9375rem] font-medium leading-snug">
                  <FitText minScale={0.8}>{leader.name}</FitText>
                </dd>
              </div>
            )}
          </dl>
        ))}
    </section>
  )
}

const EXISTING: { action: ShellAction; icon: typeof Smartphone; title: "fromDevice" | "fromBackup" | "fromApp"; hint: "fromDeviceHint" | "fromBackupHint" | "fromAppHint" }[] = [
  { action: SCREENS.profileFromDevice, icon: Smartphone, title: "fromDevice", hint: "fromDeviceHint" },
  { action: SCREENS.profileFromBackup, icon: ArchiveRestore, title: "fromBackup", hint: "fromBackupHint" },
  { action: SCREENS.profileFromApp, icon: AppWindow, title: "fromApp", hint: "fromAppHint" },
]

// The Profile tab for a guest: this device's results, a quiet offer to take them along, and
// Settings and About, which never need a profile. No sign-in wall: everything here is optional.
export function GuestProfile() {
  const t = useT()
  const nav = useNav()
  const [existingOpen, setExistingOpen] = useState(false)

  const choose = (action: ShellAction) => {
    setExistingOpen(false)
    runAction(action, nav)
  }

  return (
    <>
      <DeviceCard />

      <section aria-label={t.profile.guest.create} className="mt-4 rounded-2xl border border-border bg-card/70 px-4 pb-2 pt-4">
        <p className="text-[1.0625rem] leading-snug">{t.profile.guest.createText}</p>
        {/* Tinted, not filled: an offer, never pressure (PLAN.md, unobtrusive profile creation). */}
        <Button
          variant="secondary"
          onClick={() => runAction(SCREENS.profileCreate, nav)}
          className="mt-4 h-12 w-full whitespace-normal rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20"
        >
          {t.profile.guest.create}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setExistingOpen(true)}
          className="mt-1 h-11 w-full whitespace-normal rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary"
        >
          {t.profile.guest.haveProfile}
        </Button>
      </section>

      <Group>
        {/* Areas' rows that work without a profile too (registry "profile.rows", "profile.account"). */}
        <SlotItems list="profile.rows" props={() => ({})} />
        <SlotItems list="profile.account" props={() => ({})} />
        <ListRow icon={Settings} iconTone="gray" title={t.settings.title} onClick={() => nav.push(SCREENS.settings)} />
        <ListRow icon={Info} iconTone="blue" title={t.nav.about} onClick={() => nav.push(SCREENS.about)} />
      </Group>

      <Sheet open={existingOpen} onOpenChange={setExistingOpen} title={t.profile.guest.existingTitle} description={t.profile.guest.existingDescription}>
        {/* Scrolls on its own where the sheet is short (phones in landscape); Cancel stays visible. */}
        <div className="min-h-0 overflow-y-auto overscroll-contain rounded-2xl">
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {EXISTING.map(({ action, icon, title, hint }) => (
              <ListRow key={action} icon={icon} title={t.profile.guest[title]} subtitle={t.profile.guest[hint]} onClick={() => choose(action)} />
            ))}
          </div>
        </div>
        <Button variant="ghost" onClick={() => setExistingOpen(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </Sheet>
    </>
  )
}
