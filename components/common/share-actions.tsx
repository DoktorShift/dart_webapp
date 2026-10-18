"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Share } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useCopied } from "@/components/common/use-copied"
import { useT } from "@/components/i18n-provider"
import { canShareNatively, shareLink } from "@/lib/shell/share"
import { cn } from "@/lib/utils"

// "Teilen" and "Link kopieren" for a link. Confirmation happens in place: the copy button says
// "Kopiert" with a check for a moment, and VoiceOver hears it. No toast. If copying is impossible,
// the link appears as selectable text instead. `copyLabel` names what is copied when it isn't a
// link to this app (a payment request). `quiet` draws both as secondary buttons, where sharing
// the link isn't what the screen is for.
export function ShareActions({ url, title, text, copyLabel, quiet, className }: { url: string; title?: string; text?: string; copyLabel?: string; quiet?: boolean; className?: string }) {
  const t = useT()
  const [native, setNative] = useState(false)
  const { copied, show: showCopied } = useCopied()
  const [failed, setFailed] = useState(false)

  // Known only in the browser; the first render matches the server's.
  useEffect(() => setNative(canShareNatively()), [])

  const run = async (copy: boolean) => {
    const outcome = await shareLink({ url, title, text }, { copy })
    if (outcome === "copied") {
      setFailed(false)
      showCopied()
    } else if (outcome === "failed") {
      setFailed(true)
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className={cn("grid gap-2", native && "grid-cols-2")}>
        {native && (
          <Button variant={quiet ? "secondary" : "default"} onClick={() => run(false)} className={cn("h-12 rounded-xl text-[1.0625rem]", quiet ? "text-primary" : "font-semibold")}>
            <Share className="mr-2 h-5 w-5" aria-hidden="true" />
            {t.shell.qr.share}
          </Button>
        )}
        <Button variant={native || quiet ? "secondary" : "default"} onClick={() => run(true)} className={cn("h-12 rounded-xl text-[1.0625rem]", quiet ? "text-primary" : !native && "font-semibold")}>
          {copied ? <Check className="mr-2 h-5 w-5" aria-hidden="true" /> : <Copy className="mr-2 h-5 w-5" aria-hidden="true" />}
          {copied ? t.shell.qr.copied : (copyLabel ?? t.shell.qr.copy)}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {copied ? t.shell.qr.copied : ""}
      </p>
      {failed && (
        <InlineStatus tone="info">
          {t.shell.qr.copyFailed}
          <span className="mt-1 block select-text break-all font-mono text-[0.8125rem]">{url}</span>
        </InlineStatus>
      )}
    </div>
  )
}
