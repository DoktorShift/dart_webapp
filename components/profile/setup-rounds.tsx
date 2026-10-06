"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Plus, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { InlineStatus } from "@/components/common/inline-status"
import { useT } from "@/components/i18n-provider"
import { setupRowClass } from "@/components/profile/setup-players"
import { signerProblem } from "@/components/profile/signer-status"
import { useOwnEvents } from "@/components/profile/use-profile"
import { deletedRoundTemplate, newRoundId, roundTemplate, savedRounds, type Round } from "@/lib/profile/rounds"
import { getSigner, type Session } from "@/lib/profile/session"
import type { SetupPlayersProps, SetupSeat } from "@/lib/shell/registry"
import { usePlayers } from "@/lib/storage/hooks"
import { findByName, isUnnamed } from "@/lib/storage/players"
import { publishOwn } from "@/lib/sync/publish"

// The profile's saved rounds as quick picks, and "Runde speichern" for the seats as they are.
export default function Rounds({ session, players, replacePlayers }: { session: Session } & Pick<SetupPlayersProps, "players" | "replacePlayers">) {
  const t = useT()
  const s = t.profile.setup
  const events = useOwnEvents(session.pubkey)
  const directory = usePlayers()
  const [rounds, setRounds] = useState<Round[]>([])
  const [sheet, setSheet] = useState({ open: false, round: 0 })

  useEffect(() => {
    if (!events || !directory) return
    let alive = true
    // Decrypting may ask a signer app; without a signer the public part still shows.
    void getSigner()
      .catch(() => null)
      .then((signer) => savedRounds(events.values(), signer, directory))
      .then((found) => alive && setRounds(found), () => {})
    return () => {
      alive = false
    }
  }, [events, directory])

  return (
    <>
      {rounds.length > 0 && (
        <div className="mt-2">
          <p className="mb-2 px-1 text-[0.8125rem] font-medium text-muted-foreground">{s.rounds}</p>
          <div className="flex flex-wrap gap-2">
            {rounds.map((round) => (
              <button
                key={round.id}
                type="button"
                onClick={() => replacePlayers(round.players.map(({ name, pubkey }) => ({ name, pubkey })))}
                className="flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-4 text-left text-[0.9375rem] active:bg-secondary"
              >
                <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="[overflow-wrap:anywhere]">{roundLabel(round)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <button type="button" onClick={() => setSheet((v) => ({ open: true, round: v.round + 1 }))} className={setupRowClass}>
        <Plus className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-snug">{s.saveRound}</span>
      </button>
      <Sheet open={sheet.open} onOpenChange={(open) => setSheet((v) => ({ ...v, open }))} title={s.saveRound} description={s.saveRoundDescription}>
        <SaveRound key={sheet.round} session={session} players={players} rounds={rounds} onSaved={() => setSheet((v) => ({ ...v, open: false }))} />
        <Button variant="ghost" onClick={() => setSheet((v) => ({ ...v, open: false }))} className="mt-2 h-12 w-full shrink-0 rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </Sheet>
    </>
  )
}

const roundLabel = (round: Round) => round.title || round.players.map((p) => p.name).filter(Boolean).join(", ")

function SaveRound({ session, players, rounds, onSaved }: { session: Session; players: readonly SetupSeat[]; rounds: Round[]; onSaved: () => void }) {
  const t = useT()
  const s = t.profile.setup
  const directory = usePlayers()
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Round | null>(null)

  // The named seats, each with the profile it was filled from or the one its name stands for here.
  const seats = useMemo(
    () => players.filter((p) => !isUnnamed(p.name)).map((p) => ({ name: p.name.trim(), pubkey: p.pubkey ?? findByName(directory ?? [], p.name)?.pubkey })),
    [players, directory],
  )
  // An Android signer can't encrypt: guests' names would have to go public, so they stay out.
  const guestsLeftOut = session.kind === "nip55"

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      onSaved()
    } catch (error) {
      setProblem((error as { code?: string })?.code === "private-unreadable" ? s.readOnly : signerProblem(t, error))
    } finally {
      setBusy(false)
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (seats.length === 0 || busy) return
    void run(async () => publishOwn([await roundTemplate({ id: newRoundId(), title, players: seats }, null, await getSigner())]))
  }

  return (
    <div className="min-h-0 overflow-y-auto overscroll-contain pb-1">
      <form onSubmit={save}>
        <TextField label={s.roundName} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={s.roundPlaceholder} maxLength={60} autoCapitalize="sentences" enterKeyHint="done" />
        <p className="mt-3 px-4 text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">{seats.length > 0 ? seats.map((p) => p.name).join(", ") : s.noNames}</p>
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
                <span className="min-w-0 flex-1 text-[1.0625rem] leading-snug [overflow-wrap:anywhere]">{roundLabel(round)}</span>
                <button type="button" aria-label={s.delete(roundLabel(round))} disabled={busy} onClick={() => setDeleting(round)} className="flex h-11 w-11 shrink-0 items-center justify-center text-danger disabled:opacity-40">
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{s.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{s.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                const round = deleting
                if (round) void run(async () => publishOwn([await deletedRoundTemplate(round.event, await getSigner())]))
              }}
            >
              {s.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
