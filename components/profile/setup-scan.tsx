"use client"

import { useState, type FormEvent } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { QRScanner, type ScanVerdict } from "@/components/common/qr-scanner"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { usePublicProfile } from "@/components/profile/use-profile"
import { shortKey } from "@/lib/nostr/pointers"
import { readMetadata } from "@/lib/profile/metadata"
import { readProfileCode, type ProfileAddress } from "@/lib/profile/profile-link"
import type { SetupSeat } from "@/lib/shell/registry"
import { SITE } from "@/lib/site"
import { isUnnamed, MAX_SEAT_NAME, nameKey, seatName } from "@/lib/storage/players"

// "Spieler per QR hinzufügen": scan (or paste) a player's profile code, see whose it is, add
// them to a seat with their name and profile. Loaded when the sheet first opens.
export default function ScanSheetContent({ players, onAdd }: { players: readonly SetupSeat[]; onAdd: (seat: SetupSeat) => void }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const s = tx.setup
  const [found, setFound] = useState<ProfileAddress | null>(null)

  const onResult = async (text: string): Promise<ScanVerdict> => {
    const address = await readProfileCode(text, [window.location.origin, SITE.url])
    if (!address) return s.notProfile
    setFound(address)
  }

  return (
    <SheetBody>
      {found ? <FoundPlayer address={found} players={players} onAdd={onAdd} /> : <QRScanner onResult={onResult} manualLabel={s.scanManual} manualPlaceholder={s.scanPlaceholder} />}
    </SheetBody>
  )
}

// The scanned player: picture and name from their public profile, the name editable for the
// board (a seat holds 16 characters; the profile keeps its full name). Someone else in the game
// with the same name: the start of this profile's fingerprint tells them apart (design rules,
// impostor prevention); names alone never decide who is who.
function FoundPlayer({ address, players, onAdd }: { address: ProfileAddress; players: readonly SetupSeat[]; onAdd: (seat: SetupSeat) => void }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const s = tx.setup
  const { profile, status } = usePublicProfile(address.pubkey, address.relays)
  const metadata = readMetadata(profile?.metadata)
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? seatName(metadata.name ?? "")
  const shortened = !!metadata.name && seatName(metadata.name) !== metadata.name.trim()
  const alreadyIn = players.some((p) => p.pubkey === address.pubkey)
  const sameName = !alreadyIn && players.some((p) => !isUnnamed(p.name) && nameKey(p.name) === nameKey(name))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (isUnnamed(name) || alreadyIn) return
    onAdd({ name: name.trim(), pubkey: address.pubkey })
  }

  return (
    <form onSubmit={submit}>
      <div className="mt-2 flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4">
        <Avatar seed={address.pubkey} name={name || undefined} src={metadata.picture} size={56} />
        <div className="min-w-0">
          <p className="text-[1.0625rem] font-semibold leading-snug wrap-anywhere">{metadata.name ?? (status === null ? tx.public.loading : tx.unnamed)}</p>
          {sameName && <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">{s.sameName(shortKey(address.pubkey))}</p>}
        </div>
      </div>
      {alreadyIn && <InlineStatus className="mt-4">{s.alreadyIn}</InlineStatus>}
      <TextField
        label={s.nameLabel}
        value={name}
        onChange={(e) => setTyped(e.target.value)}
        maxLength={MAX_SEAT_NAME}
        autoCapitalize="words"
        autoComplete="off"
        enterKeyHint="done"
        hint={status !== null && !metadata.name ? s.nameUnknown : shortened ? s.nameShortened(MAX_SEAT_NAME) : undefined}
      />
      <Button type="submit" disabled={isUnnamed(name) || alreadyIn} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {s.add}
      </Button>
    </form>
  )
}

