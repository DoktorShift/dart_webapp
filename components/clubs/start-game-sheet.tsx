"use client"

import { useState } from "react"
import { Check, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { personName, shortId } from "@/components/clubs/common"
import { useNames } from "@/components/clubs/use-names"
import { useOwnProfile } from "@/components/profile/use-profile"
import type { ClubView } from "@/lib/clubs/club"
import { CLUB_EXTRA } from "@/lib/clubs/extra"
import type { GameType } from "@/lib/game/types"
import { GAME_TYPES } from "@/lib/game/rules"
import type { ClubState } from "@/lib/protocol/club-state"
import type { SetupPreset, SetupSeat } from "@/lib/shell/registry"
import { isUnnamed, seatName } from "@/lib/storage/players"
import { cn } from "@/lib/utils"

const MAX_PLAYERS = 6

// "Spiel starten" from a club: tap the members who play (you are in already), add guests by
// name, pick the game, and setup opens with those seats (onStart). The game is played like any
// other; its result is recorded for the club when it is finished (./result-action.tsx).
export function StartGameSheet({
  view,
  state,
  open,
  onOpenChange,
  onStart,
}: {
  view: ClubView
  state: ClubState
  open: boolean
  onOpenChange: (open: boolean) => void
  onStart: (type: GameType, preset: SetupPreset) => void
}) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const own = useOwnProfile()
  const me = view.me.pubkey
  const members = Object.values(state.members).filter((m) => m.pubkey !== me)
  const names = useNames(members.map((m) => m.pubkey))
  const nameOf = (pubkey: string) => names(pubkey).name ?? tx.unnamed
  const sorted = [...members].sort((a, b) => nameOf(a.pubkey).localeCompare(nameOf(b.pubkey)))
  const [chosen, setChosen] = useState<string[]>(me ? [me] : [])
  const [guests, setGuests] = useState<string[]>([])
  const [guestName, setGuestName] = useState("")
  const [type, setType] = useState<GameType>("x01")
  const count = chosen.length + guests.length
  const full = count >= MAX_PLAYERS

  const toggle = (pubkey: string) => setChosen((current) => (current.includes(pubkey) ? current.filter((p) => p !== pubkey) : full ? current : [...current, pubkey]))
  const addGuest = () => {
    const name = seatName(guestName)
    if (isUnnamed(name) || full) return
    setGuests((current) => [...current, name])
    setGuestName("")
  }
  const start = () => {
    const players: SetupSeat[] = [
      ...chosen.map((pubkey) => ({ name: seatName(pubkey === me ? (own?.name ?? tx.you) : nameOf(pubkey)), pubkey })),
      ...guests.map((name) => ({ name })),
    ]
    onStart(type, { players, extras: { [CLUB_EXTRA]: { club: view.id } } })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.game.title} description={tx.game.description}>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
        <p className="mb-2 px-1 text-[0.8125rem] font-medium text-muted-foreground">{tx.game.members}</p>
        <div className="flex flex-wrap gap-2">
          {me && <Chip label={tx.you} chosen={chosen.includes(me)} onClick={() => toggle(me)} />}
          {sorted.map((m) => (
            <Chip key={m.pubkey} label={personName(m.pubkey, names(m.pubkey), tx)} hint={names(m.pubkey).name ? undefined : shortId(m.pubkey)} chosen={chosen.includes(m.pubkey)} onClick={() => toggle(m.pubkey)} />
          ))}
        </div>
        {guests.length > 0 && (
          <>
            <p className="mb-2 mt-4 px-1 text-[0.8125rem] font-medium text-muted-foreground">{tx.game.guests}</p>
            <div className="flex flex-wrap gap-2">
              {guests.map((name, i) => (
                <Chip key={`${name}-${i}`} label={name} chosen onClick={() => setGuests((current) => current.filter((_, j) => j !== i))} />
              ))}
            </div>
          </>
        )}
        <TextField
          label={tx.game.addGuest}
          value={guestName}
          onChange={(event) => setGuestName(event.target.value)}
          placeholder={tx.game.guestPlaceholder}
          maxLength={16}
          autoCapitalize="words"
          disabled={full}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              addGuest()
            }
          }}
          className="mt-4"
          trailing={
            <Button type="button" variant="ghost" size="icon" onClick={addGuest} disabled={full || isUnnamed(guestName)} aria-label={tx.game.addGuest} className="h-11 w-11 rounded-xl text-primary">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </Button>
          }
        />
        <p className="mb-2 mt-6 px-1 text-[0.8125rem] font-medium text-muted-foreground">{tx.game.type}</p>
        <Segmented label={tx.game.type} options={GAME_TYPES.map((id) => ({ value: id, label: t.families[id].name }))} value={type} onChange={setType} />
        {full && (
          <InlineStatus tone="info" className="mt-4">
            {tx.game.full}
          </InlineStatus>
        )}
        <Button onClick={start} disabled={count < 2} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {tx.game.continue}
        </Button>
        {count < 2 && <p className="mt-2 text-center text-[0.8125rem] text-muted-foreground">{tx.game.minPlayers}</p>}
      </div>
      <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
        {t.common.cancel}
      </Button>
    </Sheet>
  )
}

// A player to tap in or out; the check says which, not the colour alone.
function Chip({ label, hint, chosen, onClick }: { label: string; hint?: string; chosen: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-left text-[0.9375rem] transition-colors active:bg-secondary",
        chosen ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-secondary/50",
      )}
    >
      {chosen && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="[overflow-wrap:anywhere]">{label}</span>
      {hint && <span className="text-[0.8125rem] text-muted-foreground">{hint}</span>}
    </button>
  )
}
