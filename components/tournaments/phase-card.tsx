"use client"

import { lazy, Suspense, useState, type ReactNode } from "react"
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
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { boardName, formatDateTime, PRIMARY, QUIET, refusalText, scoreText, useProblemText, useRoundLabel, type Names } from "@/components/tournaments/common"
import { useInlineProfile } from "@/components/profile/inline-profile"
import { useLiveStanding } from "@/components/tournaments/use-live-matches"
import { useOwnEvents } from "@/components/profile/use-profile"
import { readMetadata } from "@/lib/profile/metadata"
import { OWN } from "@/lib/profile/own-events"
import { act, type Entry } from "@/components/tournaments/use-tournaments"
import { nowSeconds } from "@/lib/nostr/time"
import { useSession } from "@/lib/profile/session"
import { reduceTournament, waitingList } from "@/lib/protocol/tournament-state"
import { featureOn } from "@/lib/shell/features"
import { refreshTournament } from "@/lib/tournaments/sync"
import { nextMatch } from "@/lib/tournaments/engine"
import { freePlaces, isGuestPlace, registrationOpen } from "@/lib/tournaments/read"
import { acceptTemplate, checkInTemplate, claimTemplate, registerTemplate, withdrawTemplate } from "@/lib/tournaments/records"
import { cn } from "@/lib/utils"

const NextStepButton = lazy(() => import("@/components/tournaments/next-step"))

// The one thing a player does or sees in the tournament's phase (PLAN.md table "Phase ·
// Ansicht für Spieler"): register, check in, wait for the draw, go to the called board, see
// the place at the end, or why nothing happens (paused, cancelled). One card, one primary
// action, the state always in words.
export function PhaseCard({ entry, names }: { entry: Entry; names: Names }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const x = tx.tournament
  const t = useT()
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const session = useSession()
  const describe = useProblemText()
  const guest = useInlineProfile()
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [claim, setClaim] = useState<string | null>(null)
  const now = nowSeconds()
  const me = read.me.participant
  const mine = me?.id ?? null
  // The name the profile shows (its metadata, kept on this device), given as the alias at
  // registration so everyone reads it even where profiles can't be looked up.
  const ownName = readMetadata(useOwnEvents(session?.pubkey ?? null)?.get(OWN.metadata)).name ?? null
  const canWithdraw = me && me.status !== "withdrawn" && me.status !== "removed"
  const withdrawControls = canWithdraw ? (
    <>
      <Button variant="ghost" onClick={() => setWithdrawing(true)} disabled={busy !== null} className={cn(QUIET, "text-danger hover:bg-danger/10 hover:text-danger")}>
        {x.withdraw}
      </Button>
      <AlertDialog open={withdrawing} onOpenChange={setWithdrawing}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{x.withdrawTitle}</AlertDialogTitle>
            <AlertDialogDescription>{x.withdrawText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void run("withdraw", () => [withdrawTemplate(state)])}>
              {x.withdraw}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  ) : null

  const run = async (what: string, templates: () => Parameters<typeof act>[1]) => {
    setBusy(what)
    setProblem(null)
    try {
      if (!(await guest.ensure())) return
      const { refused } = await act(read.id, templates())
      if (refused) setProblem(refusalText(refused, tx))
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(null)
    }
  }

  // The offered organization comes before everything else: the person takes over here, on the
  // state relays have now (the acceptance names the core it takes over).
  const accept = async () => {
    setBusy("accept")
    setProblem(null)
    const stored = await refreshTournament(read.id).catch(() => null)
    const fresh = stored && stored.loadedAt !== read.loadedAt ? reduceTournament(stored.events, read.id).state : null
    const offer = fresh?.offer
    if (fresh && offer) return run("accept", () => [acceptTemplate(fresh, offer.event)])
    setProblem(x.takeOverOffline)
    setBusy(null)
  }
  if (read.me.offered) {
    return (
      <Card title={x.takeOver} text={x.takeOverText} problem={problem}>
        <Button onClick={() => void accept()} disabled={busy !== null} className={PRIMARY}>
          {busy === "accept" ? x.takingOver : x.takeOver}
        </Button>
      </Card>
    )
  }

  if (state.phase === "cancelled") {
    const reason = lastReason(entry)
    return <Card title={x.cancelled} text={reason ? `${x.cancelledText} ${x.reason(reason)}` : x.cancelledText} tone="muted" />
  }

  if (state.phase === "registration" || state.phase === "checkin") {
    const open = registrationOpen(state, now)
    const free = freePlaces(state)
    if (!me || me.status === "withdrawn") {
      // Full with a waiting list: the request goes on the list.
      const toList = free === 0 && state.settings.waitlist
      const full = free === 0 && !toList
      const late = state.settings.registrationCloses !== undefined && now > state.settings.registrationCloses
      const register = () => void run("register", () => [registerTemplate(state, ownName ?? undefined)])
      // The organizer runs the evening first: their next step is the one primary, playing along
      // a quiet second choice.
      if (read.me.organizer) {
        return (
          <Card
            title={free === 0 ? x.full : tx.home.free(free)}
            problem={problem}
            secondary={
              open && !full ? (
                <Button variant="ghost" onClick={register} disabled={busy !== null} className={QUIET}>
                  {busy === "register" ? x.registering : x.playYourself}
                </Button>
              ) : null
            }
          >
            <Suspense fallback={null}>
              <NextStepButton entry={entry} names={names} />
            </Suspense>
          </Card>
        )
      }
      if (!open) return <Card title={x.closed} tone="muted" />
      return (
        <Card title={full ? x.full : toList ? x.waitlistOpen : late ? x.late : tx.home.free(free)} text={!session && !full ? x.needProfile : undefined} problem={problem} tone={full ? "muted" : undefined}>
          {!full && guest.fields}
          {!full && (
            <Button onClick={register} disabled={busy !== null || !guest.ready} className={PRIMARY}>
              {busy === "register" ? x.registering : toList ? x.joinWaitlist : x.register}
            </Button>
          )}
          {guest.dialog}
          <GuestClaims entry={entry} names={names} claim={claim} onClaim={setClaim} onSend={() => claim && void run("claim", () => [claimTemplate(state, claim)])} busy={busy === "claim"} />
        </Card>
      )
    }
    if (me.status === "removed") return <Card title={x.removed} tone="muted" />
    if (me.status === "pending") return <Card title={x.pending} problem={problem} secondary={withdrawControls} />
    if (me.status === "waitlist") return <Card title={x.waitlist(waitingList(state).findIndex((p) => p.id === me.id) + 1)} problem={problem} secondary={withdrawControls} />
    if (state.phase === "checkin" && !me.checkedIn && !isGuestPlace(me)) {
      return (
        <Card title={x.checkIn} text={state.settings.starts !== undefined ? `${x.checkInUntil(formatDateTime(state.settings.starts, t))} ${x.checkInHint}` : x.checkInHint} problem={problem} secondary={withdrawControls}>
          <Button onClick={() => void run("checkin", () => [checkInTemplate(state)])} disabled={busy !== null} className={PRIMARY}>
            {busy === "checkin" ? x.checkingIn : x.checkIn}
          </Button>
        </Card>
      )
    }
    return <Card title={me.checkedIn ? x.checkedIn : x.registered} text={state.settings.starts !== undefined ? x.startsAt(formatDateTime(state.settings.starts, t)) : undefined} tone="success" problem={problem} secondary={withdrawControls} />
  }

  if (state.phase === "paused") return <Card title={x.paused} text={x.pausedText} tone="muted" />

  if (state.phase === "finished") {
    const view = read.view
    const place = mine ? view?.placements.find((p) => p.participant === mine) : null
    const champion = view?.champion ?? null
    return (
      <Card title={x.finished} text={champion ? x.champion(names.nameOf(champion)) : undefined} tone="success">
        {place && <p className="text-[1.0625rem] font-semibold">{x.yourPlace(tx.place(place.place, place.placeTo))}</p>}
        {place && session && featureOn("badges") && <p className="text-[0.9375rem] text-muted-foreground">{x.badgeHint}</p>}
      </Card>
    )
  }

  // Drawn or running: the next match, or why there is none.
  const view = read.view
  if (!view) return <Card title={x.preparing} text={x.preparingText} tone="muted" />
  if (!mine) return <Card title={tx.phase[state.phase]} tone="muted" />
  const next = nextMatch(view, mine)
  if (!next) {
    const done = me?.status === "withdrawn" || me?.status === "removed" ? x.withdrawn : x.eliminated
    return <Card title={done} tone="muted" />
  }
  return <NextMatchCard entry={entry} mine={mine} next={next} names={names} />
}

// The reason of the last phase change, from the records (a cancellation names one).
function lastReason(entry: Entry): string | null {
  const state = entry.read.state
  if (!state) return null
  const last = [...state.log.applied].reverse().find((e) => e.type === "tournament.phase")
  const event = last && entry.stored.events.find((e) => e.id === last.id)
  if (!event) return null
  try {
    return (JSON.parse(event.content) as { reason?: string }).reason ?? null
  } catch {
    return null
  }
}

// Guest places a signed-in player can say "that's me" to, while the organizer has not linked
// them yet.
function GuestClaims({ entry, names, claim, onClaim, onSend, busy }: { entry: Entry; names: { nameOf: (id: string | null) => string }; claim: string | null; onClaim: (id: string | null) => void; onSend: () => void; busy: boolean }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const session = useSession()
  const state = entry.read.state as NonNullable<Entry["read"]["state"]>
  if (!session || entry.read.me.organizer) return null
  const guests = Object.values(state.participants).filter((p) => isGuestPlace(p) && p.status === "registered" && !p.player)
  if (guests.length === 0) return null
  const claimed = guests.find((g) => g.claims?.includes(session.pubkey))
  if (claimed) return <InlineStatus tone="success">{tx.tournament.claimed}</InlineStatus>
  return (
    <div className="mt-2">
      <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{tx.tournament.claimHint}</p>
      <ChoiceList label={tx.tournament.claimHint} options={guests.map((g) => ({ value: g.id, title: names.nameOf(g.id) }))} value={claim} onChange={onClaim} />
      {claim && (
        <Button variant="secondary" onClick={onSend} disabled={busy} className="mt-2 h-12 w-full rounded-2xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15">
          {busy ? tx.tournament.claiming : tx.tournament.claim}
        </Button>
      )}
    </div>
  )
}

// "Dein nächstes Spiel": opponent, board and whether it is called, playing (with the live
// score) or still waiting for an opponent or a decision.
function NextMatchCard({ entry, mine, next, names }: { entry: Entry; mine: string; next: NonNullable<ReturnType<typeof nextMatch>>; names: { nameOf: (id: string | null) => string } }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const x = tx.tournament
  const round = useRoundLabel()
  const { read } = entry
  const m = next.match
  const opponent = m.slots.find((s) => s.participant !== mine)?.participant ?? null
  const live = useLiveStanding(read.live[m.id]?.match ?? null, read.relays)
  const board = m.board ?? read.live[m.id]?.board ?? null
  const text = next.state === "live" ? x.playing : next.state === "ready" ? (board ? x.called : x.waitingCall) : m.affected ? x.waitingDecision : x.waitingOpponent
  const mySide = m.slots.findIndex((s) => s.participant === mine)
  return (
    <Card title={x.nextMatch} tone={next.state === "ready" && board ? "success" : undefined}>
      <p className="text-[1.0625rem] leading-snug [overflow-wrap:anywhere]">
        <span className="font-semibold">{opponent ? x.versus(names.nameOf(opponent)) : x.tbd}</span>
        <span className="text-muted-foreground"> · {round(m)}</span>
      </p>
      {board && <p className="text-[1.5rem] font-semibold leading-tight">{x.onBoard(boardName(read.state, board))}</p>}
      <p className="text-[0.9375rem] text-muted-foreground">{text}</p>
      {live && mySide >= 0 && (
        <p className={cn("font-display text-3xl font-semibold tabular-nums", live.stale && "opacity-50")}>
          {live.standing.legs[mySide]}:{live.standing.legs[1 - mySide]}
          {m.score && <span className="ml-2 text-base text-muted-foreground">{scoreText(m)}</span>}
        </p>
      )}
    </Card>
  )
}

function Card({ title, text, tone, problem, secondary, children }: { title: string; text?: string; tone?: "success" | "muted"; problem?: string | null; secondary?: ReactNode; children?: ReactNode }) {
  return (
    <section className={cn("mt-6 rounded-2xl border px-4 py-4", tone === "success" ? "border-success/30 bg-success/10" : tone === "muted" ? "border-border bg-secondary/40" : "border-border bg-card")}>
      <h2 className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">{title}</h2>
      {text && <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{text}</p>}
      {problem && (
        <InlineStatus tone="error" className="mt-3">
          {problem}
        </InlineStatus>
      )}
      {children && <div className="mt-4 grid gap-2">{children}</div>}
      {secondary && <div className="mt-2 grid gap-2">{secondary}</div>}
    </section>
  )
}
