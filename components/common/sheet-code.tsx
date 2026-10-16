"use client"

import type { ReactNode } from "react"
import { QRCodeView } from "@/components/common/qr-code-view"
import { ShareActions } from "@/components/common/share-actions"
import { XSHORT, useMediaQuery } from "@/components/common/use-media-query"

// A code in a sheet leaves room for the share buttons below it (and a caption), even on an
// iPhone SE (548 pt).
const QR_IN_SHEET = "32dvh"

// A QR code in a sheet with what goes with it (a live game's codes, a tournament's link, a
// board's code). On a phone in landscape (xshort) a sheet has about 140 pt for its body: the
// code sits on the left, smaller, and on the right what must stay in view without a scroll: the
// description (`description`, shown in the sheet's header elsewhere), the share buttons, and
// `children` (the seats, say); the caption gives way. Elsewhere everything stands below the code.
export function SheetCode({
  value,
  label,
  caption,
  description,
  share,
  children,
}: {
  value: string
  label: string
  caption?: string
  description?: string
  share: { url: string; title?: string; text?: string }
  children?: ReactNode
}) {
  const xshort = useMediaQuery(XSHORT)
  if (!xshort)
    return (
      <>
        <QRCodeView value={value} label={label} caption={caption} share={share} maxSize={QR_IN_SHEET} />
        {children}
      </>
    )
  return (
    <div className="flex items-start gap-4">
      {/* The code's size is set here, not by the figure's own cap, so the column beside it keeps its room. */}
      <div className="w-[45dvh] shrink-0">
        <QRCodeView value={value} label={label} className="w-full" />
      </div>
      <div className="min-w-0 flex-1">
        {description && <p className="mb-3 text-[0.9375rem] leading-snug text-muted-foreground">{description}</p>}
        <ShareActions url={share.url} title={share.title} text={share.text} />
        {children}
      </div>
    </div>
  )
}
