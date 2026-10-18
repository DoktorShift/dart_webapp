"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ArrowRightLeft, Smartphone, X } from "lucide-react"
import { useSeat } from "@/components/live/use-seat"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { rulesSummary } from "@/lib/game/words"
import { offeredGame } from "@/lib/live/content"
import { readMatch } from "@/lib/live/follow"
import { forgetSeat, keepConfirmed, loadSeat, ownVerdict, seatSource, type JoinedMatch } from "@/lib/live/join"
import type { JoinedRecord } from "@/lib/live/store"
import { SCREENS } from "@/lib/shell/registry"

// "play.rows": this phone's seats at boards, one row each, and the word that a game went on to
// another device. A seat's row is the way back to its game without the board's code (after a
// reload, or with the app switched away meanwhile) and, while the app is open, how the
// player's own games follow the result (useSeat), whether or not the seat's screen is open.
export default function JoinedRows({ records, handedOver, onDismissHandedOver }: { records: JoinedRecord[]; handedOver: boolean; onDismissHandedOver: () => void }) {
  return (
    <Group className="mt-0 first:mt-0">
      {handedOver && <HandedOverRow onDismiss={onDismissHandedOver} />}
      {records.map((record) => (
        <JoinedRow key={record.match} record={record} />
      ))}
    </Group>
  )
}

// The game that was handed to another device (lib/live/handoff.ts) is gone from here at once;
// this row is where the word that it went well is still read.
function HandedOverRow({ onDismiss }: { onDismiss: () => void }) {
  const tx = useAreaT(LIVE_TEXTS)
  return (
    <ListRow
      icon={ArrowRightLeft}
      iconTone="green"
      title={tx.joined.handedOver}
      subtitle={tx.joined.handedOverText}
      trailing={
        <button type="button" onClick={onDismiss} aria-label={tx.joined.dismiss} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-secondary/70">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      }
    />
  )
}

function JoinedRow({ record }: { record: JoinedRecord }) {
  const [joined, setJoined] = useState<JoinedMatch | null>(null)
  useEffect(() => {
    let current = true
    void loadSeat(record.match).then((seat) => current && setJoined(seat), () => {})
    return () => {
      current = false
    }
    // The record changes once the result this phone confirmed is noted or let go.
  }, [record.match, record.archived])
  if (!joined) return null
  return record.archived ? <ConfirmedRow record={record} joined={joined} /> : <SeatRow record={record} joined={joined} />
}

function Row({ record, status }: { record: JoinedRecord; status: ReactNode }) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const nav = useNav()
  return (
    <ListRow
      icon={Smartphone}
      title={tx.joined.title(rulesSummary(t, offeredGame(record.rules, record.aliases)))}
      subtitle={status}
      onClick={() => nav.push(SCREENS.liveBoard, { match: record.match })}
    />
  )
}

// A seat whose result this phone confirmed: nothing left to do, so the match is not followed
// for the rest of the day. One look at it on the way to the Play tab is enough to notice a
// correction made since (keepConfirmed lets the game go, and the row follows the match again).
function ConfirmedRow({ record, joined }: { record: JoinedRecord; joined: JoinedMatch }) {
  const tx = useAreaT(LIVE_TEXTS)
  useEffect(() => {
    let current = true
    void readMatch(seatSource(joined)).then((state) => (state && current ? keepConfirmed(joined, state) : null), () => {}).catch(() => {})
    return () => {
      current = false
    }
  }, [joined])
  return <Row record={record} status={tx.joined.confirmed} />
}

// A seat at a game that is running or waiting for this phone's verdict: followed live.
function SeatRow({ record, joined: initial }: { record: JoinedRecord; joined: JoinedMatch }) {
  const tx = useAreaT(LIVE_TEXTS)
  const { joined, followed, lost } = useSeat(initial, true)
  useEffect(() => {
    if (lost) void forgetSeat(record.match)
  }, [lost, record.match])

  const state = followed.state
  const status = !state?.result ? tx.board.seated(record.aliases[record.seat] ?? `${record.seat + 1}`) : ownVerdict(joined, state)?.verdict === "confirm" ? tx.joined.confirmed : <span className="text-primary">{tx.result.confirm}</span>
  return <Row record={record} status={status} />
}
