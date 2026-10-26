"use client"

import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { useNav } from "@/components/nav/nav-context"
import { useT } from "@/components/i18n-provider"
import { findInviteByCode } from "@/lib/clubs/codes"
import { encodeLinkPayload } from "@/lib/protocol/links"
import { normalizeInviteCode } from "@/lib/protocol/invite"
import { parseAppLink, isAnswerLink } from "@/lib/shell/links"
import { LINK_ROUTES, SCREENS, canOpenLink, dispatchLink } from "@/lib/shell/registry"
import { SITE } from "@/lib/site"

// "Code scannen": the one scanner for every BlueLine code. Whatever the code is, an invitation
// to a club or a tournament, a player's profile card, a game to watch or a board to score at, it
// opens where it belongs (lib/shell/registry.ts dispatchLink); the scanner never asks the person
// to know the kind first. Device pairing is the one exception (decision 0002 §7): it has its own
// flow under Profile, and a pairing code scanned here says so. Pasting or typing the link always
// works as well, and so does a club's eight-character code (lib/clubs/codes.ts).
export default function ScanScreen() {
  const t = useT()
  const nav = useNav()

  // Opens a screen in its tab; the scanner doesn't stay behind when that is another tab.
  const openIn = (tab: string, open: () => void) => {
    if (tab !== nav.tab) nav.pop()
    open()
  }

  const onResult = async (text: string): Promise<ScanVerdict> => {
    const code = normalizeInviteCode(text)
    if (code) {
      const found = await findInviteByCode(code)
      if ("problem" in found) return found.problem === "offline" ? t.shell.scan.codeOffline : t.shell.scan.codeMissing
      const { club, invite, relays } = found.address
      const payload = encodeLinkPayload({ type: "club", club, invite: invite.id, token: invite.token, relays })
      openIn("clubs", () => (nav.tab === "clubs" ? nav.replaceTop(SCREENS.clubInvite, { payload }) : nav.push(SCREENS.clubInvite, { payload }, { tab: "clubs" })))
      return
    }
    const link = parseAppLink(text, [window.location.origin, SITE.url])
    if (!link || isAnswerLink(link.kind)) return t.shell.scan.invalid
    if (link.kind === "pair") return t.shell.scan.pair
    if (!canOpenLink(link)) return t.shell.linkNotYet
    openIn(LINK_ROUTES[link.kind]?.tab ?? nav.tab, () => dispatchLink(link, nav, "scan"))
  }

  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{t.shell.scan.intro}</p>
      <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{t.shell.scan.kinds}</p>
      <QRScanner className="mt-6" onResult={onResult} manualLabel={t.shell.scan.manualLabel} manualPlaceholder={t.shell.scan.manualPlaceholder} checkingText={t.shell.scan.codeLooking} inputMode="text" />
    </>
  )
}
