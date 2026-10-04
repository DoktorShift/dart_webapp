import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { ANNA, at, localStore, resetStorage } from "./storage-helpers.ts"
import { matchA, matchB, matchD, matchE, recordC } from "./storage-fixtures.ts"
import { config, dart, play } from "./helpers.ts"
// What version 1.0.0 does with the same localStorage (frozen copies, see tests/fixtures/v1).
import * as v1Game from "./fixtures/v1/game-storage.ts"
import * as v1Board from "./fixtures/v1/leaderboard.ts"
// This version.
import { replay } from "../lib/game/engine.ts"
import { rulesOf } from "../lib/game/rules.ts"
import { DEFAULT_SETTINGS, saveLastGame, saveLastPlayers, saveMatch, saveRules, saveSettings } from "../lib/game/storage.ts"
import { archiveFinished, importV1Matches, loadArchive } from "../lib/storage/archive.ts"
import { newObjectId } from "../lib/storage/ids.ts"
import { assignPlayers, newPlayerRecord } from "../lib/storage/players.ts"
import { getSaveState, retrySaves, dismissSaveAlert, trackSave } from "../lib/storage/save-status.ts"
import { V1_KEYS } from "../lib/storage/v1.ts"

beforeEach(resetStorage)

// A game started by this version's setup: stable ids, one empty seat, a new 128-bit match id.
function newVersionGame() {
  const { players } = assignPlayers(["Anna", "Spieler 2"], [newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA)])
  const c = config({ players })
  return { id: newObjectId(), config: c, throws: play(c, [dart(20, 3), dart(19), dart(5)]), startedAt: "2026-10-04T08:00:00.000Z", acknowledgedLegs: 0, status: "playing" as const }
}

test("1.0.0 resumes a running game saved by this version, unchanged", () => {
  const game = newVersionGame()
  assert.equal(saveMatch(game), true)
  assert.deepEqual(v1Game.loadMatch(), game)
  // And it doesn't delete it while checking.
  assert.ok(localStore.getItem(V1_KEYS.currentMatch))
})

test("1.0.0 reopens a finished game saved by this version on its result screen", () => {
  const game = { ...matchA(), id: newObjectId() }
  assert.equal(saveMatch(game), true)
  const reopened = v1Game.loadMatch()
  assert.deepEqual(reopened, game)
  assert.equal(replay(reopened!.config, reopened!.throws).winner, 0)
})

test("1.0.0 reads settings, last players, rules and 'play again' saved by this version", () => {
  const settings = { sound: false, caller: true, entryMode: "visit" as const, askAtDouble: true }
  saveSettings(settings)
  assert.deepEqual(v1Game.loadSettings(), settings)
  saveSettings(DEFAULT_SETTINGS)
  assert.deepEqual(v1Game.loadSettings(), DEFAULT_SETTINGS)
  const game = newVersionGame()
  saveLastGame(game.config)
  assert.deepEqual(v1Game.loadLastGame(), game.config)
  saveLastPlayers(game.config.players.map((p) => p.name))
  assert.deepEqual(v1Game.loadLastPlayers(), ["Anna", "Spieler 2"])
  saveRules("x01", rulesOf(game.config))
  assert.deepEqual(v1Game.loadRules("x01"), rulesOf(game.config))
})

test("1.0.0 keeps every result this version wrote, even when it rewrites its history", async () => {
  let minute = 0
  for (const match of [matchA(), matchB(), matchD(), matchE()]) await archiveFinished(match, undefined, at(`2026-10-01T20:0${minute++}:00.000Z`))
  const written = JSON.parse(localStore.getItem(V1_KEYS.matches)!)
  assert.equal(written.length, 3)

  // 1.0.0 finishing a game reads and filters the list (readMatches, private there) and writes it
  // back whole: nothing may be lost.
  v1Board.recordMatch(recordC())
  const after = JSON.parse(localStore.getItem(V1_KEYS.matches)!)
  assert.deepEqual(after, [recordC(), ...written])
  v1Board.removeMatch("not-there")
  assert.deepEqual(JSON.parse(localStore.getItem(V1_KEYS.matches)!), after)

  // Its Rangliste counts this version's games like its own.
  const standings = v1Board.computeStandings(after)
  const anna = standings.find((s) => s.name === "Anna")!
  assert.equal(anna.matches, 4)
  assert.equal(anna.wins, 3)
  // (301 + 201 + 501) / (6 + 9 + 18) × 3, rounded as 1.0.0 does.
  assert.equal(anna.average, 91.2)
})

test("results 1.0.0 adds after a rollback come back into the archive", async () => {
  await archiveFinished(matchA())
  v1Board.recordMatch(recordC())
  assert.equal(await importV1Matches(), 1)
  assert.deepEqual((await loadArchive()).map((m) => [m.id, m.source]).sort(), [
    ["match-a", "local"],
    [recordC().id, "imported-v1"],
  ].sort())
})

test("a running game that can't be saved is reported; the last saved state stays as it was", () => {
  const game = newVersionGame()
  assert.equal(saveMatch(game), true)
  localStore.failWrites = true
  assert.equal(saveMatch({ ...game, throws: [] }), false)
  assert.deepEqual(JSON.parse(localStore.getItem(V1_KEYS.currentMatch)!), game)
})

test("the save alert: shown on failure, gone after a success, retry and dismiss", async () => {
  let works = false
  await trackSave("game", () => works)
  assert.equal(getSaveState().failing, true)

  dismissSaveAlert()
  assert.equal(getSaveState().dismissed, true)
  // Still failing: stays hidden.
  await trackSave("game", () => works)
  assert.equal(getSaveState().dismissed, true)

  works = true
  assert.equal(await retrySaves(), true)
  assert.deepEqual(getSaveState(), { failing: false, dismissed: false, recovered: 1 })

  // A new failure after a success shows again.
  works = false
  await trackSave("game", () => works)
  assert.deepEqual(getSaveState(), { failing: true, dismissed: false, recovered: 1 })
  assert.equal(await retrySaves(), false)
  assert.equal(getSaveState().recovered, 1)
})

test("the save alert: a slow old write finishing late doesn't overrule a newer one", async () => {
  let finishOld: (ok: boolean) => void = () => {}
  const old = trackSave("archive", () => new Promise<boolean>((resolve) => (finishOld = resolve)))
  await trackSave("archive", async () => true)
  finishOld(false)
  await old
  assert.equal(getSaveState().failing, false)
  await trackSave("archive", () => Promise.reject(new Error("disk")))
  assert.equal(getSaveState().failing, true)
  await trackSave("archive", () => {
    throw new Error("disk")
  })
  assert.equal(getSaveState().failing, true)
})
