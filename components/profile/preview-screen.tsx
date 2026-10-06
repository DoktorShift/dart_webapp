"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Group, SwitchRow } from "@/components/ui/group"
import { InlineStatus } from "@/components/common/inline-status"
import { useT } from "@/components/i18n-provider"
import { PublicProfileView } from "@/components/profile/public-view"
import { signerProblem, SignerConfirmation } from "@/components/profile/signer-status"
import { useStatsCard } from "@/components/profile/use-stats-card"
import { useOwnProfile, usePublicProfile, type OwnProfile } from "@/components/profile/use-profile"
import { ownRelaySettings } from "@/lib/profile/own-events"

// "So sehen andere dein Profil": what relays have published, read from them like anyone else
// would (PLAN.md: a real preview of published data, not of what this device has), and the one
// choice about it: "Statistik im Profil zeigen", off until switched on.
export default function PreviewScreen() {
  const own = useOwnProfile()
  if (!own) return null
  return <Preview own={own} />
}

function Preview({ own }: { own: OwnProfile }) {
  const t = useT()
  const p = t.profile.preview
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
      setProblem(signerProblem(t, error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{p.intro}</p>
      <Group footer={card.outdated ? p.outdated : undefined}>
        <SwitchRow title={p.toggle} hint={p.toggleHint} checked={card.enabled} onCheckedChange={(on) => !busy && void run(() => card.setEnabled(on))} />
      </Group>
      {card.outdated && own.session.kind !== "local" && (
        <Button variant="secondary" disabled={busy} onClick={() => void run(card.refresh)} className="mt-3 h-11 w-full rounded-xl text-[1.0625rem] text-primary">
          {p.update}
        </Button>
      )}
      <SignerConfirmation />
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <PublicProfileView pubkey={own.session.pubkey} own state={published} />
    </>
  )
}
