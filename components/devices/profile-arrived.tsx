"use client"

import { useEffect } from "react"
import { AppWindow } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { HistoryProgress } from "@/components/devices/history-progress"
import { BACKUP_TEXTS } from "@/lib/i18n/features/backup.screens"
import { deviceName } from "@/lib/devices/device-name"
import type { Applied } from "@/lib/recovery/package"
import { SCREENS } from "@/lib/shell/registry"

// The end of a pairing or a restore on the new device: the profile is here, its games are on
// their way, and this device writes itself into the profile's device list. A profile that
// lives in a signer app isn't here yet: the signer app is connected next.
export function ProfileArrived({ applied }: { applied: Applied }) {
  const a = useAreaT(BACKUP_TEXTS).arrived
  const nav = useNav()
  const pubkey = applied.access === "local" ? applied.session.pubkey : null

  useEffect(() => {
    if (!pubkey) return
    // Not now, then when Profil › Geräte opens next (lib/devices/list.ts).
    void import("@/lib/devices/list").then(({ addThisDevice }) => addThisDevice(pubkey, deviceName())).catch(() => {})
  }, [pubkey])

  if (applied.access === "signer") return <EmptyState icon={AppWindow} title={a.signerTitle} description={a.signerText} primary={{ label: a.signerConnect, onClick: () => nav.replaceTop(SCREENS.profileFromApp) }} />
  return (
    <div className="mt-2 grid gap-4">
      <InlineStatus tone="success">{a.done}</InlineStatus>
      <p className="text-[1.0625rem] leading-snug text-muted-foreground">{a.doneText}</p>
      <HistoryProgress pubkey={applied.session.pubkey} />
      <Button onClick={() => nav.popToRoot("profile")} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {a.finish}
      </Button>
    </div>
  )
}
