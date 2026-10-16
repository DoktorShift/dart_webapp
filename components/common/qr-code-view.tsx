"use client"

import { useEffect, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { ShareActions } from "@/components/common/share-actions"
import { useT } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

// A large QR code to scan from another device, with a caption and, for links, "Teilen" and
// "Link kopieren" below it. Dark modules on white in both appearances, with the quiet zone
// scanners need. The QR library loads only when a code is first shown.
export function QRCodeView({
  value,
  caption,
  label,
  share,
  maxSize = "70dvh",
  className,
}: {
  // What the code contains, usually an app link.
  value: string
  // One sentence under the code: what to do with it.
  caption?: string
  // What VoiceOver says for the image, e.g. "QR-Code für die Einladung". Defaults to "QR-Code".
  label?: string
  // Show share and copy actions for this link (often the same as `value`).
  share?: { url: string; title?: string; text?: string }
  // How large the code may grow (a CSS length), on top of its 18rem: less where buttons below
  // it must stay in view, as in a sheet.
  maxSize?: string
  className?: string
}) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const [qr, setQr] = useState<{ value: string; size: number; path: string } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    import("@/lib/qr").then(
      ({ qrPath }) => {
        if (!cancelled) setQr({ value, ...qrPath(value) })
      },
      () => {
        // Offline before the drawing code was ever fetched: say so; sharing the link still works.
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [value])

  const ready = qr && qr.value === value
  const box = ready ? qr.size + 8 : 1

  return (
    <figure className={cn("flex flex-col items-center", className)}>
      <div style={{ maxWidth: `min(18rem, ${maxSize})` }} className="aspect-square w-full rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5">
        {ready ? (
          <svg role="img" aria-label={label ?? t.shell.qr.label} viewBox={`-4 -4 ${box} ${box}`} className="h-full w-full" shapeRendering="crispEdges">
            <path d={qr.path} fill="#020817" />
          </svg>
        ) : failed ? (
          <p role="status" className="flex h-full w-full items-center justify-center rounded-2xl bg-neutral-100 p-4 text-center text-[0.9375rem] leading-snug text-neutral-600">
            {t.shell.qr.loadFailed}
          </p>
        ) : (
          <div role="img" aria-label={label ?? t.shell.qr.label} className={cn("h-full w-full rounded-2xl bg-neutral-100", !reduceMotion && "animate-pulse")} />
        )}
      </div>
      {caption && <figcaption className="mt-3 max-w-xs text-center text-[0.9375rem] leading-snug text-muted-foreground">{caption}</figcaption>}
      {share && <ShareActions url={share.url} title={share.title} text={share.text} className="mt-4 w-full max-w-xs" />}
    </figure>
  )
}
