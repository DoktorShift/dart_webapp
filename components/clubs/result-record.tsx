"use client"

import { useEffect, useState } from "react"
import { Users } from "lucide-react"
import { useAreaT } from "@/components/i18n-provider"
import { ResultRow } from "@/components/shell/result-row"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { useChange } from "@/components/clubs/common"
import { clubAuthor, useClub } from "@/components/clubs/use-clubs"
import { VerdictSheet } from "@/components/clubs/verdict-sheet"
import { gameSeats, recordGame, recordedGame, type GameSeat } from "@/lib/clubs/games"
import { useSession } from "@/lib/profile/session"
import type { FinishedMatch, SlotListProps } from "@/lib/shell/registry"
import { usePlayers } from "@/lib/storage/hooks"

// Records a finished club game for the club: by itself when the profile's key is on this device
// (nothing to confirm), with one tap when a signer app has to sign. The result's shared row
// (components/shell/result-row.tsx) says how it stands: the invitation to record and the
// recording in the accent tone, recorded in the success tone (it opens the game in the club,
// where the other players confirm it), and a failure as worth a look, whose tap tries again. The
// club's copy remembers the games of this device (a reload shows the result again), and a game
// with the same players and throws recorded before counts as this one too.
export default function ResultRecord({ club, match, placement }: { club: string; match: FinishedMatch; placement: SlotListProps["result.actions"]["placement"] }) {
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const session = useSession()
  const { view } = useClub(club)
  const directory = usePlayers()
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "failed">("idle")
  const [problem, setProblem] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  const state = view?.state
  const ready = !!state && view.me.status === "member" && !state.info.archived && !!session && directory !== null

  // Seats with the profile their player is linked to here (a member picked in the club).
  const seats = (): GameSeat[] =>
    match.players.map((p) => {
      const pubkey = directory?.find((r) => r.id === p.id)?.pubkey
      return { name: p.name, ...(pubkey ? { pubkey } : {}) }
    })
  const game =
    view?.games.find((g) => g.match === view.recorded[match.id]) ??
    (state && session ? recordedGame(view.games, session.pubkey, gameSeats(seats(), state.info.visibility, tx.game.guestAlias), match.throws) : null)
  const recorded = !!view && (match.id in view.recorded || game !== null)

  const record = async () => {
    if (!state) return
    setStatus("busy")
    setProblem(null)
    try {
      const finished = { id: match.id, config: match.config, seats: seats(), winner: match.winner, throws: match.throws }
      await recordGame(state, finished, gameSeats(finished.seats, state.info.visibility, tx.game.guestAlias), await clubAuthor())
      setStatus("done")
    } catch (error) {
      setProblem(describe(error))
      setStatus("failed")
    }
  }

  const automatic = session?.kind === "local"
  useEffect(() => {
    if (status === "idle" && ready && automatic && !recorded) void record()
    // Once, as soon as the club is readable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, ready, automatic, recorded])

  if (!view || !state) return null
  const name = view.info?.name ?? ""
  if (recorded || status === "done") {
    return (
      <>
        <ResultRow icon={Users} label={tx.game.recorded(name)} tone="success" placement={placement} onClick={() => setShown(true)} trailing={game ? { kind: "chevron" } : undefined} />
        <VerdictSheet view={view} state={state} game={game} open={shown && game !== null} onOpenChange={setShown} />
      </>
    )
  }
  if (status === "failed") return <ResultRow icon={Users} label={tx.game.recordRetry} ariaLabel={`${problem} ${tx.retry}`} tone="warning" placement={placement} onClick={() => void record()} />
  if (!ready) return null
  return <ResultRow icon={Users} label={status === "busy" ? tx.game.recording : tx.game.record(name)} tone="accent" placement={placement} onClick={() => status !== "busy" && void record()} />
}
