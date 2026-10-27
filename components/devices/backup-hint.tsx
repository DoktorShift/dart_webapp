"use client"

import { useEffect, useState } from "react"
import { ShieldAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { DEVICES_SCREENS } from "@/components/devices/screens"
import { useBackupStatus } from "@/components/devices/use-backup"
import { BACKUP_TEXTS } from "@/lib/i18n/features/backup.screens"
import { useSession } from "@/lib/profile/session"
import { backupHintDue, dismissBackupHint } from "@/lib/recovery/status"
import { useArchive } from "@/lib/storage/hooks"

// One quiet card under the own profile's sports card ("profile.notices") while nothing secures a
// profile whose key this app keeps: "Jetzt sichern", or the clear button, which puts it off for
// 30 days or 10 games (lib/recovery/status.ts). A profile in a signer app is secured there.
export default function BackupHint({ pubkey }: { pubkey: string }) {
  const session = useSession()
  const local = session?.kind === "local" && session.pubkey === pubkey
  if (!local) return null
  return <Hint key={pubkey} pubkey={pubkey} />
}

function Hint({ pubkey }: { pubkey: string }) {
  const h = useAreaT(BACKUP_TEXTS).hint
  const nav = useNav()
  const status = useBackupStatus(pubkey)
  const { matches, loaded } = useArchive()
  const games = matches.length
  const [due, setDue] = useState(false)

  useEffect(() => {
    if (!status || !loaded) return
    let alive = true
    void backupHintDue(status, games).then((next) => alive && setDue(next), () => {})
    return () => {
      alive = false
    }
  }, [status, loaded, games])

  if (!due) return null
  const later = () => {
    setDue(false)
    void dismissBackupHint(pubkey, games).catch(() => {})
  }
  // Two rows on a phone (the sentence, then "Jetzt sichern" under it), one from sm on.
  return (
    <div className="mt-4 flex items-start gap-2 rounded-2xl border border-border bg-card px-4 py-3 sm:items-center">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground sm:mt-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col items-start sm:flex-row sm:items-center sm:gap-2">
        <p className="text-[0.9375rem] leading-snug sm:flex-1">{h.text}</p>
        <Button variant="ghost" onClick={() => nav.push(DEVICES_SCREENS.backup)} className="-ml-3 h-11 shrink-0 rounded-xl px-3 text-[1.0625rem] font-semibold text-primary hover:bg-primary/10 hover:text-primary sm:ml-0">
          {h.action}
        </Button>
      </div>
      <Button variant="ghost" aria-label={h.laterLabel} onClick={later} className="-mr-2 -mt-2 h-11 w-11 shrink-0 rounded-xl hover:bg-transparent sm:mt-0">
        <span className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-full bg-muted-foreground/60 text-card">
          <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
      </Button>
    </div>
  )
}
