"use client"

import { Button } from "@/components/ui/button"
import { useSyncExternalStore } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowUpRight } from "lucide-react"
import { GameModeIcon } from "@/components/game-mode-icon"
import { HeroBoard } from "@/components/hero-board"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { SlotItems } from "@/components/shell/slot-items"
import { GAME_TYPES } from "@/lib/game/rules"
import type { GameType } from "@/lib/game/types"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"

export interface ResumeInfo {
  title: string
  detail: string
}

// The last game started, ready to play again: who played, and by which rules.
export interface AgainInfo {
  players: string
  rules: string
}

interface PlayScreenProps {
  onSelect: (type: GameType) => void
  resume: ResumeInfo | null
  onResume: () => void
  onDiscardResume: () => void
  again: AgainInfo | null
  onPlayAgain: () => void
  onChangeAgain: () => void
}

const WIDE_HOME = "(min-width: 1024px), (min-width: 700px) and (min-height: 700px)"
const subscribeWide = (callback: () => void) => {
  const query = window.matchMedia(WIDE_HOME)
  query.addEventListener("change", callback)
  return () => query.removeEventListener("change", callback)
}
const wideSnapshot = () => window.matchMedia(WIDE_HOME).matches
const serverSnapshot = () => false

// On larger screens the opening is a stage, with immediate actions and the actual practice
// board. Nothing waits for the motion; Reduce Motion removes the movement completely.
function WidePlayScreen({ onSelect, resume, onResume, onDiscardResume, again, onPlayAgain, onChangeAgain }: PlayScreenProps) {
  const t = useT()
  const reduced = useReducedMotion()
  const reveal = (delay = 0) => reduced ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] as const } }
  return (
    <div className="oche-home h-full overflow-y-auto overscroll-contain px-6 pb-8 pt-[max(env(safe-area-inset-top),1.5rem)] md:px-10 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <motion.header {...reveal()} className="mb-6">
          <p className="text-[0.8125rem] font-medium text-muted-foreground">{SITE.name} <span aria-hidden="true">/</span> {t.shell.tabs.play}</p>
          <h1 className="mt-4 font-display text-[clamp(2rem,3.5vw,3.1rem)] font-semibold leading-none tracking-tight">{t.play.welcome}</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">{t.play.welcomeDetail}</p>
        </motion.header>

        <motion.section {...reveal(0.04)} className="oche-stage relative grid min-h-[19rem] grid-cols-[minmax(0,1fr)_minmax(15rem,0.9fr)] items-center gap-4 overflow-hidden rounded-[1.75rem] border border-border p-7 tablet:p-9">
          <div className="relative z-10 flex min-w-0 flex-col items-start gap-4">
            <span className="rounded-full border border-foreground/15 bg-background/20 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em]">{t.play.moment}</span>
            <h2 className="max-w-md font-display text-[clamp(2.1rem,4.1vw,4rem)] font-semibold leading-[0.98] tracking-tight">{resume ? t.play.pausedHeadline : again ? t.play.headline : t.play.firstHeadline}</h2>
            {resume ? <p className="text-[0.9375rem] text-muted-foreground">{t.play.resumeTitle(resume.title)} · {resume.detail}</p> : again ? <p className="text-[0.9375rem] text-muted-foreground">{again.players} · {again.rules}</p> : <p className="text-[0.9375rem] text-muted-foreground">{t.play.firstDetail}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={resume ? onResume : again ? onPlayAgain : () => onSelect("x01")} className="min-h-12 rounded-xl px-5 text-[1rem] font-semibold">
                {resume ? t.common.continue : again ? t.play.again.start : t.play.startX01}<ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
              {resume ? <Button variant="ghost" onClick={onDiscardResume} className="min-h-11">{t.play.discard}</Button> : again ? <Button variant="ghost" onClick={onChangeAgain} className="min-h-11">{t.play.again.change}</Button> : null}
            </div>
          </div>
          <motion.div {...(reduced ? {} : { initial: { opacity: 0, scale: 0.94, y: 12 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const } })} className="relative flex min-w-0 items-center justify-center">
            <section aria-label={t.play.practiceBoard} className="w-full max-w-[20rem]"><HeroBoard /><p className="mt-2 text-center text-[0.75rem] text-muted-foreground">{t.play.practiceHint}</p></section>
          </motion.div>
        </motion.section>

        <SlotItems list="play.rows" props={() => ({})} className="contents" />
        <motion.section {...reveal(0.1)} aria-labelledby="wide-new-game" className="mt-7">
          <h2 id="wide-new-game" className="mb-3 text-[1.0625rem] font-semibold">{t.play.pickGame}</h2>
          <ul className="grid grid-cols-3 gap-3">
            {GAME_TYPES.map((type, index) => <motion.li key={type} {...reveal(0.12 + index * 0.05)}><button type="button" onClick={() => onSelect(type)} className={cn("oche-mode group flex min-h-36 w-full flex-col items-start justify-between rounded-2xl border p-4 text-left transition-[transform,border-color,background-color] duration-200 hover:-translate-y-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:transform-none", `oche-mode-${type}`)}>
              <span className="flex w-full items-start justify-between"><GameModeIcon type={type} className="h-12 w-12 transition-transform duration-300 group-hover:scale-110 motion-reduce:transform-none" /><ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none" aria-hidden="true" /></span>
              <span className="mt-3 min-w-0"><span className="block font-display text-[1.25rem] font-semibold leading-tight">{t.families[type].name}</span><span className="mt-1 block text-[0.8125rem] text-muted-foreground">{t.families[type].short}</span></span>
            </button></motion.li>)}
          </ul>
        </motion.section>
      </div>
    </div>
  )
}

// A game that was left open: carry on, or let it go.
function ResumeCard({ resume, onResume, onDiscard }: { resume: ResumeInfo; onResume: () => void; onDiscard: () => void }) {
  const t = useT()
  return (
    <section aria-labelledby="resume-title" className="rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="resume-title" className="text-[0.8125rem] font-medium text-primary">
            {t.play.resumeTitle(resume.title)}
          </h2>
          <FitText className="text-[0.9375rem] text-muted-foreground">{resume.detail}</FitText>
        </div>
        <Button variant="ghost" onClick={onDiscard} className="h-11 shrink-0 rounded-xl px-3 text-[0.9375rem] text-muted-foreground">
          {t.play.discard}
        </Button>
      </div>
      <Button onClick={onResume} className="mt-2 h-12 w-full rounded-xl text-[1.0625rem] font-semibold">
        {t.common.continue}
      </Button>
    </section>
  )
}

// The usual game in one tap: same players, same rules as last time.
function AgainCard({ again, onPlay, onChange }: { again: AgainInfo; onPlay: () => void; onChange: () => void }) {
  const t = useT()
  return (
    <section aria-labelledby="again-title" className="rounded-2xl border border-border bg-card/70 px-4 py-3 xshort:py-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="again-title" className="text-[0.8125rem] font-medium text-primary xshort:sr-only">
            {t.play.again.title}
          </h2>
          <FitText minScale={0.8} className="text-[1.0625rem] font-semibold leading-snug">
            {again.players}
          </FitText>
          <FitText minScale={0.8} className="text-[0.9375rem] leading-snug text-muted-foreground">
            {again.rules}
          </FitText>
        </div>
        <Button variant="ghost" onClick={onChange} className="-mr-2 h-11 shrink-0 rounded-xl px-3 text-[0.9375rem] text-primary">
          {t.play.again.change}
        </Button>
      </div>
      <Button onClick={onPlay} className="mt-2 h-12 w-full rounded-xl text-[1.0625rem] font-semibold shadow-glow-lg xshort:h-11">
        {t.play.again.start}
      </Button>
    </section>
  )
}

// The Play tab is one fixed screen: the practice board takes whatever height is left over, so
// nothing scrolls on any phone or tablet. Below it, the last game to play again and the three
// kinds of game; variants (301 or 701, Cut Throat) are rules in setup.
export function PlayScreen({ onSelect, resume, onResume, onDiscardResume, again, onPlayAgain, onChangeAgain }: PlayScreenProps) {
  const t = useT()
  const wide = useSyncExternalStore(subscribeWide, wideSnapshot, serverSnapshot)

  if (wide) return <WidePlayScreen onSelect={onSelect} resume={resume} onResume={onResume} onDiscardResume={onDiscardResume} again={again} onPlayAgain={onPlayAgain} onChangeAgain={onChangeAgain} />

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 pb-3 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pt-[env(safe-area-inset-top)] md:px-8">
      <header className="flex h-12 shrink-0 items-center lg:hidden xshort:h-9">
        <h1 className="font-display text-2xl font-semibold tracking-tight xshort:text-xl">{SITE.name}</h1>
      </header>

      <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-3 pt-2 split:grid-cols-2 split:grid-rows-1 split:items-center split:gap-8 lg:pt-8">
        {/* The board scales to the space left: whichever is smaller, width or height. */}
        <section aria-label={t.play.practiceBoard} className="flex h-full min-h-0 items-center justify-center self-stretch @container-size">
          <div style={{ width: "min(100cqw, calc(100cqh - 4.25rem), 34rem)" }}>
            <HeroBoard className="w-full" />
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 split:justify-center">
          {resume ? (
            <ResumeCard resume={resume} onResume={onResume} onDiscard={onDiscardResume} />
          ) : (
            again && <AgainCard again={again} onPlay={onPlayAgain} onChange={onChangeAgain} />
          )}

          {/* Games that go on elsewhere and concern this device (lib/shell/registry.ts "play.rows"). */}
          <SlotItems list="play.rows" props={() => ({})} className="contents" />

          <section aria-labelledby="new-game">
            <h2 id="new-game" className="sr-only">
              {t.play.newGame}
            </h2>
            <ul className="grid grid-cols-3 gap-2 tablet:gap-3">
              {GAME_TYPES.map((type) => (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => onSelect(type)}
                    className="flex h-full min-h-[clamp(5.25rem,12dvh,7.5rem)] w-full flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card/70 px-1.5 py-2 text-center transition-colors hover:bg-secondary/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary/70 xshort:min-h-14 xshort:gap-0.5 xshort:py-1 tablet:min-h-36 tablet:gap-2"
                  >
                    <GameModeIcon type={type} className="h-9 w-9 shrink-0 text-primary xshort:h-7 xshort:w-7" />
                    <span className="w-full min-w-0">
                      <FitText minScale={0.8} className="text-[0.9375rem] font-semibold leading-tight tablet:text-[1.1875rem]">
                        {t.families[type].name}
                      </FitText>
                      <span className="xshort:hidden">
                        <FitText minScale={0.8} className="text-[0.8125rem] leading-tight text-muted-foreground tablet:text-[0.9375rem]">
                          {t.families[type].short}
                        </FitText>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
