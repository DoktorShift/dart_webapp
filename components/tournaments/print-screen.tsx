"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/common/waiting"
import { useAreaT, useT } from "@/components/i18n-provider"
import { formatDateTime } from "@/lib/i18n"
import { TOURNAMENTS_TEXTS } from "@/lib/i18n/features/tournaments.screens"
import { boardName, rulesLine, scoreText, SECONDARY, useParticipantNames, useRoundLabel } from "@/components/tournaments/common"
import { useTournament, type Entry } from "@/components/tournaments/use-tournaments"
import { saveFile } from "@/lib/save-file"
import { exportFileName, tournamentCsv, tournamentJson } from "@/lib/tournaments/export"
import type { ScreenProps } from "@/lib/shell/registry"

// Pairings and results as a printable sheet, and the exports: CSV for people and spreadsheets,
// JSON with the signed records for another app. The sheet prints from a copy next to the app
// (data-print-sheet, app/globals.css), so no tab bar or navigation comes along and long fields
// run over several pages. Paper always gets the light colours, in dark mode too.
export default function PrintScreen({ params }: ScreenProps) {
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const { entry, loaded } = useTournament(params.tournament ?? null)
  if (!loaded) return null
  if (!entry?.read.state) return <Waiting>{tx.tournament.loading}</Waiting>
  return <Sheet entry={entry} />
}

function Sheet({ entry }: { entry: Entry }) {
  const t = useT()
  const tx = useAreaT(TOURNAMENTS_TEXTS)
  const p = tx.print
  const round = useRoundLabel()
  const names = useParticipantNames(entry.read)
  const [saved, setSaved] = useState(false)
  const { read, stored } = entry
  const state = read.state as NonNullable<typeof read.state>
  const matches = read.view?.matches.filter((m) => m.state !== "void") ?? []
  const labels = {
    round,
    state: (m: (typeof matches)[number]) => (m.affected ? tx.affected : tx.state[m.state]),
    name: names.nameOf,
    board: (b: string | null) => boardName(state, b),
    columns: p.columns as [string, string, string, string, string, string, string, string],
  }
  const download = (text: string, type: string, extension: "csv" | "json") => {
    saveFile(new Blob([text], { type }), exportFileName(state.settings.name, extension))
    setSaved(true)
  }
  const sheet = (
    <article className="mt-6">
      <h2 className="text-2xl font-semibold leading-tight [overflow-wrap:anywhere]">{state.settings.name}</h2>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">
        {[rulesLine(state, tx), tx.formats[state.settings.format].name, state.settings.starts !== undefined ? formatDateTime(t, state.settings.starts * 1000) : null, state.settings.place].filter(Boolean).join(" · ")}
      </p>
      <p className="text-[0.8125rem] text-muted-foreground">{p.generated(formatDateTime(t, Date.now()))}</p>
      <table className="mt-4 w-full border-collapse text-[0.9375rem]">
        <thead>
          <tr className="text-left text-[0.8125rem] text-muted-foreground">
            {p.columns.map((c) => (
              <th key={c} className="border-b border-border py-2 pr-2 font-normal">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.id} className="border-b border-border align-top">
              <td className="py-2 pr-2 tabular-nums">{m.number}</td>
              <td className="py-2 pr-2">{round(m)}</td>
              <td className="py-2 pr-2 [overflow-wrap:anywhere]">{m.slots[0].empty ? tx.tournament.bye : names.nameOf(m.slots[0].participant)}</td>
              <td className="py-2 pr-2 [overflow-wrap:anywhere]">{m.slots[1].empty ? tx.tournament.bye : names.nameOf(m.slots[1].participant)}</td>
              <td className="py-2 pr-2 tabular-nums">{m.state === "walkover" ? tx.walkover[m.walkover ?? "noShow"] : scoreText(m)}</td>
              <td className="py-2 pr-2 [overflow-wrap:anywhere]">{m.winner ? names.nameOf(m.winner) : ""}</td>
              <td className="py-2 pr-2">{boardName(state, m.board)}</td>
              <td className="py-2">{labels.state(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
  return (
    <div className="pb-4">
      <div className="mt-4 grid gap-2 min-[480px]:grid-cols-3">
        <Button onClick={() => window.print()} className="h-12 gap-2 rounded-xl text-[1.0625rem] font-semibold">
          <Printer className="h-5 w-5" aria-hidden="true" />
          {p.print}
        </Button>
        <Button variant="secondary" onClick={() => download(tournamentCsv(read, labels), "text/csv;charset=utf-8", "csv")} className={`${SECONDARY} gap-2 rounded-xl`}>
          <Download className="h-5 w-5" aria-hidden="true" />
          {p.csv}
        </Button>
        <Button variant="secondary" onClick={() => download(JSON.stringify(tournamentJson(stored, read), null, 2), "application/json", "json")} className={`${SECONDARY} gap-2 rounded-xl`}>
          <Download className="h-5 w-5" aria-hidden="true" />
          {p.json}
        </Button>
      </div>
      {saved && (
        <InlineStatus tone="success" className="mt-3">
          {p.saved}
        </InlineStatus>
      )}
      <div className="print:hidden">{sheet}</div>
      {createPortal(
        <div data-print-sheet className="light hidden bg-white p-8 text-black print:block">
          {sheet}
        </div>,
        document.body,
      )}
    </div>
  )
}
