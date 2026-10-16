"use client"

import { useEffect, useMemo, useState } from "react"
import { Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineStatus } from "@/components/common/inline-status"
import { readPayload } from "@/components/live/link-payload"
import { Waiting } from "@/components/live/waiting"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { PRIMARY, QUIET, useParticipantNames, useRoundLabel } from "@/components/tournaments/common"
import { useLiveMatches } from "@/components/tournaments/use-live-matches"
import { useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { loadMatch } from "@/lib/game/storage"
import { modeName } from "@/lib/i18n"
import { goLive } from "@/lib/live/board"
import { decodeLinkPayload } from "@/lib/protocol/links"
import { onStorageChange } from "@/lib/storage/db"
import { becomeBoard, boardGame, flushBoard, openBoardKey, rememberGame, type BoardKey } from "@/lib/tournaments/board-device"
import { loadBoardDevice, type BoardDeviceRecord, type BoardGame } from "@/lib/tournaments/store"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"

// This device as one board of a tournament (PLAN.md "Das Board-Gerät zeigt ausschließlich
// aktuelle Paarung, Scoreeingabe und Ergebnisübergabe"): the match called to it, one button to
// start it on the normal game screen (live for the organizer and spectators), the result's
// way to the tournament, then the next match. Opened with the organizer's code (params.payload,
// TB1) or from the tab for a board this device already is (params.tournament).
export default function BoardScreen({ params }: ScreenProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const link = useMemo(() => readPayload("tournamentBoard", params.payload), [params.payload])
  const [tournament, setTournament] = useState<string | null>(params.tournament ?? null)
  const [problem, setProblem] = useState(false)
  if (params.payload && !link) return <EmptyState icon={Target} title={tx.board.invalid} description={tx.board.invalidText} />
  if (link && !tournament) {
    return (
      <BecomeBoard
        link={link}
        problem={problem}
        onConfirm={() =>
          becomeBoard(link).then(
            () => setTournament(link.tournament),
            () => setProblem(true),
          )
        }
      />
    )
  }
  if (!tournament) return <EmptyState icon={Target} title={tx.board.notBoard} description={tx.board.notBoardText} />
  return <BoardDevice tournament={tournament} hints={link?.relays ?? []} />
}

// What scanning the organizer's code does, said before it happens.
function BecomeBoard({ link, problem, onConfirm }: { link: { board: string; tournament: string; relays: string[] }; problem: boolean; onConfirm: () => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const { entry } = useTournament(link.tournament, link.relays)
  const state = entry?.read.state
  const name = state?.boards[link.board]?.name ?? tx.unnamed
  return (
    <div className="mt-2 grid gap-4">
      <p className="text-xl font-semibold leading-tight">{tx.board.become}</p>
      <p className="text-[1.0625rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{tx.board.becomeText(name, state?.settings.name ?? "…")}</p>
      {problem && <InlineStatus tone="error">{tx.failed}</InlineStatus>}
      <Button onClick={onConfirm} className={PRIMARY}>
        {tx.board.becomeConfirm}
      </Button>
    </div>
  )
}

// The board's record and key on this device, kept current with the writes of the game screen.
function useBoardDevice(tournament: string): { record: BoardDeviceRecord | null | undefined; key: BoardKey | null | undefined } {
  const [record, setRecord] = useState<BoardDeviceRecord | null | undefined>(undefined)
  const [key, setKey] = useState<BoardKey | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    const load = () =>
      void loadBoardDevice(tournament).then(
        (found) => {
          if (!current) return
          setRecord(found)
          if (found) void flushBoard(found).catch(() => {})
        },
        () => current && setRecord(null),
      )
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "wipe" || message.stores.includes("pending")) load()
    })
    window.addEventListener("online", load)
    return () => {
      current = false
      stop()
      window.removeEventListener("online", load)
    }
  }, [tournament])
  useEffect(() => {
    if (!record) return
    let current = true
    void openBoardKey(record).then((k) => current && setKey(k))
    return () => {
      current = false
    }
    // The key never changes for a board; the record's other fields do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.board, record?.tournament])
  return { record, key }
}

function BoardDevice({ tournament, hints }: { tournament: string; hints: readonly string[] }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const b = tx.board
  const nav = useNav()
  const { entry, loaded } = useTournament(tournament, hints)
  const { record, key } = useBoardDevice(tournament)
  useLiveMatches(entry?.read)
  if (!loaded || record === undefined) return null
  if (record === null) return <EmptyState icon={Target} title={b.notBoard} description={b.notBoardText} />
  if (key === null) return <EmptyState icon={Target} title={b.keyLost} />
  if (!entry?.read.state) return <Waiting>{tx.tournament.loading}</Waiting>
  const board = entry.read.state.boards[record.board]
  if (!board?.active) return <EmptyState icon={Target} title={b.revoked} description={b.revokedText} />
  return <CurrentMatch entry={entry} record={record} boardKey={key} onTournament={() => nav.push(SCREENS.tournamentView, { tournament, name: entry.read.state?.settings.name ?? "" })} />
}

// The match called to this board, as the board sees it: start it, go on with it, or what
// became of its result.
function CurrentMatch({ entry, record, boardKey, onTournament }: { entry: Entry; record: BoardDeviceRecord; boardKey: BoardKey | undefined; onTournament: () => void }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const b = tx.board
  const nav = useNav()
  const round = useRoundLabel()
  const names = useParticipantNames(entry.read)
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState(false)
  const { read } = entry
  const state = read.state as NonNullable<typeof read.state>
  const view = read.view
  const boardInfo = state.boards[record.board]
  // The slot the organizer called to this board that has no result that counts yet; a
  // finished one shows what became of its report until the next call.
  const slot = Object.values(state.slots).find((s) => s.board === record.board && !s.approved)
  const m = slot && view ? view.match(slot.slot) : undefined
  const game = m ? record.games[m.id] : undefined
  const kept = loadMatch()
  const continuing = game && kept?.id === game.local && kept.status === "paused" ? kept : null
  const reported = game?.reported ? slot?.submissions.find((s) => s.event === game.reported?.event) : undefined
  const over = state.phase === "finished" || state.phase === "cancelled"

  const start = async () => {
    if (!m || !boardKey || starting) return
    setStarting(true)
    setFailed(false)
    try {
      const players: [string, string] = [m.slots[0].participant ?? "", m.slots[1].participant ?? ""]
      const next = boardGame(state, m, read.names, record.board, modeName(t, state.settings.rules.modeId, state.settings.rules.modeId))
      const game: BoardGame = { local: next.id, match: null, players, reported: null }
      const remembered = await rememberGame(record, m.id, game)
      try {
        const live = await goLive(next, { tournament: { id: state.id, slot: m.id, authority: boardKey.secret, relays: read.relays } })
        await rememberGame(remembered, m.id, { ...game, match: decodeLinkPayload("watch", live.watch).match })
      } catch {
        // Not live (no connection to set the clock, say): the game is scored here all the same
        // and its result reported; the organizer sees it when it comes.
      }
      nav.resumeMatch(next)
    } catch {
      setFailed(true)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="pb-4">
      <p className="mt-2 text-[0.9375rem] text-muted-foreground [overflow-wrap:anywhere]">{b.connected(boardInfo?.name ?? tx.unnamed, state.settings.name)}</p>
      {record.outbox.length > 0 && <InlineStatus className="mt-4">{b.unsent(record.outbox.length)}</InlineStatus>}
      {over ? (
        <section className="mt-6 rounded-2xl border border-border bg-secondary/40 px-4 py-4">
          <h2 className="text-xl font-semibold leading-tight">{b.over}</h2>
        </section>
      ) : state.phase === "paused" ? (
        <section className="mt-6 rounded-2xl border border-border bg-secondary/40 px-4 py-4">
          <h2 className="text-xl font-semibold leading-tight">{b.paused}</h2>
        </section>
      ) : !m ? (
        <section className="mt-6 rounded-2xl border border-border bg-secondary/40 px-4 py-4">
          <h2 className="text-xl font-semibold leading-tight">{b.waiting}</h2>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">{b.waitingText}</p>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-border bg-card px-4 py-4">
          <p className="text-[0.8125rem] text-muted-foreground">
            {b.now} · {round(m)} · {tx.matchNumber(m.number)}
          </p>
          <h2 className="mt-1 text-[1.75rem] font-semibold leading-tight [overflow-wrap:anywhere]">{names.nameOf(m.slots[0].participant)}</h2>
          <p className="text-[1.0625rem] text-muted-foreground">{tx.tournament.versus(names.nameOf(m.slots[1].participant))}</p>
          {reported ? (
            <InlineStatus tone="success" className="mt-4">
              <span className="block font-semibold">{b.reported}</span>
              {state.settings.approval === "organizer" && b.reportedText}
            </InlineStatus>
          ) : (
            <div className="mt-4 grid gap-2">
              {failed && <InlineStatus tone="error">{tx.failed}</InlineStatus>}
              {continuing ? (
                <Button onClick={() => nav.resumeMatch(continuing)} className={PRIMARY}>
                  {b.continue}
                </Button>
              ) : (
                <Button onClick={() => void start()} disabled={starting || !boardKey || m.state === "pending" || m.affected} className={PRIMARY}>
                  {b.start}
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      <Button variant="ghost" onClick={onTournament} className={`${QUIET} mt-6`}>
        {b.tournament}
      </Button>
    </div>
  )
}
