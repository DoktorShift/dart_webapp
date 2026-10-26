"use client"

import { useId, useState, type ReactNode } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetActions, SheetBody } from "@/components/ui/sheet"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { measure } from "@/components/profile/format"
import type { GameType } from "@/lib/game/types"
import { GOAL_RANGE, goalText, parseGoal, saveGoal, stepGoal, suggestedGoal } from "@/lib/profile/goal"
import { cn } from "@/lib/utils"

// Profil › Training › Ziel: the figure to reach in this game type, set the way Apple Fitness sets
// a goal: the number large in the middle, − and + beside it, typing into the number still
// possible. It starts a little above where the player stands this month. The range turns into
// an error only once typing is over, never per digit. "Ziel entfernen" takes the line out again.
// Saved on this device only.
export function GoalSheet({ type, value, current, open, onOpenChange }: { type: GameType; value: number | null; current: number | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const r = tx.training
  const id = useId()
  const [text, setText] = useState(() => goalText(type, value ?? suggestedGoal(type, current), t.intl))
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const parsed = parseGoal(type, text)
  const invalid = checked && parsed === null
  const { min, max } = GOAL_RANGE[type]
  const range = (write: (min: string, max: string) => string) => write(measure(t, type, min) ?? "", measure(t, type, max) ?? "")

  const step = (direction: 1 | -1) => {
    setChecked(false)
    setText(goalText(type, stepGoal(type, parsed ?? suggestedGoal(type, current), direction), t.intl))
  }

  const save = async (next: number | null) => {
    setBusy(true)
    setFailed(false)
    try {
      await saveGoal(type, next)
      onOpenChange(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={r.goalTitle}>
      <SheetBody>
        <p className="text-[1.0625rem] leading-snug text-muted-foreground [@media(max-height:500px)]:sr-only">{r.goalText(r.measure[type])}</p>
        <form
          id={`${id}-form`}
          className="mt-5 [@media(max-height:500px)]:mt-1"
          onSubmit={(event) => {
            event.preventDefault()
            setChecked(true)
            if (parsed !== null) void save(parsed)
          }}
        >
          <label htmlFor={id} className="block text-center text-[0.8125rem] text-muted-foreground">
            {r.measure[type]}
          </label>
          <div className="mt-2 flex items-center justify-center gap-4">
            <StepButton label={r.goalLess} onClick={() => step(-1)} disabled={busy || (parsed !== null && parsed <= min)}>
              <Minus className="h-6 w-6" aria-hidden="true" />
            </StepButton>
            <div className={cn("flex h-16 min-w-[7.5rem] items-center justify-center gap-1 rounded-2xl border bg-card px-3", invalid ? "border-danger" : "border-border")}>
              <input
                id={id}
                value={text}
                onChange={(event) => {
                  setChecked(false)
                  setText(event.target.value)
                }}
                onBlur={() => setChecked(true)}
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={invalid || undefined}
                aria-describedby={`${id}-note`}
                size={Math.max(2, text.length)}
                className="w-auto min-w-[3ch] max-w-[6ch] bg-transparent text-center font-display text-5xl font-semibold tabular-nums leading-none outline-none"
              />
              {type === "clock" && <span className="font-display text-3xl font-semibold text-muted-foreground">%</span>}
            </div>
            <StepButton label={r.goalMore} onClick={() => step(1)} disabled={busy || (parsed !== null && parsed >= max)}>
              <Plus className="h-6 w-6" aria-hidden="true" />
            </StepButton>
          </div>
          <p id={`${id}-note`} role={invalid ? "alert" : undefined} className={cn("mt-3 text-center text-[0.8125rem] leading-snug", invalid ? "text-danger" : "text-muted-foreground")}>
            {invalid ? range(r.goalRangeError) : range(r.goalRange)}
          </p>
        </form>
        {failed && (
          <InlineStatus tone="error" className="mt-3">
            {r.goalFailed}
          </InlineStatus>
        )}
      </SheetBody>
      <SheetActions>
        <Button type="submit" form={`${id}-form`} disabled={busy || parsed === null} className="h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
          {r.goalSave}
        </Button>
        {value !== null && (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)} className="h-12 w-full rounded-xl text-[1.0625rem] text-danger hover:text-danger">
            {r.goalRemove}
          </Button>
        )}
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-12 w-full rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </SheetActions>
    </Sheet>
  )
}

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-primary transition-colors active:bg-secondary/70 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  )
}
