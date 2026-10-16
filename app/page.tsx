"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { AppShell } from "@/components/app-shell"
import { PlayScreen, type AgainInfo, type ResumeInfo } from "@/components/play-screen"
import { SetupScreen } from "@/components/setup-screen"
import { LeaderboardScreen } from "@/components/leaderboard-screen"
import { GameScreen } from "@/components/game/game-screen"
import { UndoBanner } from "@/components/undo-banner"
import { FallbackScreen } from "@/components/fallback-screen"
import { StorageAlert } from "@/components/data/storage-alert"
import { behind, offRight, onTop, pushTransition } from "@/components/nav/motion"
import { NavProvider } from "@/components/nav/nav-context"
import { StackView, type StackRoot } from "@/components/nav/stack-view"
import { TabsLayer } from "@/components/nav/tabs-layer"
import { replaceUrl, useHistorySync } from "@/components/nav/use-history-sync"
import { AppSettingsProvider } from "@/components/shell/app-settings"
import { warmOfflineScreens } from "@/components/shell/lazy"
import { ClubsRoot, ProfileRoot, TournamentsRoot } from "@/components/shell/tab-roots"
import "@/components/shell/extensions"
import { useT } from "@/components/i18n-provider"
import { modeName, type Messages } from "@/lib/i18n"
import { SITE } from "@/lib/site"
import { newMatchId } from "@/lib/leaderboard"
import { trackSave } from "@/lib/storage/save-status"
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
import { parseHash, type AppLink } from "@/lib/shell/links"
import { TABS, depthOf, initialNavState, makeEntry, navReducer, type TabId } from "@/lib/shell/nav"
import { canOpenLink, dispatchLink, getScreen, hasScreen, type ShellNavigator } from "@/lib/shell/registry"

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

// The first scrollable element of a tab's visible screen, for "tap the open tab to scroll up".
function scrollTabToTop(tab: TabId, smooth: boolean) {
  const panel = document.querySelector(`[data-tab-panel="${tab}"]`)
  const layers = panel ? Array.from(panel.children) : []
  const top = layers[layers.length - 1]
  const scroller = top
    ? [top, ...Array.from(top.querySelectorAll("*"))].find((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)
    : undefined
  scroller?.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" })
}

export default function DartScorer() {
  const t = useT()
  const [screen, setScreen] = useState<Screen>("tabs")
  // Tabs, and the screens pushed in each of them (lib/shell/nav.ts).
  const [nav, dispatchNav] = useReducer(navReducer, undefined, () => initialNavState())
  // Tabs are built the first time they are opened and then kept, so the start page does no more
  // work than before and every tab stays where it was left.
  const [opened, setOpened] = useState<readonly TabId[]>(["play"])
  if (!opened.includes(nav.tab)) setOpened([...opened, nav.tab])
  const [direction, setDirection] = useState(1)
  const [setupType, setSetupType] = useState<GameType>("x01")
  // Where setup and the game go back to: the tab they were opened from.
  const [returnTab, setReturnTab] = useState<TabId>("play")
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
  const navRef = useRef(nav)
  const matchRef = useRef(match)
  const reduceMotion = useReducedMotion() ?? false

  useLayoutEffect(() => {
    navRef.current = nav
    matchRef.current = match
  })

  // Leaving the tabs for setup or a game remembers the open tab (or `from`) to come back to.
  const go = useCallback((next: Screen, from?: TabId) => {
    if (screenRef.current === "tabs" && next !== "tabs") setReturnTab(from ?? navRef.current.tab)
    setDirection(DEPTH[next] >= DEPTH[screenRef.current] ? 1 : -1)
    screenRef.current = next
    setScreen(next)
  }, [])

  const openSetup = useCallback(
    (type: GameType, from?: TabId) => {
      setSetupType(type)
      go("setup", from)
    },
    [go],
  )

  // Switches tab without touching its stack (unlike tapping the open tab, which goes to its root).
  const showTab = useCallback((tab: TabId) => {
    if (navRef.current.tab !== tab) dispatchNav({ type: "select", tab })
  }, [])

  const backToTabs = useCallback(
    (tab: TabId) => {
      showTab(tab)
      go("tabs")
    },
    [go, showTab],
  )

  // What screens, actions and link handlers can do (lib/shell/registry.ts).
  const navigator = useMemo<ShellNavigator>(
    () => ({
      get tab() {
        return navRef.current.tab
      },
      selectTab: showTab,
      push: (screenId, params, options) => {
        if (hasScreen(screenId)) dispatchNav({ type: "push", entry: makeEntry(screenId, params), tab: options?.tab })
      },
      replaceTop: (screenId, params) => {
        if (hasScreen(screenId)) dispatchNav({ type: "replaceTop", entry: makeEntry(screenId, params) })
      },
      pop: () => dispatchNav({ type: "pop" }),
      popToRoot: (tab) => dispatchNav({ type: "popToRoot", tab }),
      openSetup: (type) => openSetup(type),
      resumeMatch: (next) => {
        setEnded(null)
        setMatch({ ...next, status: "playing" })
        go("game")
      },
    }),
    [go, openSetup, showTab],
  )

  // An app link (/#club=…) opens its screen in its tab. Setup is left; a running game is kept
  // as "paused", exactly as "save and leave" does, and waits on the Play tab.
  const openLink = useCallback(
    (link: AppLink) => {
      if (!canOpenLink(link)) return
      if (screenRef.current === "game") setMatch((m) => (m && m.status === "playing" ? { ...m, status: "paused" } : m))
      if (screenRef.current !== "tabs") go("tabs")
      dispatchLink(link, navigator, "address")
    },
    [go, navigator],
  )

  // Reads a link from the address and removes it from there right away: invitations and pairing
  // codes don't stay in the address bar or the browser history. Other fragments are left alone.
  const handleHash = useCallback(() => {
    const link = parseHash(window.location.hash)
    if (!link) return
    replaceUrl(window.location.pathname + window.location.search)
    openLink(link)
  }, [openLink])

  // Browser back: leaves setup like its back button, then pops screens. The game screen has no
  // history entries of its own, so the browser's back there behaves as it always has.
  const handleHistoryBack = useCallback(
    (count: number) => {
      if (screenRef.current === "game") return
      let rest = count
      if (screenRef.current === "setup") {
        backToTabs(returnTab)
        rest -= 1
      }
      if (rest > 0) dispatchNav({ type: "pop", count: rest })
    },
    [backToTabs, returnTab],
  )

  useHistorySync({
    depth: !hydrated || screen === "game" ? 0 : depthOf(nav) + (screen === "setup" ? 1 : 0),
    onBack: handleHistoryBack,
    onNewEntry: handleHash,
  })

  // Restore settings and any game in progress. A game that was open when the page
  // reloaded (or the phone dropped the tab) goes straight back to the board, unless the app was
  // opened with a link: then the game waits on the Play tab and the link opens.
  useEffect(() => {
    if (typeof CSS === "undefined" || !CSS.supports("container-type: size")) {
      setUnsupported(true)
      return
    }
    const saved = loadMatch()
    setSettings(loadSettings())
    setLastGame(loadLastGame())
    const link = parseHash(window.location.hash)
    const linkOpens = link !== null && canOpenLink(link)
    if (saved) {
      if (saved.status === "playing" && !linkOpens) {
        setMatch(saved)
        screenRef.current = "game"
        setScreen("game")
      } else {
        setMatch(saved.status === "playing" ? { ...saved, status: "paused" } : saved)
      }
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    handleHash()
    window.addEventListener("hashchange", handleHash)
    return () => window.removeEventListener("hashchange", handleHash)
  }, [hydrated, handleHash])

  // A write that fails is shown (StorageAlert), never passed off as saved. Leaving a game removes
  // it from storage; if even that fails, there is no game left to warn about.
  useEffect(() => {
    if (hydrated) void trackSave("game", () => saveMatch(match) || match === null)
  }, [hydrated, match])

  useEffect(() => {
    if (hydrated) saveSettings(settings)
  }, [hydrated, settings])

  // Clubs, Tournaments, Profile, Settings and About load on first use. Fetch them a few seconds
  // after the app settles on the tabs, when the browser is idle, so the service worker has them for
  // offline use like the old Settings tab and About page. Never during the first taps or a game: a
  // game started first cancels it, and it runs on the next visit to the tabs.
  const warmed = useRef(false)
  useEffect(() => {
    if (!hydrated || screen !== "tabs" || warmed.current || !window.navigator.onLine) return
    let idle: number | undefined
    const warm = () => {
      warmed.current = true
      void warmOfflineScreens().catch(() => (warmed.current = false))
    }
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(warm, { timeout: 4000 })
      else warm()
    }, 4000)
    return () => {
      clearTimeout(timer)
      if (idle !== undefined) window.cancelIdleCallback(idle)
    }
  }, [hydrated, screen])

  const appSettings = useMemo(() => ({ settings, onSettingsChange: setSettings }), [settings])

  // Every game started is remembered: its players and rules for setup, and the whole game for
  // the Play tab's "play again".
  const startGame = useCallback(
    (config: MatchConfig) => {
      setEnded(null)
      saveLastPlayers(config.players.map((p) => p.name))
      saveRules(config.type, rulesOf(config))
      saveLastGame(config)
      setLastGame(config)
      setMatch(newMatch(config))
      go("game")
    },
    [go],
  )

  // Tapping the open tab at its root scrolls it to the top (iOS); everything else is the reducer's.
  const onTabChange = useCallback(
    (tab: TabId) => {
      const current = navRef.current
      if (tab === current.tab && depthOf(current) === 0) scrollTabToTop(tab, !reduceMotion)
      else dispatchNav({ type: "select", tab })
    },
    [reduceMotion],
  )

  // Push and pop like a navigation stack (components/nav/motion.ts).
  const screenVariants = {
    enter: (dir: number) => (dir > 0 ? offRight : behind)(reduceMotion),
    center: onTop,
    exit: (dir: number) => (dir > 0 ? behind : offRight)(reduceMotion),
  }

  // The tabs, built from memoised parts: they stay mounted under setup and the game (TabsLayer),
  // and a throw, which re-renders this page, must not re-render any of them.
  const again = useMemo(() => againInfo(lastGame, t), [lastGame, t])
  const resume = useMemo(() => resumeInfo(match, t), [match, t])
  const roots = useMemo<Record<TabId, StackRoot>>(
    () => ({
      play: {
        title: t.shell.tabs.play,
        content: (
          <PlayScreen
            onSelect={(type) => openSetup(type)}
            again={again}
            onPlayAgain={() => lastGame && startGame(lastGame)}
            onChangeAgain={() => lastGame && openSetup(lastGame.type)}
            resume={resume}
            onResume={() => {
              setMatch((m) => (m ? { ...m, status: "playing" } : m))
              go("game")
            }}
            onDiscardResume={() => {
              setEnded(matchRef.current)
              setMatch(null)
            }}
          />
        ),
      },
      // As in 1.0.0, a game started from the empty leaderboard comes back to Play.
      leaderboard: { title: t.leaderboard.title, content: <LeaderboardScreen onPlay={() => openSetup("x01", "play")} /> },
      clubs: { title: t.shell.tabs.clubs, content: <ClubsRoot /> },
      tournaments: { title: t.shell.tabs.tournaments, content: <TournamentsRoot /> },
      profile: { title: t.shell.tabs.profile, content: <ProfileRoot /> },
    }),
    [t, again, resume, lastGame, openSetup, startGame, go],
  )
  const tabs = useMemo(
    () => (
      <AppShell tab={nav.tab} onTabChange={onTabChange}>
        {TABS.filter((id) => opened.includes(id)).map((id) => (
          <StackView key={id} tab={id} active={nav.tab === id} root={roots[id]} entries={nav.stacks[id]} onBack={navigator.pop} />
        ))}
      </AppShell>
    ),
    [nav, opened, roots, onTabChange, navigator],
  )

  // Setup's back button names the screen it goes back to: the tab, or "Back" above a pushed screen.
  const returnTop = nav.stacks[returnTab].at(-1)
  const returnLabel = returnTop && getScreen(returnTop.screen) ? t.common.back : roots[returnTab].title

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
  if (screen === "setup") {
    content = <SetupScreen type={setupType} backLabel={returnLabel} onBack={() => backToTabs(returnTab)} onStart={startGame} />
  } else if (screen === "game" && match) {
    content = (
      <GameScreen
        match={match}
        settings={settings}
        onSettingsChange={setSettings}
        onMatchChange={setMatch}
        onLeave={(how) => {
          if (how === "discard") setEnded({ ...match, status: "paused" })
          setMatch((m) => (how === "save" && m ? { ...m, status: "paused" } : null))
          backToTabs(returnTab)
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
          backToTabs(returnTab)
        }}
        onLeaderboard={() => {
          setMatch(null)
          backToTabs("leaderboard")
        }}
      />
    )
  }

  return (
    <NavProvider value={navigator}>
      <AppSettingsProvider value={appSettings}>
        <div className="fixed inset-0 overflow-hidden bg-background">
          {/* A soft blue glow, like the board light, in dark mode only; light mode stays flat iOS grey. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_bottom_left,rgba(29,78,216,0.15),transparent_50%)] dark:block" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden bg-[radial-gradient(circle_at_top_right,rgba(29,78,216,0.15),transparent_50%)] dark:block" />

          <TabsLayer covered={screen !== "tabs"}>{tabs}</TabsLayer>

          {/* Setup and the game slide in over the tabs. */}
          <AnimatePresence initial={false} custom={direction}>
            {content && (
              <motion.div
                key={screen === "game" && match ? `game-${match.id}` : screen}
                custom={direction}
                variants={screenVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={pushTransition(reduceMotion)}
                className={screen === "setup" ? "absolute inset-0 overflow-y-auto overscroll-contain" : "absolute inset-0 overflow-hidden"}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Undo brings the game back as it was; the Continue card picks it up from there. */}
          <UndoBanner
            message={t.undoBanner.ended}
            visible={ended !== null && screen === "tabs"}
            onUndo={() => {
              setMatch(ended)
              setEnded(null)
              showTab("play")
            }}
            onExpire={clearEnded}
          />

          <StorageAlert inGame={screen === "game"} />
        </div>
      </AppSettingsProvider>
    </NavProvider>
  )
}
