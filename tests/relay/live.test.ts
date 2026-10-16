// Live games end to end over a real relay (nak serve on 127.0.0.1): the board founds a private
// match and sends snapshots, a spectator replays them, players join from their phones and give
// their verdicts, a correction voids them, and the board hands the match to another device.
// Run: npm run test:relay
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { Worker } from "node:worker_threads"
import { bytesToHex } from "@noble/hashes/utils"
import "../storage-helpers.ts"
import { freePort, startRelay, type NakRelay } from "../support/nak.ts"
import { config, dart } from "../helpers.ts"
import { applyThrow, correctDart, newMatchState, replay, tagThrow, visitBySeq, type MatchState } from "../../lib/game/engine.ts"
import type { SavedMatch, Throw } from "../../lib/game/types.ts"

let relay: NakRelay
let live: typeof import("../../lib/live/board.ts")
let seating: typeof import("../../lib/live/seating.ts")
let join: typeof import("../../lib/live/join.ts")
let handoff: typeof import("../../lib/live/handoff.ts")
let follow: typeof import("../../lib/live/follow.ts")
let content: typeof import("../../lib/live/content.ts")
let store: typeof import("../../lib/live/store.ts")
let nostr: typeof import("../../lib/nostr/client.ts")
let signers: typeof import("../../lib/nostr/signers.ts")
let links: typeof import("../../lib/protocol/links.ts")

before(async () => {
  relay = await startRelay()
  // Read whenever the live code picks its relays: never a public relay in these tests.
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  ;[live, seating, join, handoff, follow, content, store, nostr, signers, links] = await Promise.all([
    import("../../lib/live/board.ts"),
    import("../../lib/live/seating.ts"),
    import("../../lib/live/join.ts"),
    import("../../lib/live/handoff.ts"),
    import("../../lib/live/follow.ts"),
    import("../../lib/live/content.ts"),
    import("../../lib/live/store.ts"),
    import("../../lib/nostr/client.ts"),
    import("../../lib/nostr/signers.ts"),
    import("../../lib/protocol/links.ts"),
  ])
})

// What a test opened (followers, board codes, boards, a worker), closed after the tests even
// when one fails, so nothing keeps the process running.
const opened: (() => unknown)[] = []
const keep = <T extends { close: () => unknown }>(handle: T) => {
  opened.push(() => handle.close())
  return handle
}

after(async () => {
  for (const close of opened) await close()
  nostr.relayClient().close()
  await relay?.stop()
})

// Waits until `check` returns something, polling; fails with `what` after `ms`.
async function until<T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// Mia scores 180, 180 and checks out 141; Jonas misses. Tagged the way the app enters throws.
function playOut(c: SavedMatch["config"], next: (s: MatchState) => Throw): Throw[] {
  const s = newMatchState(c)
  const throws: Throw[] = []
  while (s.winner === null) {
    const tagged = tagThrow(s, next(s))
    applyThrow(s, tagged)
    throws.push(tagged)
  }
  return throws
}
const miaWins = (s: MatchState): Throw =>
  s.current === 1 ? { kind: "noScore" } : s.scores[0] > 141 ? dart(20, 3) : [dart(20, 3), dart(19, 3), dart(12, 2)][s.visitDarts.length]

const players = [
  { id: "a", name: "Mia" },
  { id: "b", name: "Jonas" },
]
const newGame = (id: string, throws: Throw[]): SavedMatch => ({ id, config: config({ players }), throws, startedAt: new Date().toISOString(), acknowledgedLegs: 0, status: "playing" })
const fullGame = playOut(config({ players }), miaWins)

// What spectators see of the game.
const shown = (s: MatchState) => ({ scores: s.scores, current: s.current, visitDarts: s.visitDarts, winner: s.winner, legs: s.legsWon })

function watcher(source: { match: string; key: string | null; relays: string[] }) {
  let latest: import("../../lib/live/follow.ts").Followed | null = null
  const handle = keep(follow.followMatch(source, (f) => (latest = f)))
  return { get: () => latest, close: handle.close }
}

test("a spectator replays the board's newest snapshot; without the match key nothing is readable", async () => {
  const game = newGame("watch-game", fullGame.slice(0, 4))
  const view = await live.goLive(game)
  opened.push(() => live.stopHere(game.id))
  const link = links.decodeLinkPayload("watch", view.watch)
  assert.deepEqual(link.relays, [relay.url])
  assert.ok(link.key)

  const spectator = watcher({ match: link.match, key: link.key ?? null, relays: link.relays })
  const sameAs = (g: SavedMatch) => () => {
    const live = spectator.get()?.state?.live
    if (!live) return null
    const watched = content.watchedGame(spectator.get()!.state!.agreement, live.content).state
    return watched && JSON.stringify(shown(watched)) === JSON.stringify(shown(replay(g.config, g.throws))) && live
  }
  const first = await until("the first snapshot", sameAs(game))
  assert.equal(spectator.get()?.connection, "live")

  // Every change goes out (at most one snapshot a second); the newest wins.
  const later = { ...game, throws: fullGame.slice(0, 9) }
  live.updateBoard({ ...game, throws: fullGame.slice(0, 6) })
  live.updateBoard(later)
  const second = await until("the newer snapshot", sameAs(later))
  assert.ok(second.n > first.n)

  // The founding and every snapshot are encrypted: names and throws are not on the relay in the clear.
  const stored = await nostr.query(follow.matchFilters(link.match), [relay.url])
  assert.ok(stored.events.length >= 2)
  assert.ok(!JSON.stringify(stored.events).includes("Mia"))
  const blind = watcher({ match: link.match, key: null, relays: link.relays })
  await until("the founding as sealed", () => blind.get()?.problem === "sealed")
})

test("players join from their phones without any key leaving them; their verdicts count until a correction", async () => {
  const local = "join-game"
  const game = newGame(local, fullGame.slice(0, 3))
  await live.goLive(game)
  opened.push(() => live.stopHere(local))
  const seats = keep(await seating.openSeating(local))
  const board = links.decodeLinkPayload("board", seats.code)

  // Everything the handshake sends, as anyone on the relay sees it.
  const seen: unknown[] = []
  const spy = keep(nostr.subscribe([{ kinds: [21180] }], [relay.url], { onevent: (event) => seen.push(event) }))

  const profileSecret = crypto.getRandomValues(new Uint8Array(32))
  const profile = await signers.createLocalSigner(profileSecret)
  const profilePubkey = await profile.getPublicKey()

  type Visit = import("../../lib/live/join.ts").BoardVisit
  const tableOf = (v: Visit) => (v.step === "table" ? v.table : null)
  const seatOf = (v: Visit) => (v.step === "seated" ? v.joined : null)
  const visit = () => {
    let current: Visit = { step: "looking" }
    const control = keep(join.visitBoard(board, (next) => (current = next)))
    return { control, get: () => current }
  }
  const sit = async (seat: number, signer: typeof profile | null) => {
    const phone = visit()
    const table = await until("the seats", () => tableOf(phone.get()))
    assert.deepEqual(table.seats.map((s) => s.alias), ["Mia", "Jonas"])
    await phone.control.join(seat, signer)
    const seated = await until("the seat", () => seatOf(phone.get()))
    return { seated, control: phone.control }
  }
  const mia = await sit(0, null)
  // One database stands in for both phones here: Mia's phone keeps its seat in memory, and its
  // stored seat goes before Jonas's phone looks (each real phone has a database of its own).
  await store.dropJoined(mia.seated.match)
  const jonas = await sit(1, profile)
  // Opened again (a reload, a fresh code), the phone is back on its seat without asking.
  const again = visit()
  const back = await until("the seat again", () => seatOf(again.get()))
  assert.equal(back.seat, 1)
  assert.equal(back.profile, profilePubkey)
  assert.equal(jonas.seated.profile, profilePubkey)
  assert.equal(jonas.seated.guest, null)
  assert.ok(mia.seated.guest)
  assert.ok(mia.seated.key, "the phone got the match key")

  // The board knows each seat's key: the guest's own one, the profile's public key.
  const holders = await until("both seats on the board", () => {
    const seats = live.boardView(local)?.seats
    return seats?.every((s) => s.holder) && seats
  })
  assert.deepEqual(holders[1].holder, { pubkey: profilePubkey, profile: true })
  assert.deepEqual(holders[0].holder, { pubkey: mia.seated.guest!.pubkey, profile: false })

  // No secret travelled, and none sits in the clear on either side's storage.
  spy.close()
  const db = await import("../../lib/storage/db.ts")
  const everything = JSON.stringify([seen, await db.dbGetAll("pending")], (_k, v) => (v instanceof Uint8Array ? bytesToHex(v) : v))
  assert.ok(seen.length >= 4)
  for (const secret of [bytesToHex(profileSecret), bytesToHex(mia.seated.guest!.secret)]) assert.ok(!everything.includes(secret))

  // The game ends; the result is published once it stays won.
  const finished = { ...game, throws: fullGame }
  live.updateBoard(finished)
  const phone = watcher({ match: jonas.seated.match, key: bytesToHex(jonas.seated.key!.secret), relays: jonas.seated.relays })
  const result = await until("the result", () => phone.get()?.state?.result)
  assert.equal(result.winner, 0)
  assert.deepEqual(result.legs, [1, 0])

  assert.ok(await join.giveVerdict(jonas.seated, phone.get()!.state!, "confirm", profile))
  assert.ok(await join.giveVerdict(mia.seated, phone.get()!.state!, "dispute", null))
  await until("both verdicts on the board", () => {
    const seats = live.boardView(local)?.seats
    return seats?.[0].verdict === "dispute" && seats[1].verdict === "confirm"
  })

  // The confirmed result is now among the player's own games.
  const archive = await import("../../lib/storage/archive.ts")
  let joined = await join.keepConfirmed(jonas.seated, phone.get()!.state!)
  assert.equal(joined.archived, result.event)
  assert.ok((await archive.loadArchive()).some((m) => m.id === jonas.seated.match))

  // The board frees the seat after the confirmation (and connects the phone again): the
  // result Jonas confirmed is unchanged, so the game stays among his own games. Records of
  // the same second are ordered by id, so the seat goes a second later, as it would in life.
  const confirmedAt = phone.get()!.state!.confirmations[1].at
  await until("the next second", () => Math.floor(Date.now() / 1000) > confirmedAt)
  await live.seatPlayer(local, 1, null)
  const freed = await until("the seat freed in the match", () => {
    const s = phone.get()?.state
    return s && s.seats[1] === null ? s : null
  })
  assert.equal(join.holdsSeat(joined, freed), false)
  joined = await join.keepConfirmed(joined, freed)
  assert.equal(joined.archived, result.event)
  assert.ok((await archive.loadArchive()).some((m) => m.id === jonas.seated.match))
  await live.seatPlayer(local, 1, { pubkey: profilePubkey, profile: true })
  await until("Jonas back on his seat in the match", () => phone.get()?.state?.seats[1]?.pubkey === profilePubkey)

  // A correction after publication: a new result names the old one, and the verdicts lapse.
  const plan = correctDart(finished.config, finished.throws, visitBySeq(replay(finished.config, finished.throws), 0)!, 0, { segment: 19, multiplier: 3 })
  const corrected = plan.keepResult ? plan.keepResult.throws : plan.rescored
  assert.notEqual(replay(finished.config, corrected).winner, null)
  live.updateBoard({ ...finished, throws: corrected })
  const second = await until("the corrected result", () => {
    const r = phone.get()?.state?.result
    return r && r.event !== result.event && r
  })
  assert.equal(second.replaces, result.event)
  assert.deepEqual(phone.get()!.state!.confirmations, {})
  await until("the lapsed verdicts on the board", () => live.boardView(local)?.seats.every((s) => s.verdict === null))
  joined = await join.keepConfirmed(joined, phone.get()!.state!)
  assert.equal(joined.archived, null)
  assert.ok(!(await archive.loadArchive()).some((m) => m.id === jonas.seated.match))

  // Confirmed again: the corrected game is the one kept.
  assert.ok(await join.giveVerdict(joined, phone.get()!.state!, "confirm", profile))
  const state = await until("the renewed verdict", () => phone.get()?.state?.confirmations[1]?.verdict === "confirm" && phone.get()!.state)
  joined = await join.keepConfirmed(joined, state)
  const kept = (await archive.loadArchive()).find((m) => m.id === jonas.seated.match)
  assert.deepEqual(kept?.throws, JSON.parse(JSON.stringify(corrected)))
  assert.equal(kept?.players[1].name, "Jonas")

})

test("a seat given back after a reload is freed on the board; a seat someone else holds is not taken up again", async () => {
  const local = "leave-game"
  const game = newGame(local, fullGame.slice(0, 3))
  await live.goLive(game)
  opened.push(() => live.stopHere(local))
  const seats = keep(await seating.openSeating(local))
  const board = links.decodeLinkPayload("board", seats.code)
  const profile = await signers.createLocalSigner(crypto.getRandomValues(new Uint8Array(32)))
  const profilePubkey = await profile.getPublicKey()

  type Visit = import("../../lib/live/join.ts").BoardVisit
  const visit = () => {
    let current: Visit = { step: "looking" }
    const control = keep(join.visitBoard(board, (next) => (current = next)))
    return { control, get: () => current }
  }
  const seatedAs = (v: Visit) => (v.step === "seated" ? v : null)
  const tableOf = (v: Visit) => (v.step === "table" ? v : null)
  const holders = () => live.boardView(local)?.seats.map((s) => s.holder?.pubkey ?? null)

  // A guest takes Mia's seat, then comes back with a fresh visit (a reload): the seat is restored
  // from memory, and "Anderen Platz wählen" gives it back from the guest's own key.
  const first = visit()
  await until("the seats", () => tableOf(first.get()))
  await first.control.join(0, null)
  const fresh = await until("the seat", () => seatedAs(first.get()))
  assert.equal(fresh.restored, false)
  const guestKey = fresh.joined.guest!.pubkey
  await until("the guest on the board", () => holders()?.[0] === guestKey)
  first.control.close()

  const again = visit()
  const back = await until("the seat from memory", () => seatedAs(again.get()))
  assert.equal(back.restored, true)
  assert.equal(back.joined.guest!.pubkey, guestKey)
  await again.control.leave(null)
  await until("the seat freed on the board", () => holders()?.[0] === null)
  const chooser = await until("the seats again", () => tableOf(again.get()))
  assert.equal(chooser.table.seats[0].taken, false)
  assert.equal(await store.loadJoined(back.joined.match), null, "the guest key is forgotten with the seat")

  // A profile takes Jonas's seat and gives it back after a reload with a fresh claim.
  await again.control.join(1, profile)
  const asProfile = await until("the profile's seat", () => seatedAs(again.get()))
  assert.equal(asProfile.joined.profile, profilePubkey)
  await until("the profile on the board", () => holders()?.[1] === profilePubkey)
  again.control.close()
  const third = visit()
  await until("the profile's seat from memory", () => seatedAs(third.get()))
  await third.control.leave(profile)
  await until("the profile's seat freed on the board", () => holders()?.[1] === null)
  await until("the seats once more", () => tableOf(third.get()))
  assert.equal(await store.loadJoined(asProfile.joined.match), null)

  // The guest takes Mia's seat again; the board frees it and another phone takes it. Back from
  // memory, the match shows another key on the seat: the phone forgets it and chooses anew.
  await third.control.join(0, null)
  const mine = await until("the guest's seat again", () => seatedAs(third.get()))
  await until("the guest on the board again", () => holders()?.[0] !== null)
  third.control.close()
  await live.seatPlayer(local, 0, null)
  const other = visit()
  await until("the seats for the other phone", () => tableOf(other.get()))
  await other.control.join(0, null)
  const othersSeat = await until("the other phone's seat", () => seatedAs(other.get()))
  const otherKey = othersSeat.joined.guest!.pubkey
  assert.notEqual(otherKey, mine.joined.guest!.pubkey)
  await until("the other phone on the board", () => holders()?.[0] === otherKey)
  // The first phone's memory, as its own database would keep it (one database here stands for
  // both phones, so the other phone's record has to give way).
  const theirs = (await store.loadJoined(mine.joined.match))!
  await store.saveJoined({ ...theirs, seat: 0, profile: null, keys: await store.sealKeys({ match: bytesToHex(mine.joined.key!.secret), guest: bytesToHex(mine.joined.guest!.secret) }), archived: null })
  const fourth = visit()
  const restored = await until("the seat restored for the first phone", () => seatedAs(fourth.get()))
  assert.equal(restored.restored, true)
  const match = watcher({ match: restored.joined.match, key: bytesToHex(restored.joined.key!.secret), relays: restored.joined.relays })
  const settled = await until("the match as the relays have it", () => {
    const f = match.get()
    return f?.settled && f.state ? f : null
  })
  assert.equal(join.holdsSeat(restored.joined, settled.state!), false)
  await fourth.control.forget()
  const chosen = await until("the seats with the hint", () => tableOf(fourth.get()))
  assert.equal(chosen.freed, true)
  assert.equal(chosen.table.seats[0].taken, true)
  assert.equal(await store.loadJoined(restored.joined.match), null)

  // The Play tab lists a seat with the game as the board offered it, for as long as the match
  // can run; a day later it is forgotten.
  await fourth.control.join(1, null)
  const listed = await until("the seat on the Play tab", async () => (await store.recentJoined()).find((r) => r.match === restored.joined.match))
  assert.deepEqual(listed.aliases, ["Mia", "Jonas"])
  assert.equal(listed.seat, 1)
  assert.deepEqual(await store.recentJoined(Date.now() + 2 * 24 * 60 * 60 * 1000), [])
  assert.equal(await store.loadJoined(restored.joined.match), null)
})

test("the writer hands the match to another device only after confirming; the old session counts no more", async () => {
  const local = "handoff-game"
  const game = newGame(local, fullGame.slice(0, 5))
  const view = await live.goLive(game)
  opened.push(() => live.stopHere(local))
  const link = links.decodeLinkPayload("watch", view.watch)
  const spectator = watcher({ match: link.match, key: link.key ?? null, relays: link.relays })
  await until("the board's snapshot", () => spectator.get()?.state?.live)
  // The old session's key, as an old device that kept writing would still have it.
  const sealed = await store.loadBoard(local)
  const oldKeys = await store.openKeys<import("../../lib/live/store.ts").BoardSecrets>(sealed!.keys)

  const device = new Worker(new URL("./live-device.ts", import.meta.url), { workerData: { relay: relay.url } })
  opened.push(() => device.terminate())
  const messages: { type: string; step?: string; checkCode?: string; game?: SavedMatch; live?: boolean }[] = []
  device.on("message", (m) => messages.push(m))
  await until("the other device", () => messages.some((m) => m.type === "ready"))

  let offer: import("../../lib/live/handoff.ts").HandoffOffer | null = null
  const control = keep(await handoff.offerHandoff(local, (next) => (offer = next)))
  const waiting = await until("the handoff code", () => offer?.step === "waiting" && offer)
  device.postMessage({ type: "take", code: waiting.code })

  // Both show the same check code; nothing moves before the person here confirms.
  const asked = await until("the request", () => offer?.step === "asked" && offer)
  const shownThere = await until("the check code over there", () => messages.find((m) => m.step === "asking"))
  assert.equal(asked.checkCode, shownThere.checkCode)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.ok(!messages.some((m) => m.type === "taken"))
  assert.ok(live.boardView(local))

  // The game kept on this device for going on with it goes along with the handover.
  const gameStorage = await import("../../lib/game/storage.ts")
  gameStorage.saveMatch(game)
  control.give()
  const taken = await until("the game over there", () => messages.find((m) => m.type === "taken"))
  assert.equal(taken.live, true)
  assert.deepEqual(JSON.parse(JSON.stringify(taken.game!.throws)), JSON.parse(JSON.stringify(game.throws)))
  await until("the handover done here", () => offer?.step === "done")
  assert.equal(live.boardView(local), null)
  assert.equal(await store.loadBoard(local), null)
  assert.equal(gameStorage.loadMatch(), null, "a reload would not offer the game here again")

  // The new device writes under session 2; spectators follow it.
  device.postMessage({ type: "throw", throws: fullGame.slice(0, 8) })
  const moved = await until("the new device's snapshot", () => {
    const state = spectator.get()?.state
    return state && state.current.sv === 2 && state.live?.sv === 2 && state.live.content.standing && state
  })
  const oldSession = await signers.createLocalSigner(Buffer.from(oldKeys!.session, "hex"))
  assert.notEqual(moved.current.session, await oldSession.getPublicKey())

  // A snapshot the old session signs afterwards is refused, however new it claims to be.
  const matchKey = await signers.createLocalSigner(Buffer.from(oldKeys!.match, "hex"))
  const records = await import("../../lib/protocol/records.ts")
  const late = content.snapshotFor(newGame(local, fullGame.slice(0, 12)), replay(game.config, fullGame.slice(0, 12)), { sv: 1, n: 999, auth: sealed!.founding })
  const template = records.buildRecord("match.live", late, { created_at: Math.floor(Date.now() / 1000), root: link.match, d: link.match })
  const sealedLate = records.encryptForLinkKey(template, await matchKey.getPublicKey(), await matchKey.nip44!.encrypt(await oldSession.getPublicKey(), template.content))
  const lateEvent = await oldSession.signEvent(sealedLate)
  await nostr.publish(lateEvent, [relay.url])
  const after = await until("the late snapshot refused", () => {
    const state = spectator.get()?.state
    return state?.log.rejected.find((r) => r.id === lateEvent.id) && state
  })
  assert.equal(after.log.rejected.find((r) => r.id === lateEvent.id)?.reason, "session_superseded")
  assert.equal(after.live?.sv, 2)

})

test("an offer closed right after 'Übergeben' is called off: the match stays here, the other device hears so", async () => {
  const local = "handoff-called-off"
  const game = newGame(local, fullGame.slice(0, 5))
  const view = await live.goLive(game)
  opened.push(() => live.stopHere(local))
  const link = links.decodeLinkPayload("watch", view.watch)
  const spectator = watcher({ match: link.match, key: link.key ?? null, relays: link.relays })
  const first = await until("the board's snapshot", () => spectator.get()?.state?.live)

  const device = new Worker(new URL("./live-device.ts", import.meta.url), { workerData: { relay: relay.url } })
  opened.push(() => device.terminate())
  const messages: { type: string; step?: string }[] = []
  device.on("message", (m) => messages.push(m))
  await until("the other device", () => messages.some((m) => m.type === "ready"))

  let offer: import("../../lib/live/handoff.ts").HandoffOffer | null = null
  const control = await handoff.offerHandoff(local, (next) => (offer = next))
  const waiting = await until("the handoff code", () => offer?.step === "waiting" && offer)
  device.postMessage({ type: "take", code: waiting.code })
  await until("the request", () => offer?.step === "asked")

  // Confirmed, then closed at once (the sheet went away): the package never leaves.
  control.give()
  control.close()
  await until("the other device told", () => messages.some((m) => m.step === "declined"))
  await new Promise((resolve) => setTimeout(resolve, 2000))
  assert.ok(!messages.some((m) => m.type === "taken"))
  assert.ok(live.boardView(local), "the match is still live here")
  assert.ok(await store.loadBoard(local), "the board's keys are kept")

  // And this device goes on writing under its own session.
  live.updateBoard({ ...game, throws: fullGame.slice(0, 8) })
  const next = await until("a newer snapshot from here", () => {
    const now = spectator.get()?.state?.live
    return now && now.n > first.n && now
  })
  assert.equal(next.sv, 1)
})

test("a device that leaves while asking to take over tells the writer, which keeps its code", async () => {
  const local = "handoff-left-asking"
  await live.goLive(newGame(local, fullGame.slice(0, 5)))
  opened.push(() => live.stopHere(local))
  let offer: import("../../lib/live/handoff.ts").HandoffOffer | null = null
  keep(await handoff.offerHandoff(local, (next) => (offer = next)))
  const waiting = await until("the handoff code", () => offer?.step === "waiting" && offer)

  let take: import("../../lib/live/handoff.ts").HandoffTake | null = null
  const taker = keep(handoff.takeHandoff(links.decodeLinkPayload("handoff", waiting.code), (next) => (take = next)))
  taker.take()
  await until("the request on the writer", () => offer?.step === "asked")
  await until("the check code on the taker", () => take?.step === "asking")
  // Back on the taker: the writer's offer is open again, under the same code.
  taker.close()
  const again = await until("the offer open again", () => offer?.step === "waiting" && offer)
  assert.equal(again.code, waiting.code)
  assert.ok(live.boardView(local), "the match is still live here")
})

test("a board handed over while a relay is out of reach sends nothing more from here", async () => {
  const local = "handed-over-relay-down"
  const port = await freePort()
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `${relay.url},ws://127.0.0.1:${port}`
  let view: import("../../lib/live/board.ts").BoardView
  try {
    view = await live.goLive(newGame(local, fullGame.slice(0, 4)))
  } finally {
    process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  }
  const link = links.decodeLinkPayload("watch", view.watch)
  assert.equal((await store.loadBoard(local))?.outbox.length, 1, "the founding waits for the second relay")
  // The other device confirmed the package (lib/live/handoff.ts) while the founding still
  // waits: this board is dropped, retries and all.
  await live.handedOver(local)
  assert.equal(live.boardView(local), null)
  assert.equal(await store.loadBoard(local), null)
  const second = await startRelay({ port })
  opened.push(() => second.stop())
  // A board still owing a retry would send the founding within its first pause (5 s).
  await new Promise((resolve) => setTimeout(resolve, 6500))
  const stored = await nostr.query(follow.matchFilters(link.match), [second.url])
  assert.equal(stored.events.length, 0, "the dropped board sent nothing more")
})

test("spectators get the score while one relay is out of reach; the founding waits for that relay", async () => {
  const local = "one-relay-down"
  const port = await freePort()
  // Nothing listens on the second relay's port yet: the founding can be read on one relay, but
  // it is not safely stored.
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `${relay.url},ws://127.0.0.1:${port}`
  let view: import("../../lib/live/board.ts").BoardView
  try {
    view = await live.goLive(newGame(local, fullGame.slice(0, 4)))
  } finally {
    process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  }
  opened.push(() => live.stopHere(local))
  const link = links.decodeLinkPayload("watch", view.watch)
  assert.equal(link.relays.length, 2)
  const spectator = watcher({ match: link.match, key: link.key ?? null, relays: link.relays })
  const first = await until("the first snapshot with one relay down", () => spectator.get()?.state?.live)
  assert.equal(first.sv, 1)
  assert.equal((await store.loadBoard(local))?.outbox.length, 1, "the founding stays in the outbox")

  // The relay comes up: the next send stores the founding safely, and the outbox empties.
  const second = await startRelay({ port })
  opened.push(() => second.stop())
  live.updateBoard(newGame(local, fullGame.slice(0, 6)))
  await until("the founding on both relays", async () => (await store.loadBoard(local))?.outbox.length === 0)
  const stored = await nostr.query(follow.matchFilters(link.match), [second.url])
  assert.ok(stored.events.some((e) => e.id === link.match))
})
