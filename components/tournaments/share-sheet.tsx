"use client"

import { Button } from "@/components/ui/button"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { SheetCode } from "@/components/common/sheet-code"
import { XSHORT, useMediaQuery } from "@/components/common/use-media-query"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { SITE } from "@/lib/site"
import { tournamentLink } from "@/lib/tournaments/links"

// "Turnier teilen": the tournament's QR code and link (/#tournament=…), with share and copy, in
// view without scrolling from an iPhone SE to a phone in landscape (SheetCode).
export function ShareSheet({ open, onOpenChange, tournament, name, relays = [] }: { open: boolean; onOpenChange: (open: boolean) => void; tournament: string; name: string; relays?: readonly string[] }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const xshort = useMediaQuery(XSHORT)
  const link = tournamentLink(SITE.url, tournament, relays)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.tournament.shareTitle} description={xshort ? undefined : tx.tournament.shareDescription}>
      <SheetBody>
        {open && <SheetCode value={link} label={t.shell.qr.label} caption={tx.tournament.shareCaption} description={tx.tournament.shareDescription} share={{ url: link, title: name, text: tx.tournament.shareText(name) }} />}
      </SheetBody>
      <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
        {t.common.done}
      </Button>
    </Sheet>
  )
}
