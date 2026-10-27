"use client"

import { useEffect, useId, useRef, useState } from "react"
import { FileInput, FileJson, FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceList } from "@/components/ui/choice-list"
import { Confirm } from "@/components/ui/confirm"
import { Sheet, SheetActions, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { Waiting } from "@/components/common/waiting"
import { useNav } from "@/components/nav/nav-context"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { monthYear } from "@/components/profile/format"
import { PROFILE_SCREENS } from "@/components/profile/screens"
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
// holds and asks which name is you before anything counts; it ends with where the games went
// and a way back (Apple Photos: an import is reviewable, never a dead end). Nothing leaves or
// arrives without these taps.

// Files bigger than this are no game history.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024
// Names offered as "that's me" before "weitere Namen"; the own name is always among them.
const NAMES_OFFERED = 8
const NOBODY = "\u0000nobody"

type Problem = Exclude<HistoryFileResult, { ok: true }>["reason"]
type Stage =
  | { kind: "menu" }
  | { kind: "reading" }
  | { kind: "preview"; file: HistoryFile }
  | { kind: "problem"; reason: Problem }
  | { kind: "done"; outcome: Outcome }

interface Outcome {
  from: HistoryFile["kind"]
  added: number
  known: number
  // The ids added, for the way back.
  ids: string[]
  // The name that now counts for the player, and whether this import made it so.
  as: string | null
  assigned: boolean
  trainings: number
}

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
  // Whether a file goes through the share sheet here, or is downloaded (computers).
  const [shareSheet, setShareSheet] = useState(false)
  useEffect(() => setShareSheet(offersFileShare(new File([""], "blueline.csv", { type: "text/csv" }))), [])
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
    if (chosen.size > MAX_IMPORT_BYTES) return settle({ kind: "problem", reason: "large" })
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

  const title = stage.kind === "reading" ? h.titleReading : stage.kind === "preview" ? h.titleImport : stage.kind === "problem" ? h.titleProblem : stage.kind === "done" ? h.titleDone : h.title
  const problemText = (reason: Problem) => (reason === "empty" ? h.importEmpty : reason === "newer" ? h.importNewer : reason === "large" ? h.importLarge : h.importFormat)

  return (
    <Sheet open={open} onOpenChange={close} title={title}>
      {stage.kind === "menu" && (
        <>
          <SheetBody>
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
            <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">
              {h.hint(shareSheet)} {h.importFootnote}
            </p>
          </SheetBody>
          <SheetActions>
            <Button variant="ghost" onClick={() => close(false)} className="h-12 w-full rounded-2xl text-[1.0625rem]">
              {t.common.done}
            </Button>
          </SheetActions>
        </>
      )}
      {stage.kind === "reading" && (
        <SheetBody>
          <Waiting>{h.reading}</Waiting>
        </SheetBody>
      )}
      {stage.kind === "problem" && (
        <>
          <SheetBody>
            <InlineStatus tone="error">{problemText(stage.reason)}</InlineStatus>
          </SheetBody>
          <SheetActions>
            <Button onClick={() => fileInput.current?.click()} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
              {h.otherFile}
            </Button>
            <Button variant="ghost" onClick={() => setStage({ kind: "menu" })} className="h-12 w-full rounded-2xl text-[1.0625rem]">
              {t.common.back}
            </Button>
          </SheetActions>
        </>
      )}
      {stage.kind === "preview" && <Preview own={own} file={stage.file} onDone={(outcome) => setStage({ kind: "done", outcome })} onCancel={() => setStage({ kind: "menu" })} />}
      {stage.kind === "done" && <Done own={own} outcome={stage.outcome} onClose={() => close(false)} />}
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

// What the file holds, and which of its names is the player; then the import. Nothing counts
// for the player until a name is chosen: "Keiner davon" is a choice, never the default.
function Preview({ own, file, onDone, onCancel }: { own: OwnProfile; file: HistoryFile; onDone: (outcome: Outcome) => void; onCancel: () => void }) {
  const t = useT()
  const h = useAreaT(PROFILE_TEXTS).history
  const ownKey = nameKey(own.player?.name ?? own.name ?? "")
  // The own name first, whatever its count; then the rest by games.
  const names = [...file.names.filter((n) => nameKey(n.name) === ownKey), ...file.names.filter((n) => nameKey(n.name) !== ownKey)]
  const [allNames, setAllNames] = useState(false)
  const offered = allNames ? names : names.slice(0, NAMES_OFFERED)
  const asked = own.player !== null && names.length > 0
  const [me, setMe] = useState<string | null>(() => names.find((n) => nameKey(n.name) === ownKey)?.name ?? null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const date = (iso: string) => formatDate(t, Date.parse(iso))
  const sentence = useRef<HTMLParagraphElement>(null)
  useEffect(() => sentence.current?.focus(), [])
  const questionId = useId()
  const hintId = useId()
  const trainings = file.matches.filter((m) => m.players.length === 1).length
  const versus = file.matches.length - trainings

  const run = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const { importMatches } = await import("@/lib/storage/data")
      const merged = await importMatches(file.matches)
      const chosen = me !== null && me !== NOBODY && own.player ? me : null
      const had = chosen !== null && (own.player?.importedNames ?? []).includes(nameKey(chosen))
      const as = chosen !== null && (await assignImportedName(chosen, own.player!.id)) !== false ? chosen : null
      onDone({ from: file.kind, added: merged.added, known: merged.known, ids: merged.ids, as, assigned: as !== null && !had, trainings })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetBody>
        <p ref={sentence} tabIndex={-1} className="text-[1.0625rem] leading-snug outline-none">
          {h.found(file.matches.length, date(file.from ?? ""), date(file.to ?? ""))}: {h.foundKinds(versus, trainings)}. {h.foundNames(file.names.length)}.
        </p>
        {(file.skipped > 0 || file.merged > 0) && (
          <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">
            {[file.skipped > 0 ? h.unreadable(file.skipped) : null, file.merged > 0 ? h.merged(file.merged) : null].filter(Boolean).join(" ")}
          </p>
        )}
        {asked ? (
          <>
            <p id={questionId} className="mb-2 mt-4 px-4 text-[0.8125rem] text-muted-foreground">
              {h.whoAreYou}
            </p>
            <ChoiceList
              labelledBy={questionId}
              describedBy={hintId}
              options={[...offered.map((n) => ({ value: n.name, title: n.name, subtitle: h.nameGames(n.games) })), { value: NOBODY, title: h.nobody }]}
              value={me}
              onChange={setMe}
              disabled={busy}
            />
            {!allNames && names.length > NAMES_OFFERED && (
              <Button variant="ghost" onClick={() => setAllNames(true)} className="mt-1 h-11 w-full rounded-xl text-[1rem] text-primary">
                {h.moreNames(names.length - NAMES_OFFERED)}
              </Button>
            )}
            <p id={hintId} className="mt-2 px-4 text-[0.8125rem] leading-snug text-muted-foreground">
              {h.whoAreYouHint}
            </p>
          </>
        ) : (
          <p className="mt-3 text-[0.9375rem] leading-snug text-muted-foreground">{h.noProfile}</p>
        )}
        {failed && (
          <InlineStatus tone="error" className="mt-3">
            {h.importFailed}
          </InlineStatus>
        )}
      </SheetBody>
      <SheetActions>
        <Button onClick={() => void run()} disabled={busy || (asked && me === null)} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {h.importButton}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy} className="h-12 w-full rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </SheetActions>
    </>
  )
}

// The outcome, read out, with the focus on "Fertig" since the button tapped is gone; where the
// games now are, one tap away; and the way back, asked once. Games from a table know names and
// totals only; the app's JSON brings games whole.
function Done({ own, outcome, onClose }: { own: OwnProfile; outcome: Outcome; onClose: () => void }) {
  const t = useT()
  const h = useAreaT(PROFILE_TEXTS).history
  const nav = useNav()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => button.current?.focus(), [])
  const [ask, setAsk] = useState(false)
  const [undone, setUndone] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const counted = outcome.as !== null
  const show = outcome.added === 0 ? null : !counted ? ("ranks" as const) : outcome.trainings > 0 && outcome.trainings * 2 >= outcome.added ? ("training" as const) : ("stats" as const)

  const go = () => {
    onClose()
    if (show === "ranks") nav.selectTab("leaderboard")
    else if (show === "training") nav.push(PROFILE_SCREENS.training, undefined, { tab: "profile" })
    else nav.push(PROFILE_SCREENS.stats, undefined, { tab: "profile" })
  }

  const undo = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const { removeMatches } = await import("@/lib/storage/data")
      const gone = await removeMatches(outcome.ids)
      if (outcome.assigned && outcome.as && own.player) await assignImportedName(outcome.as, null)
      setUndone(gone)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetBody>
        <div role="status">
          {undone !== null ? (
            <p className="text-[1.0625rem] leading-snug">{h.undone(undone)}</p>
          ) : (
            <>
              <p className="text-[1.0625rem] leading-snug">{h.importDone(outcome.added, outcome.known)}</p>
              {counted && <p className="mt-1 text-[1.0625rem] leading-snug text-muted-foreground">{h.importedAs(outcome.as!)}</p>}
              {!counted && outcome.added > 0 && <p className="mt-1 text-[1.0625rem] leading-snug text-muted-foreground">{h.inRanks}</p>}
            </>
          )}
        </div>
        {undone === null && outcome.from === "csv" && outcome.added > 0 && <p className="mt-3 text-[0.8125rem] leading-snug text-muted-foreground">{h.importNote}</p>}
        {failed && (
          <InlineStatus tone="error" className="mt-3">
            {h.importFailed}
          </InlineStatus>
        )}
      </SheetBody>
      <SheetActions>
        {undone === null && show && (
          <Button onClick={go} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {show === "ranks" ? h.showRanks : show === "training" ? h.showTraining : h.showStats}
          </Button>
        )}
        <Button ref={button} variant={undone === null && show ? "ghost" : "default"} onClick={onClose} className={undone === null && show ? "h-12 w-full rounded-2xl text-[1.0625rem]" : "h-12 w-full rounded-xl text-[1.0625rem] font-semibold"}>
          {t.common.done}
        </Button>
        {undone === null && outcome.ids.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => setAsk(true)} className="h-12 w-full rounded-2xl text-[1.0625rem] text-danger hover:text-danger">
            {h.undo}
          </Button>
        )}
      </SheetActions>
      <Confirm open={ask} onOpenChange={setAsk} title={h.undoTitle} text={h.undoText(outcome.ids.length)} confirm={h.undoConfirm} destructive onConfirm={() => void undo()} />
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
