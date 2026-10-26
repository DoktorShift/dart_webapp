"use client"

import { useState } from "react"
import { Share, UserRoundPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { SlotItems } from "@/components/shell/slot-items"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { PublicProfileView } from "@/components/profile/public-view"
import { offerSeat } from "@/components/profile/seat-handoff"
import { ShareSheet } from "@/components/profile/share-sheet"
import { usePublicProfile } from "@/components/profile/use-profile"
import { loadLastGame } from "@/lib/game/storage"
import { readProfilePayload } from "@/lib/profile/profile-link"
import { relaySettings } from "@/lib/profile/relay-list"
import { useSession } from "@/lib/profile/session"
import type { ScreenProps } from "@/lib/shell/registry"
import { seatName } from "@/lib/storage/players"

// A player's public profile, opened from a profile link (/#p=…, params.payload) or from a game
// (params.pubkey). Viewing needs no profile of one's own. "Profil teilen" first, then "Zum Spiel
// hinzufügen" (opens game setup with this player seated, linked by their profile), then what
// other areas offer here ("profile.actions", e.g. "Gratulieren").
export default function PublicScreen({ params }: ScreenProps) {
  const tx = useAreaT(PROFILE_TEXTS)
  const nav = useNav()
  const address = params.pubkey ? { pubkey: params.pubkey, relays: [] } : params.payload ? readProfilePayload(params.payload) : null
  const state = usePublicProfile(address?.pubkey ?? null, address?.relays)
  const session = useSession()
  const [shareOpen, setShareOpen] = useState(false)
  if (!address) return <InlineStatus tone="error" className="mt-6">{tx.public.invalid}</InlineStatus>
  const own = session?.pubkey === address.pubkey

  const addToGame = (name: string | null) => {
    offerSeat({ name: seatName(name ?? ""), pubkey: address.pubkey })
    nav.openSetup(loadLastGame()?.type ?? "x01")
  }

  return (
    <PublicProfileView pubkey={address.pubkey} own={own} state={state}>
      {(name) => (
        <>
          <div className="mt-4 grid gap-2">
            {/* On someone else's profile the relationship comes first (Game Center, Strava); sharing is the filled button only on one's own. */}
            {!own && <SlotItems list="profile.actions" props={() => ({ pubkey: address.pubkey, name: name ?? tx.unnamed })} />}
            <Button variant={own ? "default" : "secondary"} onClick={() => setShareOpen(true)} className={own ? "h-12 w-full gap-2 rounded-xl text-[1.0625rem] font-semibold" : "h-12 w-full gap-2 rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20"}>
              <Share className="h-5 w-5" aria-hidden="true" />
              {tx.public.share}
            </Button>
            {!own && (
              <Button variant="secondary" onClick={() => addToGame(name)} className="h-12 w-full gap-2 whitespace-normal rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15 active:bg-primary/20">
                <UserRoundPlus className="h-5 w-5 shrink-0" aria-hidden="true" />
                {tx.setup.add}
              </Button>
            )}
          </div>
          <ShareSheet open={shareOpen} onOpenChange={setShareOpen} pubkey={address.pubkey} name={name} writeRelays={relaySettings(state.profile?.relayList).write} />
        </>
      )}
    </PublicProfileView>
  )
}
