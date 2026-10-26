"use client"

import { useEffect, useId, useRef, useState } from "react"
import { FileInput, FileJson, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { monthYear } from "@/components/profile/format"
import { useProfileGames, type OwnProfile } from "@/components/profile/use-profile"
import { formatDate, modeName } from "@/lib/i18n"
import { historyCsv, historyFileName, historyJson } from "@/lib/profile/export"
import type { HistoryFile, HistoryFileResult } from "@/lib/profile/import"
import { saveFile } from "@/lib/save-file"
import { offersFileShare, shareFile } from "@/lib/shell/share-file"
import { assignImportedName, nameKey } from "@/lib/storage/players"

// Profil › Konto › Spielverlauf: the profile's games as a file, through the share sheet (Apple
// Health: export from the profile, off the main path), and games from a file into the profile
// (M16). One sentence says what goes out, a row per thing to do. An import shows what the file
// holds and asks which name is you before anything counts; nothing leaves or arrives without
// these taps.

// Files bigger than this are no game history.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024
// Names offered as "that's me"; the rest stay assignable in the Rangliste.
const NAMES_OFFERED = 8

type Stage =
  | { kind: "menu" }
  | { kind: "reading" }
  | { kind: "preview"; file: HistoryFile }
  | { kind: "problem"; reason: Exclude<HistoryFileResult, { ok: true }>["reason"] }
  | { kind: "done"; from: HistoryFile["kind"]; added: number; known: number; as: string | null }

export function HistorySheet({ own, open, onOpenChange }: { own: OwnProfile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const h = tx.history
  const games = useProfileGames(own)
  const [failed, setFailed] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: "menu" })
  const fileInput = useRef<HTMLInputElement>(null)
  // A read or import still running when the sheet was closed says nothing afterwards.
  const opening = useRef(0)
  const oldest = games.length > 0 ? Math.min(...games.map((g) => Date.parse(g.match.finishedAt) || Date.now())) : null

  // The file is built right in the tap, so the share sheet opens within it.
  const share = (extension: "csv" | "json") => {
    setFailed(false)
    try {
      const name = historyFileName(h.fileName, extension)
      const labels = { columns: h.columns, won: h.won, lost: h.lost, training: h.training, imported: h.imported, local: h.local, mode: (m: { modeId: string; modeName: string }) => modeName(t, m.modeId, m.modeName) }
      const file =
        extension === "csv" ?
          new File([historyCsv(games, labels)], name, { type: "text/csv" })
        : new File([JSON.stringify(historyJson(games), null, 2)], name, { type: "application/json" })
      if (offersFileShare(file)) {
        void shareFile(file).then((shared) => {
          if (shared === "blocked" || shared === "failed") saveFile(file, name)
        })
      } else saveFile(file, name)
    } catch {
      setFailed(true)
    }
  }

  const read = async (chosen: File) => {
    const round = opening.current
    const settle = (next: Stage) => round === opening.current && setStage(next)
    setStage({ kind: "reading" })
    if (chosen.size > MAX_IMPORT_BYTES) return settle({ kind: "problem", reason: "format" })
    try {
      const { readHistoryFile } = await import("@/lib/profile/import")
      const result = readHistoryFile(await chosen.text())
      settle(result.ok ? { kind: "preview", file: result.file } : { kind: "problem", reason: result.reason })
    } catch {
      settle({ kind: "problem", reason: "format" })
    }
  }

  const close = (next: boolean) => {
    onOpenChange(next)
    if (next) return
    // The next opening starts at the menu, after the sheet has gone.
    opening.current++
    setTimeout(() => setStage({ kind: "menu" }), 400)
  }

  return (
    <Sheet open={open} onOpenChange={close} title={h.title}>
      <SheetBody>
        {stage.kind === "menu" && (
          <>
            <p className="text-[1.0625rem] leading-snug text-muted-foreground">{oldest === null ? h.none : h.intro(games.length, monthYear(t, oldest))}</p>
            <div className="mt-4 grid gap-2">
              <FileRow icon={FileSpreadsheet} title={h.csv} hint={h.csvHint} disabled={games.length === 0} onClick={() => share("csv")} />
              <FileRow icon={FileJson} title={h.json} hint={h.jsonHint} disabled={games.length === 0} onClick={() => share("json")} />
              <FileRow icon={FileInput} title={h.importRow} hint={h.importHint} onClick={() => fileInput.current?.click()} />
            </div>
            {failed && (
              <InlineStatus tone="error" className="mt-3">
                {h.failed}
              </InlineStatus>
            )}
            <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">{h.hint}</p>
            <Button variant="ghost" onClick={() => close(false)} className="mt-3 h-12 w-full rounded-2xl text-[1.0625rem]">
              {t.common.done}
            </Button>
          </>
        )}
        {stage.kind === "reading" && (
          <p role="status" className="py-6 text-center text-[1.0625rem] text-muted-foreground">
            {h.reading}
          </p>
        )}
        {stage.kind === "problem" && (
          <>
            <InlineStatus tone="error">{stage.reason === "empty" ? h.importEmpty : stage.reason === "newer" ? h.importNewer : h.importFormat}</InlineStatus>
            <Button variant="ghost" onClick={() => setStage({ kind: "menu" })} className="mt-3 h-12 w-full rounded-2xl text-[1.0625rem]">
              {t.common.back}
            </Button>
          </>
        )}
        {stage.kind === "preview" && <Preview own={own} file={stage.file} onDone={(done) => setStage(done)} onCancel={() => setStage({ kind: "menu" })} />}
        {stage.kind === "done" && <Done stage={stage} onClose={() => close(false)} />}
      </SheetBody>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,.json,text/csv,application/json,text/plain"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files?.[0]
          // Cleared, so choosing the same file again still counts.
          event.target.value = ""
          if (chosen) void read(chosen)
        }}
      />
    </Sheet>
  )
}

// The outcome, read out and with the focus on the one button left, since the one tapped is gone.
// Games from a table know names and totals only; the app's JSON brings games whole.
function Done({ stage, onClose }: { stage: Extract<Stage, { kind: "done" }>; onClose: () => void }) {
  const t = useT()
  const h = useAreaT(PROFILE_TEXTS).history
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => button.current?.focus(), [])
  return (
    <>
      <div role="status">
        <p className="text-[1.0625rem] leading-snug">{h.importDone(stage.added, stage.known)}</p>
        {stage.as && <p className="mt-1 text-[1.0625rem] leading-snug text-muted-foreground">{h.importedAs(stage.as)}</p>}
      </div>
      {stage.from === "csv" && <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">{h.importNote}</p>}
      <Button ref={button} onClick={onClose} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {t.common.done}
      </Button>
    </>
  )
}

// What the file holds, and which of its names is the player; then the import.
function Preview({ own, file, onDone, onCancel }: { own: OwnProfile; file: HistoryFile; onDone: (stage: Extract<Stage, { kind: "done" }>) => void; onCancel: () => void }) {
  const t = useT()
  const h = useAreaT(PROFILE_TEXTS).history
  const offered = file.names.slice(0, NAMES_OFFERED)
  const ownKey = nameKey(own.player?.name ?? own.name ?? "")
  const [me, setMe] = useState<string>(() => offered.find((n) => nameKey(n.name) === ownKey)?.name ?? "")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const date = (iso: string) => formatDate(t, Date.parse(iso))
  const questionId = useId()

  const run = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const { importMatches } = await import("@/lib/storage/data")
      const merged = await importMatches(file.matches)
      let as: string | null = null
      if (me && own.player && (await assignImportedName(me, own.player.id)) !== false) as = me
      onDone({ kind: "done", from: file.kind, added: merged.added, known: merged.known, as })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-[1.0625rem] leading-snug">
        {h.found(file.matches.length, date(file.from ?? ""), date(file.to ?? ""))} {h.foundNames(file.names.length)}.
      </p>
      {file.skipped > 0 && <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{h.unreadable(file.skipped)}</p>}
      {own.player && offered.length > 0 && (
        <>
          <p id={questionId} className="mb-2 mt-4 px-4 text-[0.8125rem] text-muted-foreground">
            {h.whoAreYou}
          </p>
          <ChoiceList
            labelledBy={questionId}
            options={[...offered.map((n) => ({ value: n.name, title: n.name, subtitle: h.nameGames(n.games) })), { value: "", title: h.nobody }]}
            value={me}
            onChange={setMe}
            disabled={busy}
          />
          <p className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">{h.whoAreYouHint}</p>
        </>
      )}
      {failed && (
        <InlineStatus tone="error" className="mt-3">
          {h.importFailed}
        </InlineStatus>
      )}
      <Button onClick={() => void run()} disabled={busy} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {h.importButton}
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={busy} className="mt-2 h-12 w-full rounded-2xl text-[1.0625rem]">
        {t.common.cancel}
      </Button>
    </>
  )
}

// One thing to do with a file as a row: what it is and whom it is for.
function FileRow({ icon: Icon, title, hint, disabled, onClick }: { icon: typeof FileJson; title: string; hint: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-secondary px-4 py-2 text-left transition-colors active:bg-secondary/70 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[1.0625rem] font-medium leading-snug">{title}</span>
        <span className="block text-[0.8125rem] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}
