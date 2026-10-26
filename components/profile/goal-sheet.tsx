"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetBody } from "@/components/ui/sheet"
import { TextField } from "@/components/ui/text-field"
import { InlineStatus } from "@/components/common/inline-status"
import { useAreaT, useT } from "@/components/i18n-provider"
import { PROFILE_TEXTS } from "@/lib/i18n/features/profile.screens"
import { measure } from "@/components/profile/format"
import type { GameType } from "@/lib/game/types"
import { GOAL_RANGE, goalText, parseGoal, saveGoal } from "@/lib/profile/goal"

// Profil › Training › Ziel: the monthly figure to reach in this game type, typed in, with the
// range it may take; "Ziel entfernen" takes the line out again. Saved on this device only.
export function GoalSheet({ type, value, open, onOpenChange }: { type: GameType; value: number | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const tx = useAreaT(PROFILE_TEXTS)
  const r = tx.training
  const [text, setText] = useState(value === null ? "" : goalText(type, value, t.intl))
  // The range turns into an error only once the typing is over (blur or submit), not per digit.
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const parsed = parseGoal(type, text)
  const invalid = checked && text.trim() !== "" && parsed === null
  const { min, max } = GOAL_RANGE[type]
  const range = r.goalRange(measure(t, type, min) ?? "", measure(t, type, max) ?? "")

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
        <p className="text-[1.0625rem] leading-snug text-muted-foreground">{r.goalText(r.measure[type])}</p>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault()
            setChecked(true)
            if (parsed !== null) void save(parsed)
          }}
        >
          <TextField
            label={r.measure[type]}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => setChecked(true)}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder={goalText(type, type === "x01" ? 60 : type === "cricket" ? 2.5 : 0.5, t.intl)}
            trailing={type === "clock" ? <span className="text-[1.0625rem] text-muted-foreground">%</span> : undefined}
            hint={invalid ? undefined : range}
            error={invalid ? range : undefined}
          />
          <Button type="submit" disabled={busy || parsed === null} className="mt-4 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
            {r.goalSave}
          </Button>
        </form>
        {value !== null && (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)} className="mt-2 h-12 w-full rounded-xl text-[1.0625rem] text-danger hover:text-danger">
            {r.goalRemove}
          </Button>
        )}
        {failed && (
          <InlineStatus tone="error" className="mt-3">
            {r.goalFailed}
          </InlineStatus>
        )}
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="mt-2 h-12 w-full rounded-2xl text-[1.0625rem]">
          {t.common.cancel}
        </Button>
      </SheetBody>
    </Sheet>
  )
}
