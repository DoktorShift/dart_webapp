"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { pictureProblem, ProfileFields } from "@/components/profile/profile-fields"
import { useCreateProfile } from "@/components/profile/use-create-profile"

// The sheet behind "Deine Ergebnisse mitnehmen" (./keep-results.tsx): which seat of the finished
// game is the person's, their display name (prefilled from it) and an optional picture, then
// "Profil anlegen".

export interface Seat {
  seat: number
  name: string
}

export default function KeepSheet({
  open,
  onOpenChange,
  matchId,
  seats,
  onLater,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  matchId: string
  seats: Seat[]
  onLater: () => void
  onCreated: () => void
}) {
  const tx = useAreaT(PROFILE_TEXTS)
  const k = tx.keep
  const f = tx.form
  const { create, busy, failed, dialog } = useCreateProfile()
  const only = seats.length === 1 ? seats[0] : null
  const [seat, setSeat] = useState<number | null>(only?.seat ?? null)
  const [name, setName] = useState(only?.name ?? "")
  // The name follows the chosen seat until it is typed in.
  const [typed, setTyped] = useState(false)
  const [picture, setPicture] = useState("")
  const chosen = seats.find((s) => s.seat === seat) ?? null
  const ready = seat !== null && name.trim() !== "" && !pictureProblem(picture)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (ready && (await create({ name, picture, claim: { matchId, seat } }))) onCreated()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={k.offer} description={k.description}>
      {/* On short screens (phones in landscape) everything scrolls together, the action last. */}
      <form onSubmit={submit} className="flex min-h-0 flex-col overscroll-contain xshort:overflow-y-auto">
        <SheetBody className="xshort:shrink-0 xshort:overflow-visible">
          {!only && (
            <section className="mt-2">
              <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{k.seat}</p>
              <ChoiceList
                label={k.seat}
                options={seats.map((s) => ({ value: String(s.seat), title: s.name }))}
                value={seat === null ? null : String(seat)}
                onChange={(value) => {
                  const chosen = seats.find((s) => String(s.seat) === value)!
                  setSeat(chosen.seat)
                  if (!typed) setName(chosen.name)
                }}
              />
              <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{k.seatHint}</p>
            </section>
          )}
          <ProfileFields
            seed={name || "blueline"}
            name={name}
            nameHint={chosen && name.trim() !== chosen.name ? k.boardStays(chosen.name) : undefined}
            onName={(value) => {
              setTyped(true)
              setName(value)
            }}
            picture={picture}
            onPicture={setPicture}
          />
          {failed && (
            <InlineStatus tone="error" className="mt-4">
              {f.failed}
            </InlineStatus>
          )}
        </SheetBody>
        {/* Outside the fields' scroll area: the one action stays in view while they scroll. */}
        <Button type="submit" disabled={!ready || busy} className="mt-2 h-14 w-full shrink-0 rounded-2xl text-[1.0625rem] font-semibold xshort:h-12">
          {busy ? f.creating : f.create}
        </Button>
      </form>
      <Button variant="ghost" onClick={onLater} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem] xshort:h-11">
        {k.later}
      </Button>
      {dialog}
    </Sheet>
  )
}
