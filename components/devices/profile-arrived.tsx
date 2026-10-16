"use client"

import { useEffect } from "react"
import { AppWindow, CircleCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar } from "@/components/ui/avatar"
import { EmptyState } from "@/components/ui/empty-state"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { HistoryProgress } from "@/components/devices/history-progress"
import { useOwnProfile, useProfileGames } from "@/components/profile/use-profile"
import { BACKUP_TEXTS } from "@/lib/i18n/features/backup.screens"
import { deviceName } from "@/lib/devices/device-name"
import type { Applied } from "@/lib/recovery/package"
import { SCREENS } from "@/lib/shell/registry"
import { useSyncStatus } from "@/lib/sync/status"

// The end of a pairing or a restore on the new device: whose profile is here now, its games on
// their way, and this device writing itself into the profile's device list. A profile that
// lives in a signer app isn't here yet: the signer app is connected next.
export function ProfileArrived({ applied }: { applied: Applied }) {
  const a = useAreaT(BACKUP_TEXTS).arrived
  const nav = useNav()
  if (applied.access === "signer") return <EmptyState icon={AppWindow} title={a.signerTitle} description={a.signerText} primary={{ label: a.signerConnect, onClick: () => nav.replaceTop(SCREENS.profileFromApp) }} />
  return <Arrived pubkey={applied.session.pubkey} />
}

function Arrived({ pubkey }: { pubkey: string }) {
  const a = useAreaT(BACKUP_TEXTS).arrived
  const nav = useNav()
  const own = useOwnProfile()
  const games = useProfileGames(own)
  const sync = useSyncStatus()
  const synced = sync.pubkey === pubkey && sync.endedAt !== null && !sync.running

  // Once the first sync here fixed this device's id; if the list can't be written now,
  // Profil › Geräte does it when it opens next (lib/devices/list.ts).
  useEffect(() => {
    if (synced) void import("@/lib/devices/list").then(({ addThisDevice }) => addThisDevice(pubkey, deviceName())).catch(() => {})
  }, [synced, pubkey])

  const name = own?.name ?? null
  return (
    <div className="mx-auto mt-6 flex max-w-sm flex-col items-center text-center xshort:mt-2">
      <span className="relative xshort:hidden">
        <Avatar seed={pubkey} name={name ?? undefined} src={own?.metadata.picture} size={72} />
        <CircleCheck className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-background text-success" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-xl xshort:mt-0 font-semibold leading-tight [overflow-wrap:anywhere]">{name ? a.done(name) : a.doneUnnamed}</h2>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{a.doneText}</p>
      <div className="mt-4 w-full empty:hidden">
        <HistoryProgress pubkey={pubkey} games={games.length} />
      </div>
      <Button onClick={() => nav.popToRoot("profile")} className="mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {a.finish}
      </Button>
    </div>
  )
}
