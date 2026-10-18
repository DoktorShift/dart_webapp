"use client"

import { ShieldCheck } from "lucide-react"
import { ListRow } from "@/components/ui/list-row"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { DEVICES_SCREENS } from "@/components/devices/screens"
import { useBackupStatus } from "@/components/devices/use-backup"
import { BACKUP_TEXTS } from "@/lib/i18n/features/backup.screens"
import { useSession, type Session } from "@/lib/profile/session"
import { isSecured } from "@/lib/recovery/status"

// "Sicherung" in the Profile tab ("profile.rows"), with how things stand on its second line.
// Nothing for a guest.
export default function BackupRow() {
  const session = useSession()
  if (!session) return null
  return <Row key={session.pubkey} session={session} />
}

function Row({ session }: { session: Session }) {
  const t = useT()
  const r = useAreaT(BACKUP_TEXTS).row
  const nav = useNav()
  const status = useBackupStatus(session.pubkey)
  if (!status) return null
  const line = session.kind !== "local" ? r.signer : isSecured(status) ? r.secured : status.passkey ? r.passkeyOnly : r.notSecured
  return <ListRow icon={ShieldCheck} iconTone="blue" title={t.backup.titles.backup} subtitle={line} onClick={() => nav.push(DEVICES_SCREENS.backup)} />
}
