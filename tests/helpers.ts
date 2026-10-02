import { replay, tagThrow } from "../lib/game/engine.ts"
import type { MatchConfig, Multiplier, Throw } from "../lib/game/types.ts"

export const config = (overrides: Partial<MatchConfig> = {}): MatchConfig => ({
  modeId: "501",
  modeName: "501",
  type: "x01",
  startScore: 501,
  doubleOut: true,
  cutThroat: false,
  bullFinish: false,
  legsToWin: 1,
  players: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
  ...overrides,
})

export const dart = (segment: number, multiplier: Multiplier = 1): Throw => ({ kind: "dart", dart: { segment, multiplier } })
export const miss3 = (): Throw[] => [dart(0), dart(0), dart(0)]

// Enters throws the way the app does: each one tagged with the visit and leg it belongs to.
export const play = (c: MatchConfig, throws: Throw[]) => throws.reduce<Throw[]>((log, t) => [...log, tagThrow(replay(c, log), t)], [])
