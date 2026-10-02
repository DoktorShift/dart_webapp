"use client"

import { Button } from "@/components/ui/button"
import { Dartboard, GAME_HIGHLIGHTS } from "@/components/dartboard"
import { HeroBoard } from "@/components/hero-board"
import { FitText } from "@/components/fit-text"
import { useT } from "@/components/i18n-provider"
import { GAME_TYPES } from "@/lib/game/rules"
import type { GameType } from "@/lib/game/types"
import { SITE } from "@/lib/site"

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

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 pb-3 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pt-[env(safe-area-inset-top)] md:px-8">
      <header className="flex h-12 shrink-0 items-center lg:hidden xshort:h-9">
        <h1 className="font-display text-2xl font-semibold tracking-tight xshort:text-xl">{SITE.name}</h1>
      </header>

      <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-3 pt-2 split:grid-cols-2 split:grid-rows-1 split:items-center split:gap-8 lg:pt-8">
        {/* The board scales to the space left: whichever is smaller, width or height. */}
        <section aria-label={t.play.practiceBoard} className="flex h-full min-h-0 items-center justify-center self-stretch [container-type:size]">
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
                    className="flex h-full min-h-[clamp(5.25rem,12dvh,7.5rem)] w-full flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card/70 px-1.5 py-2 text-center transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-secondary/70 xshort:min-h-14 xshort:flex-row xshort:gap-2 xshort:py-1 tablet:min-h-28 tablet:gap-2"
                  >
                    <Dartboard variant="mini" highlight={GAME_HIGHLIGHTS[type]} className="h-8 w-8 shrink-0 tablet:h-11 tablet:w-11" />
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
