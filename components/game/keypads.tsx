"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Delete, Undo2 } from "lucide-react"
import { CRICKET_TARGETS, IMPOSSIBLE_VISITS, onADouble, type MatchState } from "@/lib/game/engine"
import { suggestCheckout } from "@/lib/game/checkout"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import type { Dart, Multiplier } from "@/lib/game/types"
import { cn } from "@/lib/utils"

type KeyTone = "plain" | "quiet" | "accent" | "selected"

function Key({
  children,
  onPress,
  tone = "plain",
  disabled,
  label,
  className,
}: {
  children: ReactNode
  onPress: () => void
  tone?: KeyTone
  disabled?: boolean
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={label}
      aria-pressed={tone === "selected" ? true : undefined}
      className={cn(
        "flex min-h-0 min-w-0 touch-manipulation select-none items-center justify-center rounded-xl font-semibold transition-[transform,background-color,opacity] duration-75 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "plain" && "bg-key text-foreground shadow-[0_1px_0_hsl(var(--key-shadow))] active:bg-key-pressed",
        tone === "quiet" && "bg-key-quiet text-muted-foreground shadow-[0_1px_0_hsl(var(--key-shadow))] active:bg-key-pressed",
        tone === "accent" && "bg-primary text-primary-foreground active:bg-primary/80",
        tone === "selected" && "bg-primary text-primary-foreground ring-2 ring-primary/40",
        className,
      )}
    >
      {children}
    </button>
  )
}

// Undo, as a wide key with icon and word side by side, or a one-column key with them stacked.
function UndoKey({ onUndo, canUndo, narrow, className }: { onUndo: () => void; canUndo: boolean; narrow?: boolean; className?: string }) {
  const t = useT()
  return (
    <Key
      onPress={onUndo}
      disabled={!canUndo}
      tone="quiet"
      label={t.common.undoLastDart}
      className={cn(narrow ? "flex-col gap-0.5 px-1 [container-type:inline-size]" : "gap-1.5 text-[0.9375rem]", className)}
    >
      <Undo2 className="h-5 w-5 shrink-0" aria-hidden="true" />
      {narrow ? (
        <span className="w-full [@container(max-width:3.5rem)]:hidden">
          <FitText minScale={0.75} className="text-center text-[0.8125rem] font-medium tablet:text-base">
            {t.common.undo}
          </FitText>
        </span>
      ) : (
        t.common.undo
      )}
    </Key>
  )
}

// Desktop keyboard: type 1–20 (or 25), D / T for double and treble, M for a miss, Backspace to undo.
function useDartKeys(
  enabled: boolean,
  onDart: (d: Dart) => void,
  onUndo: () => void,
  setMultiplier: (m: Multiplier) => void,
  multiplierRef: React.MutableRefObject<Multiplier>,
) {
  const buffer = useRef("")
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return
    const commit = () => {
      clearTimeout(timer.current)
      const n = Number(buffer.current)
      buffer.current = ""
      if ((n >= 1 && n <= 20) || n === 25) {
        const m = n === 25 && multiplierRef.current === 3 ? 1 : multiplierRef.current
        onDart({ segment: n, multiplier: m })
        setMultiplier(1)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (/^[0-9]$/.test(k)) {
        buffer.current += k
        const n = Number(buffer.current)
        if (buffer.current.length === 2 || n >= 3) commit()
        else {
          clearTimeout(timer.current)
          timer.current = setTimeout(commit, 650)
        }
      } else if (k === "enter" && buffer.current) commit()
      else if (k === "d") setMultiplier(multiplierRef.current === 2 ? 1 : 2)
      else if (k === "t") setMultiplier(multiplierRef.current === 3 ? 1 : 3)
      else if (k === "m") {
        onDart({ segment: 0, multiplier: 1 })
        setMultiplier(1)
      } else if (k === "b") {
        onDart({ segment: 25, multiplier: 2 })
        setMultiplier(1)
      } else if (k === "backspace") {
        e.preventDefault()
        onUndo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      clearTimeout(timer.current)
    }
  }, [enabled, onDart, onUndo, setMultiplier, multiplierRef])
}

function useMultiplier() {
  const [multiplier, setState] = useState<Multiplier>(1)
  const ref = useRef<Multiplier>(1)
  const set = useRef((m: Multiplier) => {
    ref.current = m
    setState(m)
  }).current
  return [multiplier, set, ref] as const
}

function ModifierRow({
  multiplier,
  setMultiplier,
  onNoScore,
  dartsLeft,
}: {
  multiplier: Multiplier
  setMultiplier: (m: Multiplier) => void
  onNoScore: () => void
  dartsLeft: number
}) {
  const t = useT()
  return (
    <>
      <Key
        tone={multiplier === 2 ? "selected" : "quiet"}
        onPress={() => setMultiplier(multiplier === 2 ? 1 : 2)}
        className="col-span-2 text-[1.0625rem] tablet:text-xl"
      >
        {t.keypad.double}
      </Key>
      <Key
        tone={multiplier === 3 ? "selected" : "quiet"}
        onPress={() => setMultiplier(multiplier === 3 ? 1 : 3)}
        className="col-span-2 text-[1.0625rem] tablet:text-xl"
      >
        {t.keypad.triple}
      </Key>
      <RestMissedKey onNoScore={onNoScore} dartsLeft={dartsLeft} />
    </>
  )
}

// Ends the visit with 0 for the darts not thrown yet: all off the board, bounce-outs, a dud
// visit. It says how many misses it enters ("2×" over "Miss"), so it reads as the Miss key
// for the rest of the visit, not as a second word for the same thing.
function RestMissedKey({ onNoScore, dartsLeft, wide }: { onNoScore: () => void; dartsLeft: number; wide?: boolean }) {
  const t = useT()
  return (
    <Key
      tone="quiet"
      onPress={onNoScore}
      label={t.keypad.restLabel(dartsLeft)}
      className={cn("px-1 leading-tight", wide ? "gap-1.5 text-[0.9375rem]" : "flex-col")}
    >
      <span className={cn("tabular-nums", !wide && "text-[1.0625rem] tablet:text-xl")}>{t.keypad.restCount(dartsLeft)}</span>
      {wide ? (
        t.common.miss
      ) : (
        <FitText minScale={0.7} className="w-full text-center text-[0.75rem] font-medium tablet:text-[0.9375rem]">
          {t.common.miss}
        </FitText>
      )}
    </Key>
  )
}

// One dart that scores nothing: missed the board, bounced out or fell out.
function MissKey({ onPress, className }: { onPress: () => void; className?: string }) {
  const t = useT()
  return (
    <Key tone="quiet" onPress={onPress} label={t.keypad.missLabel} className={cn("flex-col px-0.5 leading-tight", className)}>
      {/* Words differ in length by language ("Miss", "Daneben"): the label shrinks to fit the key. */}
      <FitText minScale={0.6} className="w-full text-center text-[1.0625rem] tablet:text-xl">
        {t.common.miss}
      </FitText>
      <span className="text-[0.6875rem] font-medium tablet:text-[0.8125rem]">0</span>
    </Key>
  )
}

const prefix = (m: Multiplier) => (m === 3 ? "T" : m === 2 ? "D" : "")

interface DartPadProps {
  onDart: (dart: Dart) => void
  onNoScore: () => void
  onUndo: () => void
  canUndo: boolean
  keyboard: boolean
  // Darts still to throw in this visit: what the "rest missed" key fills.
  dartsLeft: number
}

export function X01DartPad({ onDart, onNoScore, onUndo, canUndo, keyboard, dartsLeft }: DartPadProps) {
  const t = useT()
  const [multiplier, setMultiplier, multiplierRef] = useMultiplier()
  useDartKeys(keyboard, onDart, onUndo, setMultiplier, multiplierRef)

  const hit = (segment: number, m: Multiplier = multiplier) => {
    onDart({ segment, multiplier: m })
    setMultiplier(1)
  }

  return (
    <div className="grid h-full grid-cols-5 grid-rows-6 gap-1.5 short:gap-1 tablet:gap-2.5">
      <ModifierRow multiplier={multiplier} setMultiplier={setMultiplier} onNoScore={onNoScore} dartsLeft={dartsLeft} />
      {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
        <Key key={n} onPress={() => hit(n)} label={`${prefix(multiplier)}${n}`} className="text-[clamp(1.1rem,3.4dvh,2.5rem)] tabular-nums">
          {multiplier > 1 && <span className="mr-px text-[0.55em] text-primary">{prefix(multiplier)}</span>}
          {n}
        </Key>
      ))}
      <MissKey onPress={() => hit(0, 1)} />
      <Key onPress={() => hit(25, multiplier === 2 ? 2 : 1)} disabled={multiplier === 3} label={multiplier === 2 ? t.keypad.bullLabel : t.keypad.outerBullLabel} className="text-[1.0625rem]">
        {multiplier === 2 ? t.common.bull : "25"}
      </Key>
      <Key onPress={() => hit(25, 2)} disabled={multiplier === 3} label={t.keypad.bullLabel} className="text-[1.0625rem]">
        {t.common.bull}
      </Key>
      <UndoKey onUndo={onUndo} canUndo={canUndo} className="col-span-2" />
    </div>
  )
}

const MAX_VISIT = 180

// The totals pub scorers enter most, one tap each.
const QUICK_TOTALS = [26, 45, 60, 100, 140, 180]

// While typing, a total only accepts digits that can still make a real three-dart score, so
// 181 or 179 can never be entered and no error message is needed.
function canBecome(text: string) {
  const n = Number(text)
  if (text.length > 3 || n > MAX_VISIT) return false
  return text.length < 3 || !IMPOSSIBLE_VISITS.has(n)
}

const appendDigit = (typed: string, digit: string) => (typed + digit).replace(/^0+(?=\d)/, "")

export function VisitTotalPad({
  typed,
  setTyped,
  remaining,
  doubleOut,
  askAtDouble,
  onSubmit,
  onUndo,
  canUndo,
  keyboard,
}: {
  typed: string
  setTyped: (value: string) => void
  remaining: number
  doubleOut: boolean
  askAtDouble: boolean
  onSubmit: (total: number, darts: number, atDouble?: number) => void
  onUndo: () => void
  canUndo: boolean
  keyboard: boolean
}) {
  const t = useT()
  const [zeroLine, bustLine] = t.keypad.zeroOrBust
  // Follow-up questions after Enter: darts used for a checkout, darts at a double.
  const [question, setQuestion] = useState<{ kind: "checkout"; options: number[] } | { kind: "atDouble" } | null>(null)
  const startedOnDouble = doubleOut && onADouble(remaining, doubleOut)
  const finishOptions = (total: number) => [1, 2, 3].filter((n) => suggestCheckout(total, n, doubleOut) !== null)

  // The visit panel shows what a typed total will do (bust, checkout); the pad only needs to
  // know when Enter can't be used and when a total started on a double.
  const total = typed === "" ? null : Number(typed)
  const left = total === null ? null : remaining - total
  const bust = left !== null && (left < 0 || (doubleOut && left === 1))
  const impossibleFinish = left === 0 && finishOptions(remaining).length === 0

  const press = (digit: string) => {
    const next = appendDigit(typed, digit)
    if (canBecome(next)) setTyped(next)
  }

  const finish = (value: number, darts: number, atDouble?: number) => {
    onSubmit(value, darts, atDouble)
    setTyped("")
    setQuestion(null)
  }

  const submit = (value: number) => {
    if (value === remaining) {
      const options = finishOptions(value)
      if (options.length === 0) return
      // Only one way to finish: no need to ask.
      if (options.length === 1) return finish(value, options[0], startedOnDouble ? options[0] : 1)
      setTyped(`${value}`)
      setQuestion({ kind: "checkout", options })
      return
    }
    if (askAtDouble && startedOnDouble && !bust) {
      setTyped(`${value}`)
      setQuestion({ kind: "atDouble" })
      return
    }
    finish(value, 3)
  }

  useEffect(() => {
    if (!keyboard || question) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === "Enter" && total !== null && !impossibleFinish) submit(total)
      else if (e.key === "Backspace") {
        e.preventDefault()
        if (typed) setTyped(typed.slice(0, -1))
        else onUndo()
      } else if (e.key === "Escape") setTyped("")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (question) {
    const checkoutQuestion = question.kind === "checkout"
    const choices = checkoutQuestion ? [1, 2, 3] : [0, 1, 2, 3]
    return (
      <div className="flex h-full flex-col gap-2">
        <p className="shrink-0 px-1 text-center text-[1.0625rem] font-semibold">
          {checkoutQuestion ? t.keypad.checkoutQuestion(typed) : t.keypad.atDoubleQuestion}
        </p>
        <div className={cn("grid min-h-0 flex-1 gap-2", checkoutQuestion ? "grid-cols-3" : "grid-cols-4")}>
          {choices.map((n) => {
            const allowed = !checkoutQuestion || question.options.includes(n)
            return (
              <Key
                key={n}
                tone={checkoutQuestion && allowed ? "accent" : allowed ? "plain" : "quiet"}
                disabled={!allowed}
                onPress={() =>
                  checkoutQuestion ? finish(Number(typed), n, startedOnDouble ? n : 1) : finish(Number(typed), 3, n)
                }
                className="flex-col text-3xl"
              >
                {n}
                <span className="text-[0.8125rem] font-medium">{t.common.dartWord(n)}</span>
              </Key>
            )
          })}
        </div>
        <Key tone="quiet" onPress={() => setQuestion(null)} className="h-11 shrink-0 text-[1.0625rem]">
          {t.common.back}
        </Key>
      </div>
    )
  }

  const digitKey = (d: string) => (
    <Key key={d} onPress={() => press(d)} disabled={!canBecome(appendDigit(typed, d))} className="text-[clamp(1.25rem,3.6dvh,2.75rem)]">
      {d}
    </Key>
  )

  return (
    <div className="flex h-full flex-col gap-1.5 short:gap-1 tablet:gap-2.5">
      {/* One tap enters the whole visit; hidden on short screens to keep keys large. */}
      <div className="grid shrink-0 grid-cols-6 gap-1.5 [@media(max-height:699px)]:hidden tablet:gap-2.5">
        {QUICK_TOTALS.map((n) => (
          <Key key={n} tone="quiet" onPress={() => submit(n)} label={t.keypad.quickTotal(n)} className="h-12 text-[1.0625rem] tabular-nums text-foreground tablet:h-14 tablet:text-xl">
            {n}
          </Key>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-5 gap-1.5 short:gap-1 tablet:gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digitKey)}
        <Key tone="quiet" onPress={() => submit(0)} className="flex-col text-[0.9375rem] leading-tight" label={t.keypad.zeroOrBustLabel}>
          <span>{zeroLine}</span>
          <span className="text-[0.6875rem] font-medium">{bustLine}</span>
        </Key>
        {digitKey("0")}
        <Key tone="quiet" onPress={() => setTyped(typed.slice(0, -1))} disabled={!typed} label={t.keypad.deleteDigit}>
          <Delete className="h-6 w-6" aria-hidden="true" />
        </Key>
        <UndoKey onUndo={onUndo} canUndo={canUndo} />
        <Key tone="accent" onPress={() => total !== null && submit(total)} disabled={total === null || impossibleFinish} className="col-span-2 text-[1.0625rem]">
          {t.keypad.enter(typed)}
        </Key>
      </div>
    </div>
  )
}

export function CricketPad({ onDart, onNoScore, onUndo, canUndo, keyboard, dartsLeft, state }: DartPadProps & { state: MatchState }) {
  const t = useT()
  const [multiplier, setMultiplier, multiplierRef] = useMultiplier()
  useDartKeys(keyboard, onDart, onUndo, setMultiplier, multiplierRef)
  const p = state.current

  const hit = (segment: number, m: Multiplier = multiplier) => {
    onDart({ segment, multiplier: m })
    setMultiplier(1)
  }

  // The 25 key turns into Bull with Double, like on the X01 pad; the Bull key is always 50.
  const targetKey = (target: number, alwaysBull = false) => {
    const mine = state.marks[p][target]
    const dead = state.config.players.every((_, i) => state.marks[i][target] >= 3)
    const bull = target === 25
    const asBull = alwaysBull || (bull && multiplier === 2)
    const label = bull ? (asBull ? t.common.bull : "25") : `${prefix(multiplier)}${target}`
    return (
      <Key
        key={alwaysBull ? "bull" : target}
        onPress={() => hit(target, asBull ? 2 : multiplier)}
        disabled={bull && multiplier === 3}
        tone={dead ? "quiet" : "plain"}
        label={`${label}${dead ? t.keypad.closedByAll : mine >= 3 ? t.keypad.closedScores : ""}`}
        className={cn("relative flex-col tabular-nums", bull ? "text-[clamp(1rem,3dvh,1.75rem)]" : "text-[clamp(1.1rem,3.6dvh,2.5rem)]")}
      >
        <span>
          {multiplier > 1 && !bull && <span className="mr-px text-[0.55em] text-primary">{prefix(multiplier)}</span>}
          {label.replace(/^[DT]/, "")}
        </span>
        <span className="flex h-1.5 gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i < mine ? "bg-primary" : "bg-muted-foreground/25")} />
          ))}
        </span>
      </Key>
    )
  }

  return (
    // Three rows: modifiers, 20 to 16, then 15, the bulls, Miss and Undo.
    <div className="grid h-full grid-cols-5 grid-rows-3 gap-1.5 short:gap-1 tablet:gap-2.5">
      <ModifierRow multiplier={multiplier} setMultiplier={setMultiplier} onNoScore={onNoScore} dartsLeft={dartsLeft} />
      {CRICKET_TARGETS.slice(0, 5).map((target) => targetKey(target))}
      {targetKey(15)}
      {targetKey(25)}
      {targetKey(25, true)}
      <MissKey onPress={() => hit(0, 1)} />
      <UndoKey onUndo={onUndo} canUndo={canUndo} narrow />
    </div>
  )
}

export function ClockPad({ onDart, onNoScore, onUndo, canUndo, keyboard, dartsLeft, target }: DartPadProps & { target: number }) {
  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === "h" || k === "enter") onDart({ segment: target, multiplier: 1 })
      else if (k === "m" || k === " ") onDart({ segment: 0, multiplier: 1 })
      else if (k === "backspace") onUndo()
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [keyboard, onDart, onUndo, target])

  const t = useT()
  return (
    <div className="grid h-full grid-cols-2 grid-rows-[minmax(0,1fr)_minmax(2.75rem,0.28fr)] gap-2 tablet:gap-3">
      <Key tone="quiet" onPress={() => onDart({ segment: 0, multiplier: 1 })} className="flex-col gap-1 text-3xl">
        {t.common.miss}
        <span className="text-[0.8125rem] font-medium">{t.keypad.missTarget(target)}</span>
      </Key>
      <Key tone="accent" onPress={() => onDart({ segment: target, multiplier: 1 })} className="flex-col gap-1 text-3xl">
        {t.keypad.hit}
        <span className="text-[0.8125rem] font-medium">{t.keypad.hitTarget(target)}</span>
      </Key>
      <RestMissedKey onNoScore={onNoScore} dartsLeft={dartsLeft} wide />
      <UndoKey onUndo={onUndo} canUndo={canUndo} />
    </div>
  )
}
