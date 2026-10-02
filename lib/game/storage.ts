"use client"

import { replay } from "./engine"
import { DEFAULT_RULES, LEG_OPTIONS, SET_OPTIONS, START_SCORES, type GameRules } from "./rules"
import type { GameType, MatchConfig, SavedMatch } from "./types"

const MATCH_KEY = "dart-scorer.current-match.v1"
const PLAYERS_KEY = "dart-scorer.last-players.v1"
const SETTINGS_KEY = "dart-scorer.settings.v1"
const RULES_KEY = "dart-scorer.rules.v1"
const LAST_GAME_KEY = "dart-scorer.last-game.v1"

export interface AppSettings {
  sound: boolean
  caller: boolean
  // Remembered per device: "dart" (keypad per dart) or "visit" (type the visit total).
  entryMode: "dart" | "visit"
  // Visit total mode: ask how many darts went at a double, for an exact checkout rate.
  askAtDouble: boolean
}

export const DEFAULT_SETTINGS: AppSettings = { sound: true, caller: false, entryMode: "dart", askAtDouble: false }

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked or full: the app keeps working, it just can't resume.
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const oneOf = <T>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback)
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback)

// Saved data can be from an older version or damaged. Anything that doesn't look right, or
// can't be replayed, is dropped quietly: the player just starts a new game.
function validConfig(config: unknown): config is MatchConfig {
  if (!isObject(config)) return false
  const players = config.players
  return (
    ["x01", "cricket", "clock"].includes(config.type as string) &&
    Array.isArray(players) &&
    players.length >= 1 &&
    players.length <= 6 &&
    players.every((p) => isObject(p) && typeof p.name === "string" && typeof p.id === "string") &&
    typeof config.legsToWin === "number" &&
    (config.setsToWin === undefined || typeof config.setsToWin === "number")
  )
}

function validMatch(value: unknown): value is SavedMatch {
  return isObject(value) && typeof value.id === "string" && Array.isArray(value.throws) && validConfig(value.config)
}

export function loadMatch(): SavedMatch | null {
  const value = read(MATCH_KEY)
  if (!validMatch(value)) {
    if (value !== null) saveMatch(null)
    return null
  }
  try {
    replay(value.config, value.throws)
  } catch {
    saveMatch(null)
    return null
  }
  return {
    ...value,
    acknowledgedLegs: typeof value.acknowledgedLegs === "number" ? value.acknowledgedLegs : 0,
    status: value.status === "paused" ? "paused" : "playing",
  }
}

export const saveMatch = (match: SavedMatch | null) => write(MATCH_KEY, match)

export function loadLastPlayers(): string[] {
  const value = read(PLAYERS_KEY)
  return Array.isArray(value) ? value.filter((n): n is string => typeof n === "string").slice(0, 6) : []
}
export const saveLastPlayers = (names: string[]) => write(PLAYERS_KEY, names)

export function loadSettings(): AppSettings {
  const value = read(SETTINGS_KEY)
  if (!isObject(value)) return DEFAULT_SETTINGS
  return {
    sound: typeof value.sound === "boolean" ? value.sound : DEFAULT_SETTINGS.sound,
    caller: typeof value.caller === "boolean" ? value.caller : DEFAULT_SETTINGS.caller,
    entryMode: value.entryMode === "visit" ? "visit" : "dart",
    askAtDouble: typeof value.askAtDouble === "boolean" ? value.askAtDouble : DEFAULT_SETTINGS.askAtDouble,
  }
}
export const saveSettings = (settings: AppSettings) => write(SETTINGS_KEY, settings)

// The rules last played, for each type of game, so setup starts where the group left off.
export function loadRules(type: GameType): GameRules {
  const all = read(RULES_KEY)
  const value = isObject(all) && isObject(all[type]) ? all[type] : {}
  return {
    startScore: oneOf(value.startScore, START_SCORES, DEFAULT_RULES.startScore),
    doubleIn: flag(value.doubleIn, DEFAULT_RULES.doubleIn),
    doubleOut: flag(value.doubleOut, DEFAULT_RULES.doubleOut),
    cutThroat: flag(value.cutThroat, DEFAULT_RULES.cutThroat),
    bullFinish: flag(value.bullFinish, DEFAULT_RULES.bullFinish),
    legsToWin: oneOf(value.legsToWin, LEG_OPTIONS, DEFAULT_RULES.legsToWin),
    setsToWin: oneOf(value.setsToWin, SET_OPTIONS, DEFAULT_RULES.setsToWin),
    startRule: oneOf(value.startRule, ["alternate", "loser"] as const, DEFAULT_RULES.startRule),
  }
}

export function saveRules(type: GameType, rules: GameRules) {
  const all = read(RULES_KEY)
  write(RULES_KEY, { ...(isObject(all) ? all : {}), [type]: rules })
}

// The last game started, for "play again" on the Play tab.
export function loadLastGame(): MatchConfig | null {
  const value = read(LAST_GAME_KEY)
  return validConfig(value) ? value : null
}

export const saveLastGame = (config: MatchConfig) => write(LAST_GAME_KEY, config)
