"use client"

import { useMemo, useRef, useState, type PointerEvent } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { ChevronLeft, GripVertical, Minus, Plus, Shuffle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChoiceRow, Group, SwitchRow } from "@/components/ui/group"
import { Dartboard, GAME_HIGHLIGHTS } from "@/components/dartboard"
import { useT } from "@/components/i18n-provider"
import { recentPlayerNames, useMatchHistory } from "@/lib/leaderboard"
import { loadLastPlayers, loadRules } from "@/lib/game/storage"
import { LEG_OPTIONS, SET_OPTIONS, START_SCORES, configFor, modeIdFor, type GameRules } from "@/lib/game/rules"
import type { GameType, MatchConfig } from "@/lib/game/types"
import { cn } from "@/lib/utils"

const MAX_PLAYERS = 6

interface SetupPlayer {
  key: string
  name: string
}

interface SetupScreenProps {
  type: GameType
  onBack: () => void
  onStart: (config: MatchConfig) => void
}

let keySeed = 0
const newKey = () => `p${Date.now().toString(36)}${keySeed++}`

function initialPlayers(): SetupPlayer[] {
  const last = loadLastPlayers().slice(0, MAX_PLAYERS)
  const names = last.length > 0 ? last : ["", ""]
  return names.map((name) => ({ key: newKey(), name }))
}

function PlayerRow({
  player,
  index,
  canRemove,
  duplicate,
  onChange,
  onRemove,
  onNext,
  inputRef,
}: {
  player: SetupPlayer
  index: number
  canRemove: boolean
  duplicate: boolean
  onChange: (name: string) => void
  onRemove: () => void
  onNext?: () => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const t = useT()
  const controls = useDragControls()
  const label = player.name || t.setup.placeholder(index + 1)
  return (
    <Reorder.Item
      value={player}
      dragListener={false}
      dragControls={controls}
      className="relative flex min-h-14 items-center gap-2 bg-card pl-2 pr-3"
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 32px -12px rgba(0,0,0,0.6)", zIndex: 10 }}
    >
      <button
        type="button"
        aria-label={t.setup.move(label)}
        onPointerDown={(e: PointerEvent) => controls.start(e)}
        className="flex h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <span className="w-5 shrink-0 text-center font-display text-lg font-semibold tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <input
        ref={inputRef}
        value={player.name}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.setup.placeholder(index + 1)}
        maxLength={16}
        autoComplete="off"
        autoCapitalize="words"
        // Return moves on to the next name; on the last one it closes the keyboard.
        enterKeyHint={onNext ? "next" : "done"}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          if (onNext) onNext()
          else e.currentTarget.blur()
        }}
        aria-invalid={duplicate}
        className={cn(
          "h-11 min-w-0 flex-1 bg-transparent text-[1.0625rem] outline-none placeholder:text-muted-foreground/60",
          duplicate && "text-danger",
        )}
      />
      {canRemove && (
        <button
          type="button"
          aria-label={t.setup.remove(label)}
          onClick={onRemove}
          className="flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-danger text-white">
            <Minus className="h-4 w-4" strokeWidth={3} />
          </span>
        </button>
      )}
    </Reorder.Item>
  )
}

export function SetupScreen({ type, onBack, onStart }: SetupScreenProps) {
  const t = useT()
  const [players, setPlayers] = useState<SetupPlayer[]>(initialPlayers)
  // The rules this group played last time, for this kind of game.
  const [rules, setRules] = useState<GameRules>(() => loadRules(type))
  const change = (patch: Partial<GameRules>) => setRules((current) => ({ ...current, ...patch }))
  const texts = t.modes[modeIdFor(type, rules)]
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const { matches } = useMatchHistory()

  const nameKeys = players.map((p) => p.name.trim().toLowerCase())
  const duplicates = new Set(nameKeys.filter((k, i) => k && nameKeys.indexOf(k) !== i))
  const recent = useMemo(
    () => recentPlayerNames(matches).filter((name) => !nameKeys.includes(name.toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, nameKeys.join("|")],
  )

  const addPlayer = (name = "") => {
    if (players.length >= MAX_PLAYERS) return
    const player = { key: newKey(), name }
    setPlayers((prev) => [...prev, player])
    if (!name) requestAnimationFrame(() => inputs.current.get(player.key)?.focus())
  }

  // A recent name fills the first empty row before adding a new one.
  const addRecent = (name: string) => {
    const empty = players.find((p) => !p.name.trim())
    if (empty) setPlayers((prev) => prev.map((p) => (p.key === empty.key ? { ...p, name } : p)))
    else addPlayer(name)
  }

  const shuffle = () => {
    setPlayers((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      return next
    })
  }

  const start = () => {
    const named = players.map((p, i) => ({ id: p.key, name: p.name.trim() || t.setup.placeholder(i + 1) }))
    onStart(configFor(type, rules, named, texts.name))
  }

  const multipleLegs = rules.legsToWin > 1
  const inSets = multipleLegs && rules.setsToWin > 1

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="relative mx-auto flex h-11 max-w-2xl items-center px-2">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-11 items-center gap-0.5 rounded-lg pr-3 text-[1.0625rem] text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-7 w-7" aria-hidden="true" />
            {t.nav.play}
          </button>
          <span className="pointer-events-none absolute inset-x-0 text-center text-[1.0625rem] font-semibold">{t.setup.title}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-5">
        <div className="flex items-center gap-4">
          <Dartboard variant="mini" highlight={GAME_HIGHLIGHTS[type]} className="h-14 w-14 shrink-0" />
          <div>
            <h1 className="font-display text-4xl font-semibold leading-none tracking-tight">{texts.name}</h1>
            <p className="mt-1 text-[0.9375rem] text-muted-foreground">{texts.description}</p>
          </div>
        </div>
        <p className="mt-4 rounded-2xl bg-secondary/50 px-4 py-3 text-[0.9375rem] leading-snug">
          {texts.rules({ doubleIn: rules.doubleIn, doubleOut: rules.doubleOut, bullFinish: rules.bullFinish })}
        </p>

        <section aria-labelledby="players-heading" className="mt-8">
          <div className="mb-2 flex items-end justify-between px-1">
            <h2 id="players-heading" className="text-[0.8125rem] font-medium text-muted-foreground">
              {t.setup.players}
            </h2>
            {players.length > 1 && (
              <button
                type="button"
                onClick={shuffle}
                className="-mr-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[0.9375rem] text-primary"
              >
                <Shuffle className="h-4 w-4" aria-hidden="true" />
                {t.setup.shuffle}
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <Reorder.Group axis="y" values={players} onReorder={setPlayers} className="divide-y divide-border">
              {players.map((player, index) => (
                <PlayerRow
                  key={player.key}
                  player={player}
                  index={index}
                  canRemove={players.length > 1}
                  duplicate={duplicates.has(player.name.trim().toLowerCase())}
                  onChange={(name) => setPlayers((prev) => prev.map((p) => (p.key === player.key ? { ...p, name } : p)))}
                  onRemove={() => setPlayers((prev) => prev.filter((p) => p.key !== player.key))}
                  onNext={index < players.length - 1 ? () => inputs.current.get(players[index + 1].key)?.focus() : undefined}
                  inputRef={(el) => {
                    if (el) inputs.current.set(player.key, el)
                    else inputs.current.delete(player.key)
                  }}
                />
              ))}
            </Reorder.Group>
            {players.length < MAX_PLAYERS && (
              <button
                type="button"
                onClick={() => addPlayer()}
                className="flex min-h-14 w-full items-center gap-3 border-t border-border px-4 text-[1.0625rem] text-primary active:bg-secondary/60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Plus className="h-4 w-4" strokeWidth={3} />
                </span>
                {t.setup.addPlayer}
              </button>
            )}
          </div>
          <p className="mt-2 px-1 text-[0.8125rem] text-muted-foreground">
            {duplicates.size > 0 ? t.setup.duplicate : players.length === 1 ? t.setup.solo : t.setup.order}
          </p>

          {recent.length > 0 && players.length < MAX_PLAYERS && (
            <div className="mt-4">
              <p className="mb-2 px-1 text-[0.8125rem] font-medium text-muted-foreground">{t.setup.recent}</p>
              <div className="flex flex-wrap gap-2">
                {recent.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => addRecent(name)}
                    className="flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-4 text-[0.9375rem] active:bg-secondary"
                  >
                    <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <Group title={t.setup.rules}>
          {type === "x01" && (
            <>
              <ChoiceRow
                title={t.setup.startScore}
                options={START_SCORES.map((score) => ({ value: score, label: `${score}` }))}
                value={rules.startScore}
                onChange={(startScore) => change({ startScore })}
              />
              <SwitchRow title={t.setup.doubleIn} hint={t.setup.doubleInHint} checked={rules.doubleIn} onCheckedChange={(doubleIn) => change({ doubleIn })} />
              <SwitchRow title={t.setup.doubleOut} hint={t.setup.doubleOutHint} checked={rules.doubleOut} onCheckedChange={(doubleOut) => change({ doubleOut })} />
            </>
          )}
          {type === "cricket" && (
            <SwitchRow title={t.setup.cutThroat} hint={t.setup.cutThroatHint} checked={rules.cutThroat} onCheckedChange={(cutThroat) => change({ cutThroat })} />
          )}
          {type === "clock" && (
            <SwitchRow title={t.setup.bullFinish} hint={t.setup.bullFinishHint} checked={rules.bullFinish} onCheckedChange={(bullFinish) => change({ bullFinish })} />
          )}
          <ChoiceRow
            title={inSets ? t.setup.legsPerSet : t.setup.legsToWin}
            hint={inSets ? t.setup.legsSetHint(rules.legsToWin) : t.setup.legsHint(rules.legsToWin)}
            options={LEG_OPTIONS.map((legs) => ({ value: legs, label: `${legs}` }))}
            value={rules.legsToWin}
            onChange={(legsToWin) => change({ legsToWin })}
          />
          {multipleLegs && (
            <ChoiceRow
              title={t.setup.sets}
              hint={t.setup.setsHint(rules.setsToWin)}
              options={SET_OPTIONS.map((sets) => ({ value: sets, label: sets === 1 ? t.setup.noSets : `${sets}` }))}
              value={rules.setsToWin}
              onChange={(setsToWin) => change({ setsToWin })}
            />
          )}
          {multipleLegs && players.length > 1 && (
            <ChoiceRow
              title={t.setup.nextLeg}
              hint={rules.startRule === "alternate" ? t.setup.alternateHint : t.setup.loserHint}
              options={[
                { value: "alternate", label: t.setup.alternate },
                { value: "loser", label: t.setup.loser },
              ]}
              value={rules.startRule}
              onChange={(startRule) => change({ startRule })}
            />
          )}
        </Group>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/85 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur-xl">
        <div className="mx-auto max-w-2xl">
          <Button onClick={start} disabled={duplicates.size > 0} className="h-14 w-full rounded-2xl text-[1.0625rem] font-semibold">
            {t.setup.start}
          </Button>
        </div>
      </div>
    </div>
  )
}
