"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Clock, Smartphone, WifiOff } from "lucide-react"
import { InlineStatus } from "@/components/common/inline-status"
import { readPayload } from "@/components/live/link-payload"
import { MatchView, useFollowed } from "@/components/live/match-view"
import { useT } from "@/components/i18n-provider"
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
import { EmptyState } from "@/components/ui/empty-state"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { rulesSummary } from "@/lib/game/words"
import { offeredGame } from "@/lib/live/content"
import { giveVerdict, keepConfirmed, seatKey, visitBoard, type BoardSeats, type BoardVisit, type BoardVisitControl, type JoinedMatch } from "@/lib/live/join"
import { toHex } from "@/lib/live/keys"
import type { Followed } from "@/lib/live/follow"
import { getSigner, useSession } from "@/lib/profile/session"
import type { ScreenProps } from "@/lib/shell/registry"

// "Am Board mitspielen" (/#board=…), on a player's own phone: pick a seat at the board, follow
// the game there, and give the seat's verdict on the result. With a profile the profile only
// signs (a claim, a verdict); its key and wallet never leave the phone.
export default function BoardScreen({ params }: ScreenProps) {
  const t = useT()
  const b = t.live.board
  const link = useMemo(() => readPayload("board", params.payload), [params.payload])
  const [visit, setVisit] = useState<BoardVisit>({ step: "looking" })
  const [attempt, setAttempt] = useState(0)
  const control = useRef<BoardVisitControl | null>(null)

  useEffect(() => {
    if (!link) return
    const current = visitBoard(link, setVisit)
    control.current = current
    return () => {
      current.close()
      control.current = null
    }
  }, [link, attempt])

  if (!link) return <EmptyState icon={Smartphone} title={b.invalid} />
  switch (visit.step) {
    case "looking":
      return (
        <p role="status" className="py-12 text-center text-[0.9375rem] text-muted-foreground">
          {b.looking}
        </p>
      )
    case "silent":
      return <EmptyState icon={WifiOff} title={b.silent} description={b.silentText} primary={{ label: t.live.retry, onClick: () => setAttempt((n) => n + 1) }} />
    case "expired":
      return <EmptyState icon={Clock} title={b.expired} description={b.expiredText} />
    case "seated":
      return <Seated joined={visit.joined} onLeave={() => void control.current?.leave()} />
    default:
      return <SeatPicker visit={visit} control={control} />
  }
}

function SeatPicker({ visit, control }: { visit: Extract<BoardVisit, { step: "table" | "joining" }>; control: { current: BoardVisitControl | null } }) {
  const t = useT()
  const b = t.live.board
  const session = useSession()
  const [refused, setRefused] = useState(false)
  const table: BoardSeats = visit.table
  const config = offeredGame(table.rules, table.seats.map((s) => s.alias))
  const joining = visit.step === "joining" ? visit.seat : null

  const join = async (seat: number) => {
    setRefused(false)
    try {
      await control.current?.join(seat, session ? await getSigner() : null)
    } catch {
      setRefused(true)
    }
  }

  return (
    <>
      <p className="mt-2 text-[1.0625rem] leading-snug text-muted-foreground">{rulesSummary(t, config)}</p>
      {visit.step === "table" && visit.declined && <InlineStatus tone="error" className="mt-4">{b.declined[visit.declined]}</InlineStatus>}
      {refused && <InlineStatus tone="error" className="mt-4">{b.refused}</InlineStatus>}
      <Group title={b.choose} footer={session ? b.asProfile : b.asGuest}>
        {table.seats.map((seat, i) => (
          <ListRow
            key={i}
            title={seat.alias}
            value={joining === i ? b.joining : seat.taken ? b.taken : undefined}
            onClick={seat.taken || joining !== null || session === undefined ? undefined : () => void join(i)}
            disabled={seat.taken || joining !== null}
          />
        ))}
      </Group>
      {joining !== null && session && session.kind !== "local" && (
        <InlineStatus className="mt-4">{b.approve}</InlineStatus>
      )}
    </>
  )
}

function Seated({ joined: initial, onLeave }: { joined: JoinedMatch; onLeave: () => void }) {
  const t = useT()
  const b = t.live.board
  const [joined, setJoined] = useState(initial)
  const followed = useFollowed({ match: joined.match, key: joined.key ? toHex(joined.key.secret) : null, relays: joined.relays })
  const state = followed.state

  // The player's own games follow the result they confirmed (lib/live/join.ts).
  useEffect(() => {
    if (state) void keepConfirmed(joined, state).then(setJoined, () => {})
  }, [state, joined])

  const alias = state?.agreement.seats[joined.seat]?.alias ?? `${joined.seat + 1}`
  // The board's record of the seat may reach this phone a moment after the board's answer: the
  // seat counts as freed only once it was seen held and then isn't any more.
  const holds = state?.seats[joined.seat]?.pubkey === seatKey(joined)
  const [held, setHeld] = useState(false)
  if (holds && !held) setHeld(true)
  const freed = held && !holds
  return (
    <>
      <p className="mt-2 text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">{b.seated(alias)}</p>
      <MatchView followed={followed} actions={freed ? <InlineStatus className="mt-4">{b.freed}</InlineStatus> : <Verdict joined={joined} followed={followed} />} />
      <Button variant="ghost" onClick={onLeave} className="mt-4 h-11 w-full rounded-xl text-[1.0625rem] text-primary hover:bg-primary/10 hover:text-primary">
        {b.leave}
      </Button>
    </>
  )
}

// The seat's verdict on the result as it stands: confirm, or dispute after asking once more.
function Verdict({ joined, followed }: { joined: JoinedMatch; followed: Followed }) {
  const t = useT()
  const r = t.live.result
  const session = useSession()
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [asking, setAsking] = useState(false)
  const state = followed.state
  if (!state) return null
  const result = state.result
  const last = state.results.at(-1)
  if (!result) return last?.status === "void" ? <InlineStatus className="mt-4">{r.withdrawn}</InlineStatus> : null
  if (joined.profile && session !== undefined && session?.pubkey !== joined.profile) return <InlineStatus className="mt-4">{t.live.board.otherProfile}</InlineStatus>

  const mine = state.confirmations[joined.seat]
  const corrected = !mine && state.stale.some((v) => v.seat === joined.seat)
  const send = async (verdict: "confirm" | "dispute") => {
    setSending(true)
    setFailed(false)
    try {
      setFailed(!(await giveVerdict(joined, state, verdict, joined.profile ? await getSigner() : null)))
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  const winner = result.winner !== null ? state.agreement.seats[result.winner]?.alias : null
  return (
    <section aria-label={r.confirm} className="mt-4 grid gap-2">
      <p className="text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere]">
        {[winner ? t.live.watch.wins(winner) : null, t.live.watch.legs(result.legs.join(":"))].filter(Boolean).join(" · ")}
      </p>
      {mine?.verdict === "confirm" && <InlineStatus tone="success">{r.confirmed}</InlineStatus>}
      {mine?.verdict === "dispute" && <InlineStatus tone="error">{r.disputed}</InlineStatus>}
      {corrected && <InlineStatus>{r.corrected}</InlineStatus>}
      {failed && <InlineStatus tone="error">{r.failed}</InlineStatus>}
      {mine?.verdict !== "confirm" && (
        <Button onClick={() => void send("confirm")} disabled={sending} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
          {sending ? r.sending : r.confirm}
        </Button>
      )}
      {!mine && (
        <Button variant="secondary" onClick={() => setAsking(true)} disabled={sending} className="h-12 w-full rounded-2xl text-[1.0625rem] text-danger">
          {r.dispute}
        </Button>
      )}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{r.disputeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{r.disputeText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void send("dispute")}>
              {r.dispute}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
