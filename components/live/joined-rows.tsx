"use client"

import { useEffect, useState } from "react"
import { Smartphone } from "lucide-react"
import { useSeat } from "@/components/live/use-seat"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { LIVE_TEXTS } from "@/lib/i18n/features/live.screens"
import { Group } from "@/components/ui/group"
import { ListRow } from "@/components/ui/list-row"
import { rulesSummary } from "@/lib/game/words"
import { offeredGame } from "@/lib/live/content"
import { forgetSeat, loadSeat, seatKey, type JoinedMatch } from "@/lib/live/join"
import type { JoinedRecord } from "@/lib/live/store"
import { SCREENS } from "@/lib/shell/registry"

// "play.rows": this phone's seats at boards, one row each. The way back to a game without the
// board's code (after a reload, or with the app switched away meanwhile), and, while the app is
// open, how the player's own games follow the result (useSeat), whether or not the seat's
// screen is open.
export default function JoinedRows({ records }: { records: JoinedRecord[] }) {
  return (
    <Group className="mt-0 first:mt-0">
      {records.map((record) => (
        <JoinedRow key={record.match} record={record} />
      ))}
    </Group>
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
  }, [record.match])
  return joined && <SeatRow record={record} joined={joined} />
}

function SeatRow({ record, joined: initial }: { record: JoinedRecord; joined: JoinedMatch }) {
  const t = useT()
  const tx = useAreaT(LIVE_TEXTS)
  const nav = useNav()
  const { joined, followed, lost } = useSeat(initial, true)
  useEffect(() => {
    if (lost) void forgetSeat(record.match)
  }, [lost, record.match])

  const state = followed.state
  const given = state?.confirmations[joined.seat]
  const confirmed = given?.verdict === "confirm" && given.pubkey === seatKey(joined)
  const status = !state?.result ? tx.board.seated(record.aliases[record.seat] ?? `${record.seat + 1}`) : confirmed ? tx.joined.confirmed : <span className="text-primary">{tx.result.confirm}</span>
  return (
    <ListRow
      icon={Smartphone}
      title={tx.joined.title(rulesSummary(t, offeredGame(record.rules, record.aliases)))}
      subtitle={status}
      onClick={() => nav.push(SCREENS.liveBoard, { match: record.match })}
    />
  )
}
