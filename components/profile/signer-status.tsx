"use client"

import { ExternalLink } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { useT } from "@/components/i18n-provider"
import type { Messages } from "@/lib/i18n"
import { dismissSignerConfirmation, useSignerConfirmation } from "@/lib/profile/session"

type SignerTexts = Messages["profile"]["signer"]
const CODES = ["rejected", "unknown", "mismatch", "unavailable", "unsupported"] as const satisfies readonly (keyof SignerTexts)[]

// What to tell the person when signing or publishing didn't work (lib/nostr SignerError codes).
// A refusal is never asked again on its own; "unknown" may still arrive (decision 0002 §4).
export function signerProblem(t: Messages, error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const known = CODES.find((c) => c === code)
  return known ? t.profile.signer[known] : t.profile.signer.failed
}

// While a signer app waits for the person to confirm on its own page (NIP-46 auth_url), the
// page is offered here. Shown where something is being signed.
export function SignerConfirmation() {
  const t = useT()
  const url = useSignerConfirmation()
  if (!url) return null
  return (
    <InlineStatus className="mt-4">
      {t.profile.signer.confirmPage}{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={dismissSignerConfirmation} className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">
        {t.profile.signer.openPage}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </InlineStatus>
  )
}
