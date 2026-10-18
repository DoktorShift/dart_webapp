"use client"

import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { parseAppLink } from "@/lib/shell/links"
import { dispatchLink } from "@/lib/shell/registry"
import { SITE } from "@/lib/site"

// "Einladung öffnen": scan the invitation's QR code or paste its link. Only invitations of the
// expected kind are taken; anything else is answered in place and scanning goes on. Device
// pairing never goes through here (decision 0002 §7).
function OpenInvite({ kind }: { kind: "club" | "tournament" }) {
  const t = useT()
  const nav = useNav()

  const onResult = (text: string): ScanVerdict => {
    const link = parseAppLink(text, [window.location.origin, SITE.url])
    if (!link) return t.shell.openLink.invalid
    if (link.kind !== kind) return kind === "club" ? t.shell.openLink.notClub : t.shell.openLink.notTournament
    if (!dispatchLink(link, nav, "scan")) return t.shell.linkNotYet
  }

  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{t.shell.openLink.intro}</p>
      <QRScanner
        className="mt-6"
        onResult={onResult}
        manualLabel={t.shell.openLink.manualLabel}
        manualPlaceholder={t.shell.openLink.manualPlaceholder}
      />
    </>
  )
}

export function OpenClubInvite() {
  return <OpenInvite kind="club" />
}

export function OpenTournamentInvite() {
  return <OpenInvite kind="tournament" />
}
