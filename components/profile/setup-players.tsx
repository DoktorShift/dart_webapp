"use client"

import { lazy, Suspense, useEffect } from "react"
import { QrCode } from "lucide-react"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { takeOfferedSeat } from "@/components/profile/seat-handoff"
import { SetupSheetRow } from "@/components/profile/setup-row"
import { useSession } from "@/lib/profile/session"
import type { SetupPlayersProps } from "@/lib/shell/registry"

// Ways to fill seats in game setup (registry "setup.players"): a player's profile QR code (for
// everyone: on a shared tablet the seat gets their name and profile, the tablet's owner stays
// apart), and with a profile signed in, "Du" and saved player rounds to pick with one tap
// (NIP-51 sets, lib/profile/rounds.ts). Setup is on the guest path: only the row itself loads
// with it; the scanner and the profile's picks come when they are needed.

const ScanSheetContent = lazy(() => import("@/components/profile/setup-scan"))
const ProfileSeats = lazy(() => import("@/components/profile/setup-profile"))

export default function SetupPlayers({ players, canAdd, addPlayer, replacePlayers }: SetupPlayersProps) {
  const session = useSession()
  // A player brought along from their profile ("Zum Spiel hinzufügen") takes a seat as setup opens.
  useEffect(() => {
    const seat = takeOfferedSeat()
    if (seat?.name && canAdd && !players.some((p) => p.pubkey === seat.pubkey)) addPlayer(seat)
    // Once, as setup shows; the seats of that moment are the ones to check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <>
      <ScanPlayer players={players} canAdd={canAdd} addPlayer={addPlayer} />
      {session && (
        <Suspense fallback={null}>
          <ProfileSeats session={session} players={players} canAdd={canAdd} addPlayer={addPlayer} replacePlayers={replacePlayers} />
        </Suspense>
      )}
    </>
  )
}

function ScanPlayer({ players, canAdd, addPlayer }: Pick<SetupPlayersProps, "players" | "canAdd" | "addPlayer">) {
  const t = useT()
  const s = useAreaT(PROFILE_TEXTS).setup
  return (
    <>
      <SetupSheetRow icon={QrCode} label={s.scan} description={s.scanDescription} disabled={!canAdd}>
        {(opening, close) => (
          <Suspense fallback={<p className="py-12 text-center text-[0.9375rem] text-muted-foreground">{t.shell.loading}</p>}>
            <ScanSheetContent
              key={opening}
              players={players}
              onAdd={(seat) => {
                addPlayer(seat)
                close()
              }}
            />
          </Suspense>
        )}
      </SetupSheetRow>
      {!canAdd && <p className="-mt-1 px-1 text-[0.8125rem] text-muted-foreground">{s.full}</p>}
    </>
  )
}
