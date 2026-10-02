import type { ModeId } from "@/types/game-modes"
import type { GameType, MatchConfig, MatchPlayer } from "./types"

// The games on the Play tab, as families: X01 (301, 501 or 701 is picked in setup), Cricket
// (Cut Throat is one of its rules) and Around the Clock.
export const GAME_TYPES: GameType[] = ["x01", "cricket", "clock"]

export const START_SCORES = [301, 501, 701]
export const LEG_OPTIONS = [1, 2, 3, 5]
// 1 means no sets: the game is played in legs.
export const SET_OPTIONS = [1, 2, 3, 4]

// What a group plays by. Setup remembers it for each type of game; rules that don't apply to
// a type (Double Out in Cricket) are kept for it but not used.
export interface GameRules {
  startScore: number
  doubleIn: boolean
  doubleOut: boolean
  cutThroat: boolean
  bullFinish: boolean
  legsToWin: number
  setsToWin: number
  startRule: "alternate" | "loser"
}

export const DEFAULT_RULES: GameRules = {
  startScore: 501,
  doubleIn: false,
  doubleOut: true,
  cutThroat: false,
  bullFinish: false,
  legsToWin: 1,
  setsToWin: 1,
  startRule: "alternate",
}

const X01_MODES: Record<number, ModeId> = { 301: "301", 501: "501", 701: "701" }

// The mode these rules play; its name and rules text are in the language catalogs.
export function modeIdFor(type: GameType, rules: GameRules): ModeId {
  if (type === "x01") return X01_MODES[rules.startScore] ?? "501"
  if (type === "cricket") return rules.cutThroat ? "cutthroat" : "cricket"
  return "clock"
}

// Sets are made of legs: with one leg to a set there are no sets.
const usesSets = (rules: GameRules) => rules.legsToWin > 1 && rules.setsToWin > 1

export function configFor(type: GameType, rules: GameRules, players: MatchPlayer[], modeName: string): MatchConfig {
  return {
    modeId: modeIdFor(type, rules),
    modeName,
    type,
    startScore: type === "x01" ? rules.startScore : 0,
    doubleIn: type === "x01" && rules.doubleIn,
    doubleOut: rules.doubleOut,
    cutThroat: type === "cricket" && rules.cutThroat,
    bullFinish: type === "clock" && rules.bullFinish,
    legsToWin: rules.legsToWin,
    setsToWin: usesSets(rules) ? rules.setsToWin : 1,
    startRule: rules.startRule,
    players,
  }
}

// The rules a game was played with, to remember them for its type.
export function rulesOf(config: MatchConfig): GameRules {
  return {
    startScore: config.type === "x01" ? config.startScore : DEFAULT_RULES.startScore,
    doubleIn: config.doubleIn ?? false,
    doubleOut: config.doubleOut,
    cutThroat: config.cutThroat,
    bullFinish: config.bullFinish,
    legsToWin: config.legsToWin,
    setsToWin: config.setsToWin ?? 1,
    startRule: config.startRule ?? "alternate",
  }
}
