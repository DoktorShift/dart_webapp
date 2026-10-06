"use client"

import { useEffect, useState, type FormEvent } from "react"
import { UserRoundPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Sheet } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { FitText } from "@/components/fit-text"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { createProfile } from "@/components/profile/create-profile"
import { pictureProblem, ProfileFields } from "@/components/profile/profile-fields"
import { useSession } from "@/lib/profile/session"
import type { FinishedMatch } from "@/lib/shell/registry"
import { kvGet, kvSet } from "@/lib/storage/db"
import { isUnnamed } from "@/lib/storage/players"

// "Deine Ergebnisse mitnehmen" on the result of a finished game (registry "result.actions"): one
// quiet row, only for guests, only when a seat has a name, and gone for this game after
// "Später". The profile is created in a sheet; afterwards one line says where to find it, no
// dialog (PLAN.md "Nutzerwege und unaufdringliche Profilerstellung").

// Games whose offer was put off, newest last; device-wide, not part of any profile.
const DISMISSED_KEY = "results-offer.dismissed"
const REMEMBERED = 50

interface Seat {
  seat: number
  name: string
}

export default function KeepResults({ match }: { match: FinishedMatch }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const k = tx.keep
  const session = useSession()
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState(false)
  const seats: Seat[] = match.players.flatMap((p, seat) => (isUnnamed(p.name) ? [] : [{ seat, name: p.name.trim() }]))

  useEffect(() => {
    let alive = true
    kvGet<string[]>(DISMISSED_KEY).then(
      (ids) => alive && setDismissed(!!ids?.includes(match.id)),
      () => alive && setDismissed(false),
    )
    return () => {
      alive = false
    }
  }, [match.id])

  if (created) return <InlineStatus tone="success">{k.done}</InlineStatus>
  if (session !== null || dismissed !== false || seats.length === 0) return null

  const later = async () => {
    setDismissed(true)
    const ids = (await kvGet<string[]>(DISMISSED_KEY).catch(() => undefined)) ?? []
    await kvSet(DISMISSED_KEY, [...ids.filter((id) => id !== match.id), match.id].slice(-REMEMBERED)).catch(() => {})
  }

  return (
    <>
      {/* One row, as the result screen asks of its pieces: the label shrinks before it wraps. */}
      <div className="flex min-h-12 items-stretch overflow-hidden rounded-2xl bg-card ring-1 ring-inset ring-border xshort:min-h-11">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-3 py-1 pl-4 pr-2 text-left text-[1.0625rem] font-medium text-primary transition-colors focus-visible:bg-secondary/50 focus-visible:outline-none active:bg-secondary/70 xshort:pl-3 xshort:text-[0.9375rem]"
        >
          <UserRoundPlus className="h-5 w-5 shrink-0 xshort:hidden" aria-hidden="true" />
          <FitText minScale={0.7} className="flex-1 leading-snug">
            {k.offer}
          </FitText>
        </button>
        <button
          type="button"
          onClick={() => void later()}
          aria-label={k.laterLabel}
          className="flex min-w-11 shrink-0 items-center justify-center border-l border-border px-3 text-[0.9375rem] text-muted-foreground transition-colors focus-visible:bg-secondary/50 focus-visible:outline-none active:bg-secondary/70"
        >
          {k.later}
        </button>
      </div>
      <KeepSheet
        open={open}
        onOpenChange={setOpen}
        matchId={match.id}
        seats={seats}
        onLater={() => {
          setOpen(false)
          void later()
        }}
        onCreated={() => {
          setOpen(false)
          setCreated(true)
        }}
      />
    </>
  )
}

function KeepSheet({
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
  const only = seats.length === 1 ? seats[0] : null
  const [seat, setSeat] = useState<number | null>(only?.seat ?? null)
  const [name, setName] = useState(only?.name ?? "")
  // The name follows the chosen seat until it is typed in.
  const [typed, setTyped] = useState(false)
  const [picture, setPicture] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const ready = seat !== null && name.trim() !== "" && !pictureProblem(picture)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setFailed(false)
    try {
      await createProfile({ name, picture, claim: { matchId, seat } })
      onCreated()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={k.offer} description={k.description}>
      {/* On short screens (phones in landscape) everything scrolls together, the action last. */}
      <form onSubmit={submit} className="flex min-h-0 flex-col overscroll-contain xshort:overflow-y-auto">
        <div className="min-h-0 overflow-y-auto overscroll-contain pb-4 xshort:shrink-0 xshort:overflow-visible">
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
        </div>
        {/* Outside the fields' scroll area: the one action stays in view while they scroll. */}
        <Button type="submit" disabled={!ready || busy} className="mt-2 h-14 w-full shrink-0 rounded-2xl text-[1.0625rem] font-semibold xshort:h-12">
          {busy ? f.creating : f.create}
        </Button>
      </form>
      <Button variant="ghost" onClick={onLater} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem] xshort:h-11">
        {k.later}
      </Button>
    </Sheet>
  )
}
