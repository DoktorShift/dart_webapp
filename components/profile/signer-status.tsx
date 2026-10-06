"use client"

import { ExternalLink } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS, type ProfileTexts } from "@/lib/i18n/features/profile.screens"
import { dismissSignerConfirmation, useSignerConfirmation } from "@/lib/profile/session"

type SignerTexts = ProfileTexts["signer"]
const CODES = ["rejected", "unknown", "mismatch", "unavailable", "unsupported", "unreachable"] as const satisfies readonly (keyof SignerTexts)[]

// What to tell the person when signing or publishing didn't work (lib/nostr SignerError codes,
// and "unreachable" when the version to change couldn't be loaded, lib/profile/own-events.ts).
// A refusal is never asked again on its own; "unknown" may still arrive (decision 0002 §4).
export function signerProblem(tx: ProfileTexts, error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const known = CODES.find((c) => c === code)
  return known ? tx.signer[known] : tx.signer.failed
}

// While a signer app waits for the person to confirm on its own page (NIP-46 auth_url), the
// page is offered here. Shown where something is being signed.
export function SignerConfirmation() {
  const tx = useAreaT(PROFILE_TEXTS)
  const url = useSignerConfirmation()
  if (!url) return null
  return (
    <InlineStatus className="mt-4">
      {tx.signer.confirmPage}{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={dismissSignerConfirmation} className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">
        {tx.signer.openPage}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </InlineStatus>
  )
}
