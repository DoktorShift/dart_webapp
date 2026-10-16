"use client"

import { useEffect, useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DisclosureRow } from "@/components/ui/group"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { usePublicProfile } from "@/components/profile/use-profile"
import { readMetadata } from "@/lib/profile/metadata"

// "Bist du das?" before anything of an external signer is kept: the account it named, with name
// and picture from its public profile, and its key only under "Erweitert" to compare in the
// signer app. Someone who saw the sign-in code could have answered first with an account of
// their own; this is where the person notices (lib/nostr/signers.ts, startNostrConnect).
export function AccountConfirm({ pubkey, busy, onAnswer }: { pubkey: string; busy?: boolean; onAnswer: (yes: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const c = tx.connect
  const { profile, status } = usePublicProfile(pubkey)
  const metadata = readMetadata(profile?.metadata)
  const [npub, setNpub] = useState("")

  useEffect(() => {
    let alive = true
    void import("@/lib/nostr/pointers").then(({ npubOf }) => npubOf(pubkey)).then((value) => alive && setNpub(value), () => {})
    return () => {
      alive = false
    }
  }, [pubkey])

  return (
    <section aria-labelledby="account-title" className="mt-6">
      <h2 id="account-title" className="text-xl font-semibold leading-tight">
        {c.accountTitle}
      </h2>
      <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{c.accountHint}</p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-4 px-4 py-4">
          <Avatar seed={pubkey} name={metadata.name ?? undefined} src={metadata.picture} size={56} />
          <p className="min-w-0 text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">
            {metadata.name ?? (status === null ? c.accountLoading : c.accountUnknown)}
          </p>
        </div>
        <div className="border-t border-border">
          <DisclosureRow title={t.profile.titles.advanced}>
            <span className="block">{tx.advanced.fingerprint}</span>
            <span className="mt-1 block select-all break-all font-mono text-[0.8125rem]">{npub}</span>
          </DisclosureRow>
        </div>
      </div>
      <div className="mt-6 grid gap-2">
        <Button disabled={busy} onClick={() => onAnswer(true)} className="h-12 rounded-xl text-[1.0625rem] font-semibold">
          {c.accountYes}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onAnswer(false)} className="h-11 rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
          {c.accountNo}
        </Button>
      </div>
    </section>
  )
}
