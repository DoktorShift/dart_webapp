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

// One quiet line on the own profile ("profile.card") while nothing secures a profile whose key
// this app keeps: "Jetzt sichern", or "Später", which puts it off for 30 days or 10 games
// (lib/recovery/status.ts). A profile in a signer app is secured there.
export default function BackupHint({ pubkey, own }: { pubkey: string; own: boolean }) {
  const session = useSession()
  const local = own && session?.kind === "local" && session.pubkey === pubkey
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
  return (
    <div className="flex items-center gap-2">
      <ShieldAlert className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug">{h.text}</p>
      <Button variant="ghost" onClick={() => nav.push(DEVICES_SCREENS.backup)} className="h-11 shrink-0 rounded-xl px-3 text-[1.0625rem] font-semibold text-primary hover:bg-primary/10 hover:text-primary">
        {h.action}
      </Button>
      <Button variant="ghost" aria-label={h.laterLabel} onClick={later} className="-mr-2 h-11 w-11 shrink-0 rounded-xl text-muted-foreground hover:text-foreground">
        <X className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  )
}
