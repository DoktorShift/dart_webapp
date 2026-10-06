"use client"

import { useState } from "react"
import { Share } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { SlotItems } from "@/components/shell/slot-items"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { PublicProfileView } from "@/components/profile/public-view"
import { ShareSheet } from "@/components/profile/share-sheet"
import { usePublicProfile } from "@/components/profile/use-profile"
import { readProfilePayload } from "@/lib/profile/profile-link"
import { relaySettings } from "@/lib/profile/relay-list"
import { useSession } from "@/lib/profile/session"
import type { ScreenProps } from "@/lib/shell/registry"

// A player's public profile, opened from a profile link (/#p=…, params.payload) or from a game
// (params.pubkey). Viewing needs no profile of one's own. "Profil teilen" first, then what other
// areas offer here ("profile.actions", e.g. "Gratulieren").
export default function PublicScreen({ params }: ScreenProps) {
  const tx = useAreaT(PROFILE_TEXTS)
  const address = params.pubkey ? { pubkey: params.pubkey, relays: [] } : params.payload ? readProfilePayload(params.payload) : null
  const state = usePublicProfile(address?.pubkey ?? null, address?.relays)
  const session = useSession()
  const [shareOpen, setShareOpen] = useState(false)
  if (!address) return <InlineStatus tone="error" className="mt-6">{tx.public.invalid}</InlineStatus>
  const own = session?.pubkey === address.pubkey

  return (
    <PublicProfileView pubkey={address.pubkey} own={own} state={state}>
      {(name) => (
        <>
          <div className="mt-4 grid gap-2">
            <Button onClick={() => setShareOpen(true)} className="h-12 w-full gap-2 rounded-xl text-[1.0625rem] font-semibold">
              <Share className="h-5 w-5" aria-hidden="true" />
              {tx.public.share}
            </Button>
            {!own && <SlotItems list="profile.actions" props={() => ({ pubkey: address.pubkey, name: name ?? tx.unnamed })} />}
          </div>
          <ShareSheet open={shareOpen} onOpenChange={setShareOpen} pubkey={address.pubkey} name={name} writeRelays={relaySettings(state.profile?.relayList).write} />
        </>
      )}
    </PublicProfileView>
  )
}
