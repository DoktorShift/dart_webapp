"use client"

import { Button } from "@/components/ui/button"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { QRCodeView } from "@/components/common/qr-code-view"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { profileLink } from "@/lib/profile/profile-link"
import { SITE } from "@/lib/site"

// "Profil teilen": the profile's QR code and link (/#p=…), with share and copy. Only what is
// public travels in it.
export function ShareSheet({
  open,
  onOpenChange,
  pubkey,
  name,
  writeRelays,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pubkey: string
  name: string | null
  writeRelays?: readonly string[]
}) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const s = tx.share
  const link = profileLink(SITE.url, pubkey, writeRelays)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={s.title} description={s.description}>
      <SheetBody>
        {open && <QRCodeView value={link} caption={s.caption} label={s.label} share={{ url: link, title: name ?? s.title }} />}
      </SheetBody>
      <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
        {t.common.done}
      </Button>
    </Sheet>
  )
}
