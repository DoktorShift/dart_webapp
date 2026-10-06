"use client"

import { useState, type FormEvent } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceRow, Group, SwitchRow } from "@/components/ui/group"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { CLUBS_TEXTS } from "@/lib/i18n/features/clubs.screens"
import { useChange } from "@/components/clubs/common"
import { clubAuthor } from "@/components/clubs/use-clubs"
import { changeRules, createSeason, DEFAULT_RULES, seasonStarted } from "@/lib/clubs/seasons"
import { rulesOf } from "@/lib/clubs/table"
import { nowSeconds } from "@/lib/nostr/time"
import type { SeasonRules } from "@/lib/protocol/club"
import type { ClubSeason, ClubState } from "@/lib/protocol/club-state"
import type { ModeId } from "@/types/game-modes"
import { cn } from "@/lib/utils"

const MODES: ModeId[] = ["301", "501", "701", "cricket", "cutthroat", "clock"]
const MIN_GAMES = [0, 3, 5, 10]
const CONFIRMATIONS: SeasonRules["confirmations"][] = ["none", "opponent", "all"]
type Criterion = SeasonRules["tiebreak"][number]
const CRITERIA: Criterion[] = ["headToHead", "legDifference", "wins", "average"]

const toInputDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const fromInputDate = (input: string, endOfDay = false) => {
  const date = new Date(`${input}T${endOfDay ? "23:59:59" : "00:00:00"}`)
  const ms = date.getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

// A season's rules (PLAN.md "Clubs und Saisons"): set up before the first counted game; new
// versions after the start carry a reason everyone sees. The defaults fit a club night: 501,
// two points per win, an opponent confirms, ties by head to head.
export function SeasonForm({ state, season, onDone }: { state: ClubState; season?: ClubSeason; onDone: () => void }) {
  const t = useT()
  const tx = useAreaT(CLUBS_TEXTS)
  const sx = tx.season
  const describe = useChange()
  const [name, setName] = useState("")
  const [starts, setStarts] = useState(() => toInputDate(new Date()))
  const [ends, setEnds] = useState("")
  const [rules, setRules] = useState<SeasonRules>(() => (season ? rulesOf(season) : DEFAULT_RULES))
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const change = (patch: Partial<SeasonRules>) => setRules((current) => ({ ...current, ...patch }))
  const started = season ? seasonStarted(season, nowSeconds()) : false
  const needsReason = !!season && started
  const start = fromInputDate(starts)
  const end = ends ? fromInputDate(ends, true) : undefined
  const ready = rules.modes.length > 0 && (season ? !needsReason || reason.trim() !== "" : name.trim() !== "" && start !== null && end !== null && (end === undefined || end > start))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const author = await clubAuthor()
      if (season) await changeRules(state, season, rules, author, reason)
      else await createSeason(state, { name: name.trim(), starts: start as number, ...(end ? { ends: end } : {}), rules }, author)
      onDone()
    } catch (error) {
      setProblem(describe(error))
    } finally {
      setBusy(false)
    }
  }

  const toggleMode = (id: ModeId) => change({ modes: rules.modes.includes(id) ? rules.modes.filter((m) => m !== id) : [...rules.modes, id] })
  const points = (key: keyof SeasonRules["points"], value: string) => {
    const n = Number.parseInt(value, 10)
    if (Number.isInteger(n) && n >= 0 && n <= 10) change({ points: { ...rules.points, [key]: n } })
  }

  return (
    <form onSubmit={submit} className="pb-4">
      {!season && (
        <>
          <TextField label={sx.name} value={name} onChange={(event) => setName(event.target.value)} placeholder={sx.namePlaceholder} maxLength={60} autoFocus />
          <TextField label={sx.starts} type="date" value={starts} onChange={(event) => setStarts(event.target.value)} required />
          <TextField label={sx.ends} type="date" value={ends} onChange={(event) => setEnds(event.target.value)} />
        </>
      )}

      <section className="mt-6">
        <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{sx.modes}</p>
        <div className="flex flex-wrap gap-2 px-1">
          {MODES.map((id) => {
            const on = rules.modes.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMode(id)}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] transition-colors",
                  on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-secondary/50",
                )}
              >
                {on && <Check className="h-4 w-4" aria-hidden="true" />}
                {t.modes[id].name}
              </button>
            )
          })}
        </div>
        {rules.modes.length === 0 && <p className="mt-2 px-4 text-[0.8125rem] text-danger">{sx.needsMode}</p>}
      </section>

      <section className="mt-6">
        <p className="mb-2 px-4 text-[0.8125rem] text-muted-foreground">{sx.points}</p>
        <div className="grid grid-cols-3 gap-2">
          {(["win", "draw", "loss"] as const).map((key) => (
            <TextField key={key} label={sx[key]} type="number" inputMode="numeric" min={0} max={10} value={rules.points[key]} onChange={(event) => points(key, event.target.value)} className="mt-0" />
          ))}
        </div>
      </section>

      <Group>
        <ChoiceRow title={sx.confirmations} hint={sx.confirmHint[rules.confirmations]} options={CONFIRMATIONS.map((c) => ({ value: c, label: sx.confirm[c] }))} value={rules.confirmations} onChange={(confirmations) => change({ confirmations })} />
        <ChoiceRow title={sx.minGames} options={MIN_GAMES.map((n) => ({ value: n, label: sx.minGamesValue(n) }))} value={rules.minGames} onChange={(minGames) => change({ minGames })} />
      </Group>

      <Group title={sx.tiebreak} footer={sx.tiebreakHint}>
        {CRITERIA.map((criterion) => (
          <SwitchRow
            key={criterion}
            title={tx.table.tiebreak[criterion]}
            checked={rules.tiebreak.includes(criterion)}
            onCheckedChange={(checked) => change({ tiebreak: CRITERIA.filter((c) => (c === criterion ? checked : rules.tiebreak.includes(c))) })}
          />
        ))}
      </Group>

      {needsReason && <TextField label={sx.reason} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={280} hint={sx.reasonHint} />}
      {problem && (
        <InlineStatus tone="error" className="mt-4">
          {problem}
        </InlineStatus>
      )}
      <Button type="submit" disabled={!ready || busy} className="mt-6 h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
        {busy ? sx.saving : season ? sx.saveRules : sx.save}
      </Button>
    </form>
  )
}
