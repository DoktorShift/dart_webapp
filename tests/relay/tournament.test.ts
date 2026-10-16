// A tournament end to end over a real relay (nak serve on 127.0.0.1): the organizer founds it,
// players register and are admitted, a guest without profile is added, the field is drawn, two
// boards are authorized and called, one board goes live and reports its result, the organizer
// approves, a correction marks the final as affected, and a board that was offline keeps its
// result in the outbox until the relay is back. Fetching reads each relay to its end, also when
// relays hold different records. Run: npm run test:relay (NAK_PORT_RANGE for this machine's ports)
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex } from "@noble/hashes/utils.js"
import type { IDBFactory } from "fake-indexeddb"
import { localStore } from "../storage-helpers.ts"
import { newDevice, switchTo } from "../support/devices.ts"
import { startRelay, type NakRelay } from "../support/nak.ts"
import { config, dart, play } from "../helpers.ts"
import type { SavedMatch } from "../../lib/game/types.ts"

let relay: NakRelay
let records: typeof import("../../lib/tournaments/records.ts")
let read: typeof import("../../lib/tournaments/read.ts")
let send: typeof import("../../lib/tournaments/send.ts")
let sync: typeof import("../../lib/tournaments/sync.ts")
let store: typeof import("../../lib/tournaments/store.ts")
let device: typeof import("../../lib/tournaments/board-device.ts")
let extra: typeof import("../../lib/tournaments/extra.ts")
let draft: typeof import("../../lib/tournaments/draft.ts")
let engine: typeof import("../../lib/tournaments/engine.ts")
let live: typeof import("../../lib/live/board.ts")
let follow: typeof import("../../lib/live/follow.ts")
let nostr: typeof import("../../lib/nostr/client.ts")
let signers: typeof import("../../lib/nostr/signers.ts")
let links: typeof import("../../lib/protocol/links.ts")
let outbox: typeof import("../../lib/sync/outbox.ts")
let archive: typeof import("../../lib/storage/archive.ts")

before(async () => {
  relay = await startRelay()
  // Read whenever the code picks its relays: never a public relay in these tests.
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  ;[records, read, send, sync, store, device, extra, draft, engine, live, follow, nostr, signers, links, outbox, archive] = await Promise.all([
    import("../../lib/tournaments/records.ts"),
    import("../../lib/tournaments/read.ts"),
    import("../../lib/tournaments/send.ts"),
    import("../../lib/tournaments/sync.ts"),
    import("../../lib/tournaments/store.ts"),
    import("../../lib/tournaments/board-device.ts"),
    import("../../lib/tournaments/extra.ts"),
    import("../../lib/tournaments/draft.ts"),
    import("../../lib/tournaments/engine.ts"),
    import("../../lib/live/board.ts"),
    import("../../lib/live/follow.ts"),
    import("../../lib/nostr/client.ts"),
    import("../../lib/nostr/signers.ts"),
    import("../../lib/protocol/links.ts"),
    import("../../lib/sync/outbox.ts"),
    import("../../lib/storage/archive.ts"),
  ])
})

const opened: (() => unknown)[] = []
after(async () => {
  for (const close of opened) await close()
  nostr.relayClient().close()
  await relay?.stop()
})

async function until<T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// Signs, keeps and queues records (lib/tournaments/send.ts), then lets the outbox send what is due
// (in a page it starts by itself).
async function sent(tournament: string | null, templates: Parameters<typeof send.send>[1], author: Parameters<typeof send.send>[2]) {
  const events = await send.send(tournament, templates, author)
  await outbox.flushDue()
  return events
}

// A person with a key of their own (a player's profile), signing like the app's session would.
async function person() {
  const { secretKey } = await signers.createLocalKey()
  const signer = await signers.createLocalSigner(secretKey)
  return { secret: secretKey, pubkey: await signer.getPublicKey(), signer }
}

// What another device knows after asking the relay: the tournament replayed from the relay's
// events alone (not this device's copy).
async function fromRelay(id: string, pubkey: string | null = null, liveInputs: { slot: string; match: string; by: string }[] = []) {
  const fetched = await sync.fetchTournament(id, [])
  assert.ok(fetched.answered, "the relay answered")
  return read.readTournament({ id: `tournament:${id}`, tournament: id, events: fetched.events, relays: [], loadedAt: Date.now(), seeds: {}, boardKeys: {}, openedAt: null }, { pubkey, live: liveInputs })
}

test("organizer, players, guest, draw, two boards, a live result, approval and a correction over the relay", async () => {
  const organizer = await person()
  const players = await Promise.all([person(), person(), person()])

  // Found with the commitment to a seed kept here; a guest fills the fourth place.
  const seed = engine.createDrawSeed()
  const d = draft.newDraft("relay", "Europe/Berlin", Date.now(), { name: "Relay Open", capacity: 4, checkIn: false, rules: { startScore: 301, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate" } })
  const [founding] = await sent(null, [records.foundTemplate(draft.foundContent(d, engine.commitSeed(seed)))], organizer)
  const id = founding.id
  assert.equal(await outbox.deliveryStatus(id), null, "the relay took the founding")
  let state = (await fromRelay(id)).state
  assert.ok(state)
  const guestId = "a".repeat(32)
  await sent(id, [records.guestTemplate(state, guestId, "Gast Gerd", false)], organizer)

  // Three players register from their own devices; the organizer admits them.
  for (const p of players) {
    const s = (await fromRelay(id)).state
    assert.ok(s)
    await sent(id, [records.registerTemplate(s, `Spieler ${p.pubkey.slice(0, 4)}`)], p)
  }
  state = (await fromRelay(id)).state
  assert.ok(state)
  assert.equal(read.requests(state).length, 3)
  await sent(
    id,
    players.map((p) => records.admitTemplate(state as NonNullable<typeof state>, p.pubkey)),
    organizer,
  )
  state = (await fromRelay(id)).state
  assert.ok(state)
  assert.equal(read.freePlaces(state), 0)
  // A player's own reading: registered.
  assert.equal((await fromRelay(id, players[0].pubkey)).me.participant?.status, "registered")

  // Two boards, the draw, the start.
  const boardA = await person()
  const boardB = await person()
  const boardAId = "b".repeat(32)
  const boardBId = "c".repeat(32)
  await sent(id, [records.boardTemplate(state, boardAId, "Board A", boardA.pubkey), records.boardTemplate(state, boardBId, "Board B", boardB.pubkey)], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  await sent(id, [records.drawTemplate(state, seed, read.drawField(state), [])], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state?.draw)
  await sent(id, [records.phaseTemplate(state, "running")], organizer)
  let r = await fromRelay(id)
  assert.equal(r.state?.phase, "running")
  assert.ok(r.view)
  const semis = r.view.matches.filter((m) => m.state === "ready")
  assert.equal(semis.length, 2)
  const calls = engine.suggestBoards(r.view, [boardAId, boardBId])
  assert.equal(calls.length, 2)
  await sent(
    id,
    calls.map((c) => records.assignTemplate(r.state as NonNullable<typeof r.state>, c.match, c.board)),
    organizer,
  )
  r = await fromRelay(id)
  const onA = r.view?.matches.find((m) => m.board === boardAId)
  assert.ok(onA)

  // Board A becomes a board device, starts its match live under the board key, plays it out,
  // reports the result with the board key.
  const recordA = await device.becomeBoard({ tournament: id, board: boardAId, key: bytesToHex(boardA.secret), relays: [relay.url] })
  const keyA = await device.openBoardKey(recordA)
  assert.ok(keyA && keyA.pubkey === boardA.pubkey)
  const game = device.boardGame(r.state as NonNullable<typeof r.state>, onA, r.names, boardAId, "301")
  assert.equal(game.config.startScore, 301)
  assert.deepEqual(extra.tournamentGame(game), { id, slot: onA.id, board: boardAId, game: game.id })
  // A rematch copies the config but is another game: no tournament game.
  assert.equal(extra.tournamentGame({ ...game, id: "rematch" }), null)
  const players01: [string, string] = [onA.slots[0].participant as string, onA.slots[1].participant as string]
  await store.rememberGame(id, onA.id, () => ({ local: game.id, match: null, players: players01, reported: null }))
  const view = await live.goLive(game, { tournament: { id, slot: onA.id, authority: boardA.secret, relays: [relay.url] } })
  // The board stops writing whatever happens below, so no timer keeps the process alive.
  opened.push(() => live.stopHere(game.id))
  // The founding waits in the outbox like every record; in a page it goes out by itself.
  await outbox.flushDue()
  const liveMatch = links.decodeLinkPayload("watch", view.watch)
  assert.equal(liveMatch.key, undefined, "a tournament match is public: no key in the watch link")
  await store.rememberGame(id, onA.id, (before) => ({ ...(before as NonNullable<typeof before>), match: liveMatch.match }))

  // The organizer's device finds the live match by the board's key and the bracket shows it live.
  const foundings: { slot: string; match: string; by: string }[] = []
  const watching = follow.watchFoundings({ authors: [boardA.pubkey, boardB.pubkey], relays: [relay.url] }, (f) => foundings.push({ slot: f.agreement.tournament?.slot as string, match: f.match, by: f.by }))
  opened.push(() => watching.close())
  await until("the founding by the board key", () => foundings.length > 0)
  assert.equal(foundings[0].slot, onA.id)
  r = await fromRelay(id, organizer.pubkey, foundings)
  assert.equal(r.view?.match(onA.id)?.state, "live")
  assert.equal(r.live[onA.id]?.board, boardAId)

  // Player 0 (seat 0) wins 301 in one leg: 180, 121 checkout (T20, T11, D14).
  const c = { ...game.config, players: game.config.players }
  const won: SavedMatch = { ...game, throws: play(c, [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11, 3), dart(14, 2)]) }
  live.updateBoard(won)
  const result = device.resultOf(won, players01)
  assert.ok(result)
  assert.equal(result.winner, players01[0])
  assert.deepEqual(result.score, [1, 0])
  // A rematch of it reports nothing.
  await device.reportResult(id, keyA, r.state as NonNullable<typeof r.state>, onA.id, { ...won, id: "rematch" })
  assert.equal((await store.loadBoardDevice(id))?.games[onA.id].reported, null)
  await device.reportResult(id, keyA, r.state as NonNullable<typeof r.state>, onA.id, won)
  await outbox.flushDue()
  const reported = (await store.loadBoardDevice(id))?.games[onA.id].reported
  assert.equal(reported?.key, result.key)
  assert.equal(await outbox.deliveryStatus(reported?.event ?? ""), null, "the relay took the result")
  // Reporting the same result again sends nothing.
  await device.reportResult(id, keyA, r.state as NonNullable<typeof r.state>, onA.id, won)
  assert.equal((await store.loadBoardDevice(id))?.games[onA.id].reported?.event, reported?.event)

  // Submitted, not yet counting; the organizer approves.
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(read.awaitingApproval(r.state as NonNullable<typeof r.state>).length, 1)
  assert.equal(r.view?.match(onA.id)?.state, "ready")
  const submission = read.awaitingApproval(r.state as NonNullable<typeof r.state>)[0].submissions[0]
  assert.equal(submission.by, boardA.pubkey)
  assert.equal(submission.match, liveMatch.match)
  await sent(id, [records.approveTemplate(r.state as NonNullable<typeof r.state>, onA.id, submission.event)], organizer)
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(r.view?.match(onA.id)?.state, "finished")
  assert.equal(r.view?.match(onA.id)?.winner, players01[0])

  // On the phone of a player of it, the approved match is now one of their own games, made from
  // the live match the board scored it in (keepPlayed), once however often the tournament is read.
  const player = players.find((p) => players01.includes(p.pubkey)) as (typeof players)[number]
  await until("the live match's result", async () => {
    await outbox.flushDue()
    return (await follow.readMatch({ match: liveMatch.match, relays: [relay.url], key: null }))?.result
  })
  const boardDevice = { idb: globalThis.indexedDB as unknown as IDBFactory, local: localStore }
  const phone = newDevice()
  const ownGames = async () => {
    await switchTo(phone)
    try {
      const fetched = await sync.fetchTournament(id, [])
      const reading = read.readTournament({ id: `tournament:${id}`, tournament: id, events: fetched.events, relays: [], loadedAt: Date.now(), seeds: {}, boardKeys: {}, openedAt: null }, { pubkey: player.pubkey })
      await sync.keepPlayed(reading, fetched.events, player.pubkey)
      return (await archive.loadArchive()).map((m) => [m.id, m.throws?.length])
    } finally {
      await switchTo(boardDevice)
    }
  }
  assert.deepEqual(await ownGames(), [[liveMatch.match, won.throws.length]])
  assert.deepEqual(await ownGames(), [[liveMatch.match, won.throws.length]])

  // The other semi-final and the final by the organizer; then a correction of the first
  // semi-final marks the final as affected.
  const onB = r.view?.matches.find((m) => m.board === boardBId) as NonNullable<typeof onA>
  await sent(id, [records.resultTemplate(r.state as NonNullable<typeof r.state>, onB.id, { winner: onB.slots[1].participant, score: [0, 1] })], organizer)
  r = await fromRelay(id, organizer.pubkey)
  const final = r.view?.matches.find((m) => m.final) as NonNullable<typeof onA>
  assert.equal(final.state, "ready")
  await sent(id, [records.resultTemplate(r.state as NonNullable<typeof r.state>, final.id, { winner: players01[0], score: [1, 0] })], organizer)
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(r.view?.champion, players01[0])
  await sent(id, [records.correctTemplate(r.state as NonNullable<typeof r.state>, onA.id, players01[1], [0, 1], "Falsch gemeldet")], organizer)
  r = await fromRelay(id, players01[1])
  assert.equal(r.view?.match(final.id)?.affected, true)
  assert.deepEqual(await ownGames(), [], "the corrected match is no longer the player's own game")
  assert.equal(r.view?.champion, null)
  // The corrected winner now stands in the final, which waits for the organizer's decision.
  assert.equal(engine.nextMatch(r.view as NonNullable<typeof r.view>, players01[1])?.state, "waiting")
  assert.equal(r.view?.match(final.id)?.recorded?.[0], players01[0])
})

test("a board that is offline keeps its result in the outbox and sends it once the relay is back", async () => {
  const organizer = await person()
  const seed = engine.createDrawSeed()
  const d = draft.newDraft("offline", "Europe/Berlin", Date.now(), { name: "Offline Open", capacity: 2, checkIn: false, format: "single", boards: [] })
  const [founding] = await sent(null, [records.foundTemplate(draft.foundContent(d, engine.commitSeed(seed)))], organizer)
  const id = founding.id
  let state = (await fromRelay(id)).state
  assert.ok(state)
  await sent(id, [records.guestTemplate(state, "d".repeat(32), "Gast Eins", false), records.guestTemplate(state, "e".repeat(32), "Gast Zwei", false)], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  const board = await person()
  const boardId = "f".repeat(32)
  await sent(id, [records.boardTemplate(state, boardId, "Board", board.pubkey)], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  await sent(id, [records.drawTemplate(state, seed, read.drawField(state), [])], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  await sent(id, [records.phaseTemplate(state, "running")], organizer)
  let r = await fromRelay(id)
  const only = r.view?.matches[0] as NonNullable<typeof r.view>["matches"][number]
  await sent(id, [records.assignTemplate(r.state as NonNullable<typeof r.state>, only.id, boardId)], organizer)
  r = await fromRelay(id)
  const record = await device.becomeBoard({ tournament: id, board: boardId, key: bytesToHex(board.secret), relays: [relay.url] })
  const key = await device.openBoardKey(record)
  assert.ok(key)
  const pair: [string, string] = ["d".repeat(32), "e".repeat(32)]
  await store.rememberGame(id, only.id, () => ({ local: "offline-game", match: null, players: pair, reported: null }))
  const game: SavedMatch = { id: "offline-game", config: config({ startScore: 301, players: [{ id: "seat0", name: "Gast Eins" }, { id: "seat1", name: "Gast Zwei" }] }), throws: [], startedAt: "", acknowledgedLegs: 0, status: "playing" }
  const won = { ...game, throws: play(game.config, [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11, 3), dart(14, 2)]) }

  // The relay goes away: the result is reported the moment the game is won (as the game screen
  // does) and waits in the outbox.
  const port = relay.port
  await relay.stop()
  await device.reportGame(id, only.id, game)
  assert.equal((await store.loadBoardDevice(id))?.games[only.id].reported, null, "nothing while the game is not won")
  await device.reportGame(id, only.id, won)
  await outbox.flushDue()
  const reported = (await store.loadBoardDevice(id))?.games[only.id].reported
  assert.ok(reported)
  assert.equal((await outbox.deliveryStatus(reported.event))?.state, "waiting")
  assert.equal((await send.waitingRecords()).get(id), 1)

  // Back, empty (nak keeps nothing in memory): another copy of the tournament reaches it, and the
  // outbox sends the result once asked (the device came back online).
  relay = await startRelay({ port })
  const stored = await store.loadStoredTournament(id)
  assert.ok(stored)
  for (const event of stored.events.filter((e) => e.id !== reported.event)) await nostr.publish(event, [relay.url])
  await outbox.sendWaitingNow()
  await until("the result to leave the outbox", async () => (await outbox.deliveryStatus(reported.event)) === null)
  assert.equal((await send.waitingRecords()).get(id), undefined)
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(read.awaitingApproval(r.state as NonNullable<typeof r.state>).length, 1)
  assert.equal(read.awaitingApproval(r.state as NonNullable<typeof r.state>)[0].submissions[0].winner, pair[0])
})

test("a won game whose result screen was left at once is reported by the board, also before the device becomes another board", async () => {
  const organizer = await person()
  const seed = engine.createDrawSeed()
  const d = draft.newDraft("quick", "Europe/Berlin", Date.now(), { name: "Schnell zurück", capacity: 2, checkIn: false, format: "single", boards: [] })
  const [founding] = await sent(null, [records.foundTemplate(draft.foundContent(d, engine.commitSeed(seed)))], organizer)
  const id = founding.id
  const pair: [string, string] = ["a".repeat(32), "b".repeat(32)]
  let state = (await fromRelay(id)).state as NonNullable<Awaited<ReturnType<typeof fromRelay>>["state"]>
  await sent(id, [records.guestTemplate(state, pair[0], "Anna", false), records.guestTemplate(state, pair[1], "Mia", false)], organizer)
  const [boardA, boardB] = [await person(), await person()]
  const [boardAId, boardBId] = ["1".repeat(32), "2".repeat(32)]
  state = (await fromRelay(id)).state as typeof state
  await sent(id, [records.boardTemplate(state, boardAId, "Board 1", boardA.pubkey), records.boardTemplate(state, boardBId, "Board 2", boardB.pubkey)], organizer)
  state = (await fromRelay(id)).state as typeof state
  await sent(id, [records.drawTemplate(state, seed, read.drawField(state), [])], organizer)
  state = (await fromRelay(id)).state as typeof state
  await sent(id, [records.phaseTemplate(state, "running")], organizer)
  let r = await fromRelay(id)
  const only = r.view?.matches[0] as NonNullable<typeof r.view>["matches"][number]
  await sent(id, [records.assignTemplate(r.state as NonNullable<typeof r.state>, only.id, boardAId)], organizer)

  // Board 1 plays the match; the game is won and kept in the archive, but its result screen was
  // closed before anything was reported (no game screen any more).
  await device.becomeBoard({ tournament: id, board: boardAId, key: bytesToHex(boardA.secret), relays: [relay.url] })
  const game: SavedMatch = { id: "quick-game", config: config({ startScore: 301, players: [{ id: "seat0", name: "Anna" }, { id: "seat1", name: "Mia" }] }), throws: [], startedAt: "", acknowledgedLegs: 0, status: "playing" }
  await store.rememberGame(id, only.id, () => ({ local: game.id, match: null, players: pair, reported: null }))
  const won = { ...game, throws: play(game.config, [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11, 3), dart(14, 2)]) }
  assert.equal(await archive.archiveFinished(won), true)

  // The same device becomes Board 2: what it won as Board 1 goes out first.
  await device.becomeBoard({ tournament: id, board: boardBId, key: bytesToHex(boardB.secret), relays: [relay.url] })
  assert.deepEqual((await store.loadBoardDevice(id))?.games, {})
  await outbox.flushDue()
  r = await fromRelay(id, organizer.pubkey)
  const submitted = read.awaitingApproval(r.state as NonNullable<typeof r.state>)[0]?.submissions[0]
  assert.equal(submitted?.by, boardA.pubkey)
  assert.equal(submitted?.winner, pair[0])
  // The board screen on Board 2 has nothing of Board 1's to report.
  assert.deepEqual(await device.reportPlayed(id), [])
})

test("fetching reads each relay to its end, so relays holding different records lose nothing", async () => {
  const second = await startRelay()
  opened.push(() => second.stop())
  const author = await person()
  const tournament = "f".repeat(64)
  const start = Math.floor(Date.now() / 1000) - 10_000
  const events = await Promise.all(Array.from({ length: 600 }, (_, i) => author.signer.signEvent({ kind: 1180, created_at: start + i + 1, tags: [["e", tournament]], content: String(i) })))
  // The first relay has everything; the second missed two stretches (it was down for a while).
  const missed = (i: number) => (i >= 450 && i < 550) || (i >= 150 && i < 160)
  for (const [i, event] of events.entries()) await nostr.publish(event, missed(i) ? [relay.url] : [relay.url, second.url])
  const fetched = await sync.fetchTournament(tournament, [second.url])
  assert.equal(fetched.answered, true)
  assert.equal(fetched.complete, true)
  assert.equal(new Set(fetched.events.map((e) => e.id)).size, 600)
})
