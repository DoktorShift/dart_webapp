"use client"

import { useEffect, useMemo, useState } from "react"
import { Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineStatus } from "@/components/common/inline-status"
import { readPayload } from "@/components/live/link-payload"
import { Waiting } from "@/components/common/waiting"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { PRIMARY, QUIET, useParticipantNames, useRoundLabel } from "@/components/tournaments/common"
import { useLiveMatches } from "@/components/tournaments/use-live-matches"
import { useReport } from "@/components/tournaments/use-report"
import { useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { loadMatch } from "@/lib/game/storage"
import { modeName } from "@/lib/i18n"
import { goLive } from "@/lib/live/board"
import { decodeLinkPayload } from "@/lib/protocol/links"
import { onStorageChange } from "@/lib/storage/db"
import type { LinkPayload } from "@/lib/protocol/links"
import { becomeBoard, boardGame, codeFits, openBoardKey, reportPlayed, type BoardKey } from "@/lib/tournaments/board-device"
import { loadBoardDevice, rememberGame, type BoardDeviceRecord, type BoardGame } from "@/lib/tournaments/store"
import { SCREENS, type ScreenProps } from "@/lib/shell/registry"

// This device as one board of a tournament (PLAN.md "Das Board-Gerät zeigt ausschließlich
// aktuelle Paarung, Scoreeingabe und Ergebnisübergabe"): the match called to it, one button to
// start it on the normal game screen (live for the organizer and spectators), the result's
// way to the tournament, then the next match. Opened with the organizer's code (params.payload,
// TB1) or from the tab for a board this device already is (params.tournament). Its title is the
// board's name once known.
export default function BoardScreen({ params, setParams }: ScreenProps) {
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
  return <BoardDevice tournament={tournament} hints={link?.relays ?? []} title={params.name} setTitle={(name) => setParams({ name })} />
}

// What scanning the organizer's code does, said before it happens. Only a code with the key the
// organizer authorized for a board still in the tournament makes this device that board.
function BecomeBoard({ link, problem, onConfirm }: { link: Extract<LinkPayload, { type: "tournamentBoard" }>; problem: boolean; onConfirm: () => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const { entry } = useTournament(link.tournament, link.relays)
  const state = entry?.read.state
  const [fits, setFits] = useState<boolean | null>(null)
  useEffect(() => {
    if (!state) return
    let current = true
    void codeFits(state, link).then((ok) => current && setFits(ok))
    return () => {
      current = false
    }
  }, [state, link])
  if (fits === false) return <EmptyState icon={Target} title={tx.board.invalid} description={tx.board.invalidText} />
  const name = state?.boards[link.board]?.name ?? tx.unnamed
  return (
    <div className="mt-2 grid gap-4">
      <p className="text-xl font-semibold leading-tight">{tx.board.become}</p>
      <p className="text-[1.0625rem] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{tx.board.becomeText(name, state?.settings.name ?? "…")}</p>
      {problem && <InlineStatus tone="error">{tx.failed}</InlineStatus>}
      <Button onClick={onConfirm} disabled={!fits} className={PRIMARY}>
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
        (found) => current && setRecord(found),
        () => current && setRecord(null),
      )
    load()
    const stop = onStorageChange((message) => {
      if (message.type === "wipe" || message.stores.includes("pending")) load()
    })
    return () => {
      current = false
      stop()
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

// The calls this board won a game for here; any whose result has not gone out yet (the result
// screen was left at once, the app was closed) is reported now, with the board's key and the
// tournament as kept. Asked again when the board's games change.
function usePlayed(tournament: string, record: BoardDeviceRecord): Set<string> {
  const [played, setPlayed] = useState<Set<string>>(new Set())
  useEffect(() => {
    let current = true
    void reportPlayed(tournament).then(
      (slots) => current && setPlayed(new Set(slots)),
      () => {},
    )
    return () => {
      current = false
    }
  }, [tournament, record.games])
  return played
}

function BoardDevice({ tournament, hints, title, setTitle }: { tournament: string; hints: readonly string[]; title: string | undefined; setTitle: (name: string) => void }) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const b = tx.board
  const nav = useNav()
  const { entry, loaded } = useTournament(tournament, hints)
  const { record, key } = useBoardDevice(tournament)
  useLiveMatches(entry?.read)
  const name = record ? entry?.read.state?.boards[record.board]?.name : undefined
  useEffect(() => {
    if (name && name !== title) setTitle(name)
    // The title follows the board's name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, title])
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
  // The slot the organizer called to this board that has no result that counts yet; a
  // finished one shows what became of its report until the next call.
  const slot = Object.values(state.slots).find((s) => s.board === record.board && !s.approved)
  const m = slot && view ? view.match(slot.slot) : undefined
  const game = m ? record.games[m.id] : undefined
  const kept = loadMatch()
  const continuing = game && kept?.id === game.local && kept.status === "paused" ? kept : null
  const played = usePlayed(state.id, record)
  const report = useReport(state.id, m?.id ?? null)
  // The result of this call is on its way or there: reported for it, or won here and about to be
  // (never started again). A report the tournament did not take (the match was reset since) lets
  // the board start it anew.
  const reporting = game?.reported ? slot?.submissions.some((s) => s.event === game.reported?.event) : !!m && played.has(m.id)
  const over = state.phase === "finished" || state.phase === "cancelled"
  // The last result this board reported that counts now, said once it was approved.
  const lastApproved = !slot && Object.values(state.slots).some((s) => s.board === record.board && s.approved && record.games[s.slot]?.reported)

  const start = async () => {
    if (!m || !boardKey || starting) return
    setStarting(true)
    setFailed(false)
    try {
      const players: [string, string] = [m.slots[0].participant ?? "", m.slots[1].participant ?? ""]
      const shown = Object.fromEntries(players.map((id) => [id, names.nameOf(id)]))
      const next = boardGame(state, m, shown, record.board, modeName(t, state.settings.rules.modeId, state.settings.rules.modeId))
      const game: BoardGame = { local: next.id, match: null, players, reported: null }
      await rememberGame(state.id, m.id, () => game)
      try {
        const live = await goLive(next, { tournament: { id: state.id, slot: m.id, authority: boardKey.secret, relays: read.relays } })
        await rememberGame(state.id, m.id, (before) => ({ ...(before ?? game), match: decodeLinkPayload("watch", live.watch).match }))
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
      <p className="mt-2 text-[0.9375rem] text-muted-foreground [overflow-wrap:anywhere]">{state.settings.name}</p>
      {entry.waiting > 0 && !reporting && <InlineStatus className="mt-4">{b.unsent(entry.waiting)}</InlineStatus>}
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
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">{lastApproved ? `${b.approved}. ${b.waitingText}` : b.waitingText}</p>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border border-border bg-card px-4 py-4">
          <p className="text-[0.8125rem] text-muted-foreground">
            {b.now} · {round(m)} · {tx.matchNumber(m.number)}
          </p>
          <h2 className="mt-1 grid text-[1.75rem] font-semibold leading-tight [overflow-wrap:anywhere]">
            <span>{names.nameOf(m.slots[0].participant)}</span>
            <span>
              <span aria-hidden="true" className="font-normal text-muted-foreground">
                –{" "}
              </span>
              {names.nameOf(m.slots[1].participant)}
            </span>
          </h2>
          {reporting ? (
            report === "reported" ? (
              <InlineStatus tone="success" className="mt-4">
                <span className="block font-semibold">{b.reported}</span>
                {state.settings.approval === "organizer" && b.reportedText}
              </InlineStatus>
            ) : (
              <InlineStatus className="mt-4">{tx.game[report]}</InlineStatus>
            )
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
