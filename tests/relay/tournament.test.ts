// A tournament end to end over a real relay (nak serve on 127.0.0.1): the organizer founds it,
// players register and are admitted, a guest without profile is added, the field is drawn, two
// boards are authorized and called, one board goes live and reports its result, the organizer
// approves, a correction marks the final as affected, and a board that was offline keeps its
// result until the relay is back. Run: npm run test:relay
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex } from "@noble/hashes/utils.js"
import "../storage-helpers.ts"
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
let draft: typeof import("../../lib/tournaments/draft.ts")
let engine: typeof import("../../lib/tournaments/engine.ts")
let live: typeof import("../../lib/live/board.ts")
let follow: typeof import("../../lib/live/follow.ts")
let nostr: typeof import("../../lib/nostr/client.ts")
let signers: typeof import("../../lib/nostr/signers.ts")
let session: typeof import("../../lib/profile/session.ts")
let links: typeof import("../../lib/protocol/links.ts")

// The port this machine assigns to these tests (nak relays only on 20640-20649).
const PORT = 20641

before(async () => {
  relay = await startRelay({ port: PORT })
  // Read whenever the code picks its relays: never a public relay in these tests.
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  ;[records, read, send, sync, store, device, draft, engine, live, follow, nostr, signers, session, links] = await Promise.all([
    import("../../lib/tournaments/records.ts"),
    import("../../lib/tournaments/read.ts"),
    import("../../lib/tournaments/send.ts"),
    import("../../lib/tournaments/sync.ts"),
    import("../../lib/tournaments/store.ts"),
    import("../../lib/tournaments/board-device.ts"),
    import("../../lib/tournaments/draft.ts"),
    import("../../lib/tournaments/engine.ts"),
    import("../../lib/live/board.ts"),
    import("../../lib/live/follow.ts"),
    import("../../lib/nostr/client.ts"),
    import("../../lib/nostr/signers.ts"),
    import("../../lib/profile/session.ts"),
    import("../../lib/protocol/links.ts"),
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
  return read.readTournament({ id: `tournament:${id}`, tournament: id, events: fetched.events, relays: [], unsent: [], loadedAt: Date.now(), seeds: {}, boardKeys: {}, openedAt: null }, { pubkey, live: liveInputs })
}

test("organizer, players, guest, draw, two boards, a live result, approval and a correction over the relay", async () => {
  const organizer = await person()
  // The organizer's session: lib/sync/publish.ts sends only the signed-in profile's events.
  await session.importLocalKey(organizer.secret)
  const players = await Promise.all([person(), person(), person()])

  // Found with the commitment to a seed kept here; a guest fills the fourth place.
  const seed = engine.createDrawSeed()
  const d = draft.newDraft("relay", "Europe/Berlin", Date.now(), { name: "Relay Open", capacity: 4, checkIn: false, rules: { startScore: 301, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate" } })
  const founded = await send.send(null, [records.foundTemplate(draft.foundContent(d, engine.commitSeed(seed)))], organizer)
  const id = founded.events[0].id
  assert.equal(founded.published, true, "the relay took the founding")
  await store.updateTournament(id, { seed: { commit: engine.commitSeed(seed), seed } })
  let state = (await fromRelay(id)).state
  assert.ok(state)
  const guestId = "a".repeat(32)
  await send.send(id, [records.guestTemplate(state, guestId, "Gast Gerd", false)], organizer)

  // Three players register from their own devices; the organizer admits them.
  for (const p of players) {
    const s = (await fromRelay(id)).state
    assert.ok(s)
    const sent = await send.send(id, [records.registerTemplate(s, `Spieler ${p.pubkey.slice(0, 4)}`)], p)
    assert.equal(sent.published, true)
  }
  state = (await fromRelay(id)).state
  assert.ok(state)
  assert.equal(read.requests(state).length, 3)
  await send.send(
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
  await send.send(id, [records.boardTemplate(state, boardAId, "Board A", boardA.pubkey), records.boardTemplate(state, boardBId, "Board B", boardB.pubkey)], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  await send.send(id, [records.drawTemplate(state, seed, read.drawField(state), [])], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state?.draw)
  await send.send(id, [records.phaseTemplate(state, "running")], organizer)
  let r = await fromRelay(id)
  assert.equal(r.state?.phase, "running")
  assert.ok(r.view)
  const semis = r.view.matches.filter((m) => m.state === "ready")
  assert.equal(semis.length, 2)
  const calls = engine.suggestBoards(r.view, [boardAId, boardBId])
  assert.equal(calls.length, 2)
  await send.send(
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
  assert.deepEqual(device.tournamentExtra(game.config), { id, slot: onA.id, board: boardAId })
  const players01: [string, string] = [onA.slots[0].participant as string, onA.slots[1].participant as string]
  let remembered = await device.rememberGame(recordA, onA.id, { local: game.id, match: null, players: players01, reported: null })
  const view = await live.goLive(game, { tournament: { id, slot: onA.id, authority: boardA.secret, relays: [relay.url] } })
  // The board stops writing whatever happens below, so no timer keeps the process alive.
  opened.push(() => live.stopHere(game.id))
  const liveMatch = links.decodeLinkPayload("watch", view.watch)
  assert.equal(liveMatch.key, undefined, "a tournament match is public: no key in the watch link")
  remembered = await device.rememberGame(remembered, onA.id, { ...remembered.games[onA.id], match: liveMatch.match })

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
  const result = device.resultOf(won, players01)
  assert.ok(result)
  assert.equal(result.winner, players01[0])
  assert.deepEqual(result.score, [1, 0])
  const reported = await device.reportResult(remembered, keyA, r.state as NonNullable<typeof r.state>, onA.id, result)
  assert.equal(reported.outbox.length, 0, "the relay took the result")
  assert.equal(reported.games[onA.id].reported?.key, result.key)
  // Reporting the same result again sends nothing.
  assert.equal((await device.reportResult(reported, keyA, r.state as NonNullable<typeof r.state>, onA.id, result)).games[onA.id].reported?.event, reported.games[onA.id].reported?.event)

  // Submitted, not yet counting; the organizer approves.
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(read.awaitingApproval(r.state as NonNullable<typeof r.state>).length, 1)
  assert.equal(r.view?.match(onA.id)?.state, "ready")
  const submission = read.awaitingApproval(r.state as NonNullable<typeof r.state>)[0].submissions[0]
  assert.equal(submission.by, boardA.pubkey)
  assert.equal(submission.match, liveMatch.match)
  await send.send(id, [records.approveTemplate(r.state as NonNullable<typeof r.state>, onA.id, submission.event)], organizer)
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(r.view?.match(onA.id)?.state, "finished")
  assert.equal(r.view?.match(onA.id)?.winner, players01[0])

  // The other semi-final and the final by the organizer; then a correction of the first
  // semi-final marks the final as affected.
  const onB = r.view?.matches.find((m) => m.board === boardBId) as NonNullable<typeof onA>
  await send.send(id, [records.resultTemplate(r.state as NonNullable<typeof r.state>, onB.id, { winner: onB.slots[1].participant, score: [0, 1] })], organizer)
  r = await fromRelay(id, organizer.pubkey)
  const final = r.view?.matches.find((m) => m.final) as NonNullable<typeof onA>
  assert.equal(final.state, "ready")
  await send.send(id, [records.resultTemplate(r.state as NonNullable<typeof r.state>, final.id, { winner: players01[0], score: [1, 0] })], organizer)
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(r.view?.champion, players01[0])
  await send.send(id, [records.correctTemplate(r.state as NonNullable<typeof r.state>, onA.id, players01[1], [0, 1], "Falsch gemeldet")], organizer)
  r = await fromRelay(id, players01[1])
  assert.equal(r.view?.match(final.id)?.affected, true)
  assert.equal(r.view?.champion, null)
  // The corrected winner now stands in the final, which waits for the organizer's decision.
  assert.equal(engine.nextMatch(r.view as NonNullable<typeof r.view>, players01[1])?.state, "waiting")
  assert.equal(r.view?.match(final.id)?.recorded?.[0], players01[0])
})

test("a board that is offline keeps its result and sends it once the relay is back", async () => {
  const organizer = await person()
  await session.importLocalKey(organizer.secret, { replace: true })
  const seed = engine.createDrawSeed()
  const d = draft.newDraft("offline", "Europe/Berlin", Date.now(), { name: "Offline Open", capacity: 2, checkIn: false, format: "single", boards: [] })
  const founded = await send.send(null, [records.foundTemplate(draft.foundContent(d, engine.commitSeed(seed)))], organizer)
  const id = founded.events[0].id
  let state = (await fromRelay(id)).state
  assert.ok(state)
  await send.send(id, [records.guestTemplate(state, "d".repeat(32), "Gast Eins", false), records.guestTemplate(state, "e".repeat(32), "Gast Zwei", false)], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  const board = await person()
  const boardId = "f".repeat(32)
  await send.send(id, [records.boardTemplate(state, boardId, "Board", board.pubkey)], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  await send.send(id, [records.drawTemplate(state, seed, read.drawField(state), [])], organizer)
  state = (await fromRelay(id)).state
  assert.ok(state)
  await send.send(id, [records.phaseTemplate(state, "running")], organizer)
  let r = await fromRelay(id)
  const only = r.view?.matches[0] as NonNullable<typeof r.view>["matches"][number]
  await send.send(id, [records.assignTemplate(r.state as NonNullable<typeof r.state>, only.id, boardId)], organizer)
  r = await fromRelay(id)
  const record = await device.becomeBoard({ tournament: id, board: boardId, key: bytesToHex(board.secret), relays: [relay.url] })
  const key = await device.openBoardKey(record)
  assert.ok(key)
  const pair: [string, string] = ["d".repeat(32), "e".repeat(32)]
  const remembered = await device.rememberGame(record, only.id, { local: "offline-game", match: null, players: pair, reported: null })
  const game: SavedMatch = { id: "offline-game", config: config({ startScore: 301, players: [{ id: "seat0", name: "Gast Eins" }, { id: "seat1", name: "Gast Zwei" }] }), throws: [], startedAt: "", acknowledgedLegs: 0, status: "playing" }
  const won = { ...game, throws: play(game.config, [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11, 3), dart(14, 2)]) }
  const result = device.resultOf(won, pair)
  assert.ok(result)

  // The relay goes away: the result stays in the board's outbox.
  const port = relay.port
  await relay.stop()
  const kept = await device.reportResult(remembered, key, r.state as NonNullable<typeof r.state>, only.id, result)
  assert.equal(kept.outbox.length, 1)
  assert.equal(kept.games[only.id].reported?.event, kept.outbox[0].id)

  // Back: the next flush delivers it, and the organizer sees the submission.
  relay = await startRelay({ port })
  // The relay is empty again (in memory): the organizer's device sends its copy once more.
  const stored = await store.loadStoredTournament(id)
  assert.ok(stored)
  await send.resend(id, stored.events.filter((e) => e.pubkey === organizer.pubkey))
  const flushed = await until("the board's outbox to empty", async () => {
    const next = await device.flushBoard(kept)
    return next.outbox.length === 0 ? next : null
  })
  assert.equal(flushed.outbox.length, 0)
  r = await fromRelay(id, organizer.pubkey)
  assert.equal(read.awaitingApproval(r.state as NonNullable<typeof r.state>).length, 1)
  assert.equal(read.awaitingApproval(r.state as NonNullable<typeof r.state>)[0].submissions[0].winner, pair[0])
})
