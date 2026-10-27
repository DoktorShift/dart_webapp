"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Plus, Trash2, UserRoundCheck, Users } from "lucide-react"
import { Confirm } from "@/components/ui/confirm"
import { Button } from "@/components/ui/button"
import { SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { SetupSheetRow } from "@/components/profile/setup-row"
import { signerProblem } from "@/components/profile/signer-status"
import { useOwnEvents } from "@/components/profile/use-profile"
import { profilePlayers } from "@/lib/profile/claim"
import { readMetadata } from "@/lib/profile/metadata"
import { OWN } from "@/lib/profile/own-events"
import { deletedRoundTemplate, newRoundId, roundTemplate, savedRounds, type Round } from "@/lib/profile/rounds"
import { getSigner, type Session } from "@/lib/profile/session"
import type { SetupPlayersProps, SetupSeat } from "@/lib/shell/registry"
import { usePlayers } from "@/lib/storage/hooks"
import { isUnnamed, nameKey, seatName } from "@/lib/storage/players"
import { submitOwn } from "@/lib/sync/publish"

// The signed-in profile's quick picks in game setup: "Du" (its own seat, linked by the profile
// rather than by a name anyone could type), its saved rounds, and "Runde speichern" for the
// seats as they are.
export default function ProfileSeats({ session, players, canAdd, addPlayer, replacePlayers }: { session: Session } & SetupPlayersProps) {
  const tx = useAreaT(PROFILE_TEXTS)
  const s = tx.setup
  const events = useOwnEvents(session.pubkey)
  const directory = usePlayers()
  const [rounds, setRounds] = useState<Round[]>([])

  useEffect(() => {
    if (!events || !directory) return
    let alive = true
    // A round not read before may need the signer to decrypt its guests; without one the public
    // part still shows.
    void savedRounds(events.values(), () => getSigner().catch(() => null), directory).then((found) => alive && setRounds(found), () => {})
    return () => {
      alive = false
    }
  }, [events, directory])

  // The profile's own seat: named as its player here, else as its public profile; nothing until
  // one of them is known. Not offered while the person is already in the game, seated as the
  // profile or under that name.
  const myName = (directory && profilePlayers(session.pubkey, directory, []).player?.name) || seatName(readMetadata(events?.get(OWN.metadata)).name ?? "")
  const seated = players.some((p) => p.pubkey === session.pubkey || nameKey(p.name) === nameKey(myName))
  const me = myName && canAdd && !seated ? { name: myName, pubkey: session.pubkey } : null

  return (
    <>
      {(me || rounds.length > 0) && (
        <div className="mt-2">
          <p className="mb-2 px-1 text-[0.8125rem] font-medium text-muted-foreground">{s.quickPick}</p>
          <div className="flex flex-wrap gap-2">
            {me && (
              <button type="button" onClick={() => addPlayer(me)} className={chipClass}>
                <UserRoundCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {s.me}
              </button>
            )}
            {rounds.map((round) => (
              <button key={round.id} type="button" onClick={() => replacePlayers(round.players.map(({ name, pubkey }) => ({ name: seatName(name), pubkey })))} className={chipClass}>
                <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="wrap-anywhere">{roundLabel(round)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <SetupSheetRow icon={Plus} label={s.saveRound} description={s.saveRoundDescription}>
        {(opening, close) => <SaveRound key={opening} session={session} players={players} rounds={rounds} onSaved={close} />}
      </SetupSheetRow>
    </>
  )
}

// Like setup's "Zuletzt gespielt" chips.
const chipClass = "flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-4 text-left text-[0.9375rem] active:bg-secondary"

const roundLabel = (round: Round) => round.title || round.players.map((p) => p.name).filter(Boolean).join(", ")

function SaveRound({ session, players, rounds, onSaved }: { session: Session; players: readonly SetupSeat[]; rounds: Round[]; onSaved: () => void }) {
  const tx = useAreaT(PROFILE_TEXTS)
  const s = tx.setup
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Round | null>(null)

  // The named seats, each with the profile it was filled from (a scan, a round, "Du"); a typed
  // name stands for nobody's profile, however familiar it is (PLAN.md: names never decide).
  const seats = useMemo(() => players.filter((p) => !isUnnamed(p.name)).map((p) => ({ name: p.name.trim(), pubkey: p.pubkey })), [players])
  // An Android signer can't encrypt: guests' names would have to go public, so they stay out.
  const guestsLeftOut = session.kind === "nip55"

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      onSaved()
    } catch (error) {
      setProblem((error as { code?: string })?.code === "private-unreadable" ? s.readOnly : signerProblem(tx, error))
    } finally {
      setBusy(false)
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (seats.length === 0 || busy) return
    void run(async () => submitOwn([await roundTemplate({ id: newRoundId(), title, players: seats }, null, await getSigner())]))
  }

  return (
    <SheetBody>
      <form onSubmit={save}>
        <TextField label={s.roundName} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={s.roundPlaceholder} maxLength={60} autoCapitalize="sentences" enterKeyHint="done" />
        <p className="mt-3 px-4 text-[0.9375rem] leading-snug wrap-anywhere">{seats.length > 0 ? seats.map((p) => p.name).join(", ") : s.noNames}</p>
        {guestsLeftOut && seats.some((p) => !p.pubkey) && <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{s.guestsNotSaved}</p>}
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
        <Button type="submit" disabled={seats.length === 0 || busy} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {s.save}
        </Button>
      </form>

      {rounds.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{s.rounds}</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {rounds.map((round) => (
              <li key={round.id} className="flex min-h-12 items-center gap-2 py-1 pl-4 pr-1">
                <span className="min-w-0 flex-1 text-[1.0625rem] leading-snug wrap-anywhere">{roundLabel(round)}</span>
                <button type="button" aria-label={s.delete(roundLabel(round))} disabled={busy} onClick={() => setDeleting(round)} className="flex h-11 w-11 shrink-0 items-center justify-center text-danger disabled:opacity-40">
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Confirm
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={s.deleteTitle}
        text={s.deleteDescription}
        confirm={s.deleteConfirm}
        destructive
        onConfirm={() => {
          const round = deleting
          if (round) void run(async () => submitOwn([await deletedRoundTemplate(round.event, await getSigner())]))
        }}
      />
    </SheetBody>
  )
}
