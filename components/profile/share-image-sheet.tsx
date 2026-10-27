"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetActions, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/common/waiting"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { saveFile } from "@/lib/save-file"
import { offersFileShare, shareFile } from "@/lib/shell/share-file"

// A figure page as a picture, shown before it goes anywhere (Strava, Apple Fitness: the card
// first, then the share sheet). The picture is drawn while the sheet opens; "Teilen" is enabled
// once it exists, so the tap that shares always has the file in hand and the browser's share
// sheet opens within it. Where no share sheet takes files (most computers), the picture is
// saved instead; the same when sharing is refused.
export function ShareImageSheet({ open, onOpenChange, make, fileName, title }: { open: boolean; onOpenChange: (open: boolean) => void; make: (() => Promise<Blob>) | null; fileName: string; title: string }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS).picture
  const [picture, setPicture] = useState<{ file: File; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!open || !make) return
    let cancelled = false
    setFailed(false)
    make()
      .then((blob) => {
        if (cancelled) return
        const file = new File([blob], fileName, { type: "image/png" })
        setPicture({ file, url: URL.createObjectURL(file) })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      setPicture((p) => {
        if (p) URL.revokeObjectURL(p.url)
        return null
      })
    }
  }, [open, make, fileName, round])

  const viaSheet = picture ? offersFileShare(picture.file) : false
  const send = () => {
    if (!picture) return
    const { file } = picture
    if (!viaSheet) {
      saveFile(file, file.name)
      return onOpenChange(false)
    }
    void shareFile(file, title).then((outcome) => {
      if (outcome === "shared") onOpenChange(false)
      else if (outcome === "blocked" || outcome === "failed") saveFile(file, file.name)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.title}>
      <SheetBody>
        {picture ? (
          // An object URL of a picture drawn here: nothing for next/image to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture.url} alt={title} className="mx-auto block max-h-[55dvh] w-auto max-w-full rounded-2xl border border-border xshort:max-h-[calc(100dvh-9.5rem)]" />
        ) : failed ? (
          <InlineStatus tone="error">{tx.failed}</InlineStatus>
        ) : (
          <Waiting className="py-16">{tx.making}</Waiting>
        )}
      </SheetBody>
      <SheetActions>
        {failed ? (
          <Button onClick={() => setRound((r) => r + 1)} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {tx.retry}
          </Button>
        ) : (
          <Button onClick={send} disabled={!picture} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {viaSheet || !picture ? tx.share : tx.save}
          </Button>
        )}
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-12 w-full rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </SheetActions>
    </Sheet>
  )
}
