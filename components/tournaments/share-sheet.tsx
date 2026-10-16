"use client"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { QRCodeView } from "@/components/common/qr-code-view"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { SITE } from "@/lib/site"
import { tournamentLink } from "@/lib/tournaments/links"

// "Turnier teilen": the tournament's QR code and link (/#tournament=…), with share and copy.
export function ShareSheet({ open, onOpenChange, tournament, name, relays = [] }: { open: boolean; onOpenChange: (open: boolean) => void; tournament: string; name: string; relays?: readonly string[] }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const link = tournamentLink(SITE.url, tournament, relays)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.tournament.shareTitle} description={tx.tournament.shareDescription}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        {open && <QRCodeView value={link} caption={tx.tournament.shareCaption} label={t.shell.qr.label} share={{ url: link, title: name, text: tx.tournament.shareText(name) }} />}
      </div>
      <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
        {t.common.done}
      </Button>
    </Sheet>
  )
}
