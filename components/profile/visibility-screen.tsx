"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { PublicProfileView } from "@/components/profile/public-view"
import { signerProblem, SignerConfirmation } from "@/components/profile/signer-status"
import { useStatsCard } from "@/components/profile/use-stats-card"
import { useOwnProfile, usePublicProfile, type OwnProfile } from "@/components/profile/use-profile"
import { ownRelaySettings } from "@/lib/profile/own-events"

// Profil › Sichtbarkeit: the one choice about the public profile, "Statistik zeigen: niemandem
// / allen, die mein Profil öffnen" (Game Center: Everyone / Only You; E25), off until switched
// on, and below it the profile as relays have published it, read from them like anyone else
// would (PLAN.md: a real preview of published data, not of what this device has).
export default function VisibilityScreen() {
  const own = useOwnProfile()
  if (!own) return null
  return <Visibility own={own} />
}

type Choice = "none" | "everyone"

function Visibility({ own }: { own: OwnProfile }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const v = tx.visibility
  const card = useStatsCard(own)
  const published = usePublicProfile(own.session.pubkey, own.events ? ownRelaySettings(own.events).write : [])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      published.reload()
    } catch (error) {
      setProblem(signerProblem(tx, error))
    } finally {
      setBusy(false)
    }
  }
  const choose = (choice: Choice) => {
    if (busy || !card.loaded) return
    const on = choice === "everyone"
    if (on !== card.enabled) void run(() => card.setEnabled(on))
  }
  const footer = card.enabled && !card.hasFigures ? v.noFigures : card.outdated ? v.outdated : undefined

  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{v.intro}</p>
      <section className="mt-6">
        <h2 className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{v.label}</h2>
        <ChoiceList
          label={v.label}
          options={[
            { value: "none", title: v.none },
            { value: "everyone", title: v.everyone, subtitle: v.everyoneHint },
          ]}
          value={card.enabled ? "everyone" : "none"}
          onChange={choose}
          disabled={busy || !card.loaded}
        />
        {busy && (
          <InlineStatus className="mt-2">{v.saving}</InlineStatus>
        )}
        {footer && <p className="mt-2 px-4 text-[0.8125rem] text-muted-foreground">{footer}</p>}
      </section>
      {card.outdated && own.session.kind !== "local" && (
        <Button variant="secondary" disabled={busy} onClick={() => void run(card.refresh)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] text-primary">
          {v.update}
        </Button>
      )}
      <SignerConfirmation />
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <section className="mt-8">
        <h2 className="px-4 text-[0.8125rem] text-muted-foreground">{v.preview}</h2>
        <p className="mt-1 px-4 text-[0.8125rem] text-muted-foreground">{v.previewHint}</p>
        <PublicProfileView pubkey={own.session.pubkey} own preview state={published} />
      </section>
    </>
  )
}
