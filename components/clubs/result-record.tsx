"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { useChange } from "@/components/clubs/common"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import { gameSeats, recordGame, type GameSeat } from "@/lib/clubs/games"
import { useSession } from "@/lib/profile/session"
import type { FinishedMatch } from "@/lib/shell/registry"
import { usePlayers } from "@/lib/storage/hooks"

// Games recorded for their club in this page's lifetime, so a result shown again isn't
// recorded twice.
const recorded = new Set<string>()

// Records a finished club game for the club: by itself when the profile's key is on this device
// (nothing to confirm), with one tap when a signer app has to sign. The row says what happened.
export default function ResultRecord({ club, match }: { club: string; match: FinishedMatch }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const session = useSession()
  const { view } = useClub(club)
  const directory = usePlayers()
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "failed">(() => (recorded.has(match.id) ? "done" : "idle"))
  const [problem, setProblem] = useState<string | null>(null)
  const state = view?.state
  const ready = !!state && view.me.status === "member" && !state.info.archived && !!session && directory !== null

  const record = async () => {
    if (!state || !directory) return
    setStatus("busy")
    setProblem(null)
    try {
      // Seats with the profile their player is linked to here (a member picked in the club).
      const seats: GameSeat[] = match.players.map((p) => {
        const pubkey = directory.find((r) => r.id === p.id)?.pubkey
        return { name: p.name, ...(pubkey ? { pubkey } : {}) }
      })
      const game = { config: match.config, seats, winner: match.winner, throws: match.throws }
      await recordGame(state, game, gameSeats(seats, state.info.visibility, tx.game.guestAlias), await clubAuthor())
      recorded.add(match.id)
      setStatus("done")
    } catch (error) {
      setProblem(describe(error))
      setStatus("failed")
    }
  }

  const automatic = session?.kind === "local"
  useEffect(() => {
    if (status === "idle" && ready && automatic) void record()
    // Once, as soon as the club is readable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, ready, automatic])

  if (!view?.state) return null
  const name = view.info?.name ?? ""
  if (status === "done") return <InlineStatus tone="success">{tx.game.recorded(name)}</InlineStatus>
  if (status === "failed") {
    return (
      <InlineStatus tone="error">
        {problem ?? tx.game.recordFailed}{" "}
        <button type="button" onClick={() => void record()} className="font-semibold underline-offset-2 hover:underline">
          {tx.retry}
        </button>
      </InlineStatus>
    )
  }
  if (!ready) return null
  return (
    <Button variant="secondary" disabled={status === "busy"} onClick={() => void record()} className="h-11 w-full whitespace-normal rounded-xl bg-primary/10 text-[1.0625rem] font-semibold text-primary shadow-none hover:bg-primary/15">
      {status === "busy" ? tx.game.recording : tx.game.record(name)}
    </Button>
  )
}
