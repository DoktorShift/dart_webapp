"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { AppShell, type Tab } from "@/components/app-shell"
import { PlayScreen, type AgainInfo, type ResumeInfo } from "@/components/play-screen"
import { SetupScreen } from "@/components/setup-screen"
import { LeaderboardScreen } from "@/components/leaderboard-screen"
import { SettingsScreen } from "@/components/settings-screen"
import { GameScreen } from "@/components/game/game-screen"
import { UndoBanner } from "@/components/undo-banner"
import { FallbackScreen } from "@/components/fallback-screen"
import { useT } from "@/components/i18n-provider"
import { modeName, type Messages } from "@/lib/i18n"
import { SITE } from "@/lib/site"
import { newMatchId } from "@/lib/leaderboard"
import { replay } from "@/lib/game/engine"
import { rulesOf } from "@/lib/game/rules"
import { legName, rulesSummary } from "@/lib/game/words"
import {
  DEFAULT_SETTINGS,
  loadLastGame,
  loadMatch,
  loadSettings,
  saveLastGame,
  saveLastPlayers,
  saveMatch,
  saveRules,
  saveSettings,
  type AppSettings,
} from "@/lib/game/storage"
import type { GameType, MatchConfig, SavedMatch } from "@/lib/game/types"

// "tabs" is the app with its tab bar or sidebar; setup and game are full-screen flows on top.
type Screen = "tabs" | "setup" | "game"
const DEPTH: Record<Screen, number> = { tabs: 0, setup: 1, game: 2 }

const newMatch = (config: MatchConfig): SavedMatch => ({
  id: newMatchId(),
  config,
  throws: [],
  startedAt: new Date().toISOString(),
  acknowledgedLegs: 0,
  status: "playing",
})

function resumeInfo(match: SavedMatch | null, t: Messages): ResumeInfo | null {
  if (!match || match.status !== "paused") return null
  const state = replay(match.config, match.throws)
  if (state.winner !== null) return null
  const c = match.config
  const detail =
    c.type === "x01"
      ? c.players.map((p, i) => `${p.name} ${state.scores[i]}`).join(", ")
      : c.type === "cricket"
        ? c.players.map((p, i) => `${p.name} ${state.points[i]}`).join(", ")
        : c.players.map((p, i) => t.play.resumeOn(p.name, `${state.clockTargets[state.progress[i]] ?? t.common.bull}`)).join(", ")
  const name = modeName(t, c.modeId, c.modeName)
  return { title: c.legsToWin > 1 ? t.play.resumeLeg(name, legName(t, state)) : name, detail }
}

const againInfo = (config: MatchConfig | null, t: Messages): AgainInfo | null =>
  config && { players: config.players.map((p) => p.name).join(", "), rules: rulesSummary(t, config) }

export default function DartScorer() {
  const t = useT()
  const [screen, setScreen] = useState<Screen>("tabs")
  const [tab, setTab] = useState<Tab>("play")
  const [direction, setDirection] = useState(1)
  const [setupType, setSetupType] = useState<GameType>("x01")
  const [match, setMatch] = useState<SavedMatch | null>(null)
  // The last game started, offered on the Play tab to play again in one tap.
  const [lastGame, setLastGame] = useState<MatchConfig | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  // A game that was just ended without saving, kept for a few seconds so it can be undone.
  const [ended, setEnded] = useState<SavedMatch | null>(null)
  const clearEnded = useCallback(() => setEnded(null), [])
  // The fixed game screen sizes itself with CSS container queries (iOS 16+, current browsers).
  // Older browsers get a clear message instead of a broken layout.
  const [unsupported, setUnsupported] = useState(false)
  // Saved data is written back only once it has been read. Kept as state, not a ref, so the
  // first write happens on the render that already has the restored game: a game is never
  // removed from storage, not even for a moment, while the app starts.
  const [hydrated, setHydrated] = useState(false)
  const screenRef = useRef<Screen>("tabs")
  const reduceMotion = useReducedMotion()

  const go = useCallback((next: Screen) => {
    setDirection(DEPTH[next] >= DEPTH[screenRef.current] ? 1 : -1)
    screenRef.current = next
    setScreen(next)
  }, [])

  // Restore settings and any game in progress. A game that was open when the page
  // reloaded (or the phone dropped the tab) goes straight back to the board.
  useEffect(() => {
    if (typeof CSS === "undefined" || !CSS.supports("container-type: size")) {
      setUnsupported(true)
      return
    }
    const saved = loadMatch()
    setSettings(loadSettings())
    setLastGame(loadLastGame())
    if (saved) {
      setMatch(saved)
      if (saved.status === "playing") {
        screenRef.current = "game"
        setScreen("game")
      }
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) saveMatch(match)
  }, [hydrated, match])

  useEffect(() => {
    if (hydrated) saveSettings(settings)
  }, [hydrated, settings])

  // Every game started is remembered: its players and rules for setup, and the whole game for
  // the Play tab's "play again".
  const startGame = (config: MatchConfig) => {
    setEnded(null)
    saveLastPlayers(config.players.map((p) => p.name))
    saveRules(config.type, rulesOf(config))
    saveLastGame(config)
    setLastGame(config)
    setMatch(newMatch(config))
    go("game")
  }

  const openSetup = (type: GameType) => {
    setSetupType(type)
    go("setup")
  }

  const backToTabs = (next: Tab) => {
    setTab(next)
    go("tabs")
  }

  // Push and pop like a navigation stack; Reduce Motion gets a cross-fade.
  const screenVariants = {
    enter: (dir: number) => (reduceMotion ? { opacity: 0 } : { x: dir > 0 ? "100%" : "-25%", opacity: dir > 0 ? 1 : 0.6 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => (reduceMotion ? { opacity: 0 } : { x: dir > 0 ? "-25%" : "100%", opacity: dir > 0 ? 0.6 : 1 }),
  }

  if (unsupported) {
    return (
      <FallbackScreen
        title={t.fallback.unsupportedTitle}
        message={t.fallback.unsupportedMessage(SITE.name)}
        actions={[]}
      />
    )
  }

  let content: ReactNode = null
  if (screen === "tabs") {
    content = (
      <AppShell tab={tab} onTabChange={setTab}>
        {tab === "play" && (
          <PlayScreen
            onSelect={openSetup}
            again={againInfo(lastGame, t)}
            onPlayAgain={() => lastGame && startGame(lastGame)}
            onChangeAgain={() => lastGame && openSetup(lastGame.type)}
            resume={resumeInfo(match, t)}
            onResume={() => {
              setMatch((m) => (m ? { ...m, status: "playing" } : m))
              go("game")
            }}
            onDiscardResume={() => {
              setEnded(match)
              setMatch(null)
            }}
          />
        )}
        {tab === "leaderboard" && <LeaderboardScreen onPlay={() => openSetup("x01")} />}
        {tab === "settings" && <SettingsScreen settings={settings} onSettingsChange={setSettings} />}
      </AppShell>
    )
  } else if (screen === "setup") {
    content = <SetupScreen type={setupType} onBack={() => backToTabs("play")} onStart={startGame} />
  } else if (match) {
    content = (
      <GameScreen
        match={match}
        settings={settings}
        onSettingsChange={setSettings}
        onMatchChange={setMatch}
        onLeave={(how) => {
          if (how === "discard") setEnded({ ...match, status: "paused" })
          setMatch((m) => (how === "save" && m ? { ...m, status: "paused" } : null))
          backToTabs("play")
        }}
        onRematch={() => {
          // Same rules and players; the order rotates so someone else throws first.
          const [first, ...rest] = match.config.players
          startGame({ ...match.config, players: [...rest, first] })
        }}
        onNewGame={() => {
          setMatch(null)
          openSetup(match.config.type)
        }}
        onHome={() => {
          setMatch(null)
          backToTabs("play")
        }}
        onLeaderboard={() => {
          setMatch(null)
          backToTabs("leaderboard")
        }}
      />
    )
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      {/* A soft blue glow, like the board light, in dark mode only; light mode stays flat iOS grey. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_bottom_left,rgba(29,78,216,0.15),transparent_50%)] dark:block" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_top_right,rgba(29,78,216,0.15),transparent_50%)] dark:block" />

      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={screen === "game" && match ? `game-${match.id}` : screen}
          custom={direction}
          variants={screenVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: "tween", duration: reduceMotion ? 0.15 : 0.32, ease: [0.32, 0.72, 0, 1] }}
          className={screen === "setup" ? "absolute inset-0 overflow-y-auto overscroll-contain" : "absolute inset-0 overflow-hidden"}
        >
          {content}
        </motion.div>
      </AnimatePresence>

      {/* Undo brings the game back as it was; the Continue card picks it up from there. */}
      <UndoBanner
        message={t.undoBanner.ended}
        visible={ended !== null && screen === "tabs"}
        onUndo={() => {
          setMatch(ended)
          setEnded(null)
          setTab("play")
        }}
        onExpire={clearEnded}
      />
    </div>
  )
}
