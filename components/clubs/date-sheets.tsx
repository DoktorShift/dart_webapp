"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceRow } from "@/components/ui/group"
import { Sheet } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { SheetBody, SheetButton, formatDateTime, formatTime, personName, useChange } from "@/components/clubs/common"
import { Confirm } from "@/components/ui/confirm"
import { DateAnswer } from "@/components/clubs/date-answer"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { useProfileNames } from "@/components/profile/use-profile-names"
import { isLeader, type ClubView } from "@/lib/clubs/club"
import { cancelDate, repeatDates, saveDates, type Answer, type ClubDate } from "@/lib/clubs/dates"
import type { ClubState } from "@/lib/protocol/club-state"

const ANSWER_ORDER: Answer[] = ["yes", "maybe", "no"]

// A date in full: when and where, your answer, who is coming, and for leaders the cancellation.
export function DateSheet({ view, state, date, open, onOpenChange }: { view: ClubView; state: ClubState; date: ClubDate | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const describe = useChange()
  const answers = date ? Object.entries(date.answers) : []
  const names = useProfileNames(answers.map(([pubkey]) => pubkey))
  const [cancelling, setCancelling] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const leader = isLeader(view.me.role) && !state.info.archived
  const member = view.me.status === "member" && !state.info.archived
  const sorted = [...answers].sort((a, b) => ANSWER_ORDER.indexOf(a[1].answer) - ANSWER_ORDER.indexOf(b[1].answer))

  const cancel = async () => {
    if (!date) return
    setProblem(null)
    try {
      await cancelDate(state, date, await clubAuthor())
      onOpenChange(false)
    } catch (error) {
      setProblem(describe(error))
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={date?.title ?? ""}
      description={date ? [`${formatDateTime(date.starts, t)}${date.ends !== undefined ? ` – ${formatTime(date.ends * 1000, t)}` : ""}`, date.place].filter(Boolean).join(" · ") : undefined}
    >
      <SheetBody>
        {date?.cancelled && (
          <InlineStatus tone="info" className="mb-4">
            {tx.dates.cancelled}
          </InlineStatus>
        )}
        {date?.note && <p className="mb-4 text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">{date.note}</p>}
        {date && member && !date.cancelled && <DateAnswer view={view} state={state} date={date} />}
        <p className="mb-2 mt-4 text-[0.8125rem] text-muted-foreground">{tx.dates.who}</p>
        {sorted.length === 0 ? (
          <p className="text-[0.9375rem] text-muted-foreground">{tx.dates.nobody}</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {sorted.map(([pubkey, a]) => (
              <li key={pubkey} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-[1.0625rem]">
                <span className="min-w-0 [overflow-wrap:anywhere]">{personName(pubkey, names(pubkey), tx, { me: view.me.pubkey })}</span>
                <span className="shrink-0 text-[0.9375rem] text-muted-foreground">{tx.dates.answered[a.answer]}</span>
              </li>
            ))}
          </ul>
        )}
        {problem && (
          <InlineStatus tone="error" className="mt-4">
            {problem}
          </InlineStatus>
        )}
        {date && leader && !date.cancelled && (
          <Button variant="ghost" onClick={() => setCancelling(true)} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] text-danger hover:bg-danger/10 hover:text-danger">
            {tx.dates.cancel}
          </Button>
        )}
      </SheetBody>
      <SheetButton onClick={() => onOpenChange(false)}>{t.common.done}</SheetButton>
      <Confirm open={cancelling} onOpenChange={setCancelling} title={tx.dates.cancelTitle} text={tx.dates.cancelText} confirm={tx.dates.cancelConfirm} destructive onConfirm={() => void cancel()} />
    </Sheet>
  )
}

const REPEATS = [1, 4, 8, 12]

// A date as the datetime-local input writes it, in local time.
function toInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Tomorrow at eight: the usual club night.
function defaultStart() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(20, 0, 0, 0)
  return toInput(date)
}

const toUnix = (input: string) => {
  const ms = new Date(input).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

// "Termin eintragen": title, start, optionally end, place and note, and whether the club night
// repeats weekly (each evening becomes a date of its own).
export function DateFormSheet({ state, open, onOpenChange }: { state: ClubState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const f = tx.dates.form
  const describe = useChange()
  const [title, setTitle] = useState(f.titleDefault)
  const [starts, setStarts] = useState(defaultStart)
  const [ends, setEnds] = useState("")
  const [place, setPlace] = useState("")
  const [note, setNote] = useState("")
  const [repeat, setRepeat] = useState(1)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const start = toUnix(starts)
  const end = ends ? toUnix(ends) : undefined
  const invalid = end !== undefined && end !== null && start !== null && end <= start
  const ready = title.trim() !== "" && start !== null && end !== null && !invalid

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy || start === null) return
    setBusy(true)
    setProblem(null)
    try {
      const first = { title: title.trim(), starts: start, ...(end ? { ends: end } : {}), ...(place.trim() ? { place: place.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }
      await saveDates(state, repeatDates(first, 7, repeat), await clubAuthor())
      onOpenChange(false)
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tx.dates.add}>
      <SheetBody>
        <form onSubmit={submit}>
          <TextField label={f.title} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} className="mt-0" />
          <TextField label={f.starts} type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} required />
          <TextField label={f.ends} type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} error={invalid ? f.invalid : undefined} />
          <TextField label={f.place} value={place} onChange={(event) => setPlace(event.target.value)} maxLength={140} />
          <TextField label={f.note} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          <div className="mt-6 rounded-2xl border border-border bg-card">
            <ChoiceRow title={f.repeat} hint={f.repeatHint} options={REPEATS.map((n) => ({ value: n, label: n === 1 ? f.once : f.weekly(n) }))} value={repeat} onChange={setRepeat} />
          </div>
          {problem && (
            <InlineStatus tone="error" className="mt-4">
              {problem}
            </InlineStatus>
          )}
          <Button type="submit" disabled={!ready || busy} className="mt-6 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {busy ? f.saving : f.save}
          </Button>
        </form>
      </SheetBody>
      <SheetButton onClick={() => onOpenChange(false)}>{t.common.cancel}</SheetButton>
    </Sheet>
  )
}
