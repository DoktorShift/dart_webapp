import { after, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { FakeNetwork } from "./support/fake-relay.ts"
import { generateSecretKey, getPublicKey } from "nostr-core"
import { awardsStand, mayAward, seasonOccasion } from "../components/clubs/awards.ts"
import { validAwards } from "../lib/badges/awards.ts"
import { registerIssuerCheck } from "../lib/badges/issuers.ts"
import { issueAwards } from "../lib/badges/organizer.ts"
import type { Throw } from "../lib/game/types.ts"
import { correctGame, gameSeats, recordGame, type FinishedGame } from "../lib/clubs/games.ts"
import { foundClub } from "../lib/clubs/membership.ts"
import { createSeason, DEFAULT_RULES, endSeason } from "../lib/clubs/seasons.ts"
import { loadStoredClub } from "../lib/clubs/store.ts"
import { viewClub } from "../lib/clubs/sync.ts"
import { relayClient } from "../lib/nostr/client.ts"
import { adjustClock, nowSeconds } from "../lib/nostr/time.ts"
import { getSigner, importLocalKey, signOut } from "../lib/profile/session.ts"

// A club season's badges (components/clubs/awards.ts with lib/badges/organizer.ts): ending the
// season gives the winner and the regulars their badges once, however often it is processed, and
// a game of the season corrected after its end voids them for every reader.

const URLS = ["wss://one.example", "wss://two.example"]
process.env.NEXT_PUBLIC_BLUELINE_RELAYS = URLS.join(",")
const network = new FakeNetwork()
const relays = URLS.map((url) => network.add(url))
Object.assign(globalThis, { WebSocket: network.WebSocket })

const ownerKey = generateSecretKey()
const owner = getPublicKey(ownerKey)
const [ben, carla] = Array.from({ length: 2 }, () => getPublicKey(generateSecretKey()))
const texts = (badge: string, season: string) => ({ name: badge, description: `${badge} in ${season}` })

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
  for (const relay of relays) relay.events = []
})

after(() => relayClient().close())

const config = (names: string[]) => ({
  modeId: "501",
  modeName: "501",
  type: "x01" as const,
  startScore: 501,
  doubleOut: true,
  doubleIn: false,
  cutThroat: false,
  bullFinish: false,
  legsToWin: 1,
  setsToWin: 1,
  startRule: "alternate" as const,
  players: names.map((name, i) => ({ id: `s${i}`, name })),
})
// The badges are on the first relay (the club's own records wait in the outbox, which nothing
// resumed here).
async function sentToRelays(awards: number) {
  const until = Date.now() + 3000
  while (relays[0].events.filter((e) => e.kind === 8).length < awards && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10))
}

const win: Throw[] = [180, 60, 180, 60, 141].map((total, i, all) => ({ kind: "visit", total, darts: 3, ...(i === all.length - 1 ? { atDouble: 1 } : {}) }))

test("ending a season gives the winner and the regulars their badges once; a game corrected afterwards voids them", async () => {
  await importLocalKey(ownerKey)
  const author = { pubkey: owner, signer: await getSigner() }
  // The season is played and ended an hour ago (the device's clock says so); the correction
  // comes now.
  adjustClock(Date.now() - 3600_000)
  const club = await foundClub({ name: "Liga", visibility: "public" }, author)
  const read = async () => viewClub((await loadStoredClub(club))!, author)
  await createSeason((await read()).state!, { name: "Herbst 2026", starts: nowSeconds() - 60, rules: { ...DEFAULT_RULES, confirmations: "none" } }, author)
  // Olaf beats Ben and Carla: Olaf wins the season, all three played.
  for (const [i, rival] of [ben, carla].entries()) {
    const seats = [{ name: "Olaf", pubkey: owner }, { name: `Rivale ${i}`, pubkey: rival }]
    const game: FinishedGame = { id: `local-${i}`, config: config(seats.map((s) => s.name)), seats, winner: 0, throws: win }
    await recordGame((await read()).state!, game, gameSeats(seats, "public", (n) => `Gast ${n}`), author)
  }
  let view = await read()
  const season = Object.values(view.state!.seasons)[0]
  const [record] = (await endSeason(view.state!, season, author)).events
  view = await read()
  assert.deepEqual(view.state!.seasons[season.id].ended, { event: record.id, by: owner, at: record.created_at })

  const occasion = seasonOccasion(view.state!, season, view.state!.seasons[season.id].ended!, view.games)
  assert.deepEqual(occasion.places.find((p) => p.place === 1), { pubkey: owner, place: 1, games: 2 })
  assert.deepEqual(await issueAwards(owner, occasion, texts), { given: 4, known: 0 })
  await sentToRelays(4)
  // Ended again on another of Olaf's devices, or after a reload: nothing new.
  assert.deepEqual(await issueAwards(owner, occasion, texts), { given: 0, known: 4 })

  // The club's answers to the badges area: Olaf owns the club, Ben doesn't run it; the awards stand.
  assert.equal(await mayAward(club, owner, nowSeconds()), true)
  assert.equal(await mayAward(club, ben, nowSeconds()), false)
  assert.equal(await awardsStand(club, record.id), true)
  assert.equal(await awardsStand(club, "f".repeat(64)), undefined, "not a season's end here")
  const stop = registerIssuerCheck("club", { mayIssue: mayAward, evidenceValid: awardsStand })
  try {
    const [bens] = await validAwards(relays[0].events, ben)
    assert.equal(bens.blueline?.badge, "season-regular")
    assert.equal(bens.voided, false)

    // Now Olaf corrects his game against Ben: the season's table is no longer what the badges
    // rest on.
    adjustClock(Date.now())
    await correctGame(view.state!, view.games.find((g) => g.agreement.seats[1].pubkey === ben)!, { winner: 1, legs: [0, 1] }, "Falsch eingetragen", author)
    assert.equal(await awardsStand(club, record.id), false)
    assert.ok((await validAwards(relays[0].events, ben)).every((a) => a.voided))
  } finally {
    stop()
    adjustClock(Date.now())
  }
})
