"use client"

import { lazy, Suspense, useState } from "react"
import { QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { useSession } from "@/lib/profile/session"
import type { SetupPlayersProps } from "@/lib/shell/registry"

// Ways to fill seats in game setup (registry "setup.players"): a player's profile QR code (for
// everyone: on a shared tablet the seat gets their name and profile, the tablet's owner stays
// apart), and with a profile signed in, saved player rounds to pick with one tap (NIP-51 sets,
// lib/profile/rounds.ts). Setup is on the guest path: only the row itself loads with it; the
// scanner and the rounds come when they are needed.

const ScanSheetContent = lazy(() => import("@/components/profile/setup-scan"))
const Rounds = lazy(() => import("@/components/profile/setup-rounds"))

export const setupRowClass =
  "flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left text-[1.0625rem] text-primary transition-colors active:bg-secondary/60 disabled:opacity-40"

export default function SetupPlayers({ players, canAdd, addPlayer, replacePlayers }: SetupPlayersProps) {
  const session = useSession()
  return (
    <>
      <ScanPlayer players={players} canAdd={canAdd} addPlayer={addPlayer} />
      {session && (
        <Suspense fallback={null}>
          <Rounds session={session} players={players} replacePlayers={replacePlayers} />
        </Suspense>
      )}
    </>
  )
}

function ScanPlayer({ players, canAdd, addPlayer }: Pick<SetupPlayersProps, "players" | "canAdd" | "addPlayer">) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const s = tx.setup
  // Each opening starts with the camera, not with the last player.
  const [sheet, setSheet] = useState({ open: false, round: 0 })
  const close = () => setSheet((v) => ({ ...v, open: false }))
  return (
    <>
      <button type="button" disabled={!canAdd} onClick={() => setSheet((v) => ({ open: true, round: v.round + 1 }))} className={setupRowClass}>
        <QrCode className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-snug">{s.scan}</span>
      </button>
      {!canAdd && <p className="-mt-1 px-1 text-[0.8125rem] text-muted-foreground">{s.full}</p>}
      <Sheet open={sheet.open} onOpenChange={(open) => setSheet((v) => ({ ...v, open }))} title={s.scan} description={s.scanDescription}>
        {sheet.round > 0 && (
          <Suspense fallback={<p className="py-12 text-center text-[0.9375rem] text-muted-foreground">{t.shell.loading}</p>}>
            <ScanSheetContent
              key={sheet.round}
              players={players}
              onAdd={(seat) => {
                addPlayer(seat)
                close()
              }}
            />
          </Suspense>
        )}
        <Button variant="ghost" onClick={close} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </Sheet>
    </>
  )
}
