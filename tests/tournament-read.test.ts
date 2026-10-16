import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import "./storage-helpers.ts"
import type { EventTemplate, NostrEvent } from "../lib/nostr/types.ts"
import { reduceTournament } from "../lib/protocol/tournament-state.ts"
import { cleanNames, draftProblems, foundContent, newDraft } from "../lib/tournaments/draft.ts"
import { createDrawSeed, commitSeed } from "../lib/tournaments/engine.ts"
import { exportFileName, tournamentCsv, tournamentJson } from "../lib/tournaments/export.ts"
import { badgeOccasion } from "../lib/tournaments/occasion.ts"
import { awaitingApproval, bracketOf, dependentSlots, drawField, freePlaces, readTournament, registrationOpen } from "../lib/tournaments/read.ts"
import {
  admitTemplate,
  approveTemplate,
  assignTemplate,
  boardTemplate,
  correctTemplate,
  drawTemplate,
  foundTemplate,
  guestTemplate,
  phaseTemplate,
  registerTemplate,
  resultTemplate,
} from "../lib/tournaments/records.ts"
import { loadStoredTournament, updateTournament, type StoredTournament } from "../lib/tournaments/store.ts"

// The bridge from the tournament's records to the engine's bracket: the founding from a draft,
// registrations admitted, the draw, boards called, a board's result approved, a correction that
// marks what depends on it, the end with its badge occasion and exports.

const person = () => {
  const secret = generateSecretKey()
  return { secret, pubkey: getPublicKey(secret) }
}
const organizer = person()
const players = Array.from({ length: 4 }, person)
const boardKey = person()
const NOW = 1760000000
// The templates date records by the device's clock (after everything the state applied), so the
// replay reads with that clock too; only the founding is dated in the past.
const CLOCK = Math.floor(Date.now() / 1000) + 60

const sign = (who: { secret: Uint8Array }, template: EventTemplate) => finalizeEvent(template, who.secret) as NostrEvent

const stored = (tournament: string, events: NostrEvent[]): StoredTournament => ({ id: `tournament:${tournament}`, tournament, events, relays: [], unsent: [], loadedAt: null, seeds: {}, boardKeys: {}, openedAt: null })

const state = (events: NostrEvent[], id: string) => {
  const r = reduceTournament(events, id, { now: CLOCK })
  assert.ok(r.state, `state: ${r.state ? "" : r.problem}`)
  return r.state
}

const read = (events: NostrEvent[], id: string, pubkey: string | null = organizer.pubkey, live: { slot: string; match: string; by: string }[] = []) =>
  readTournament(stored(id, events), { pubkey, now: CLOCK, live })

test("a draft becomes a founding the protocol accepts, and names what is missing", () => {
  const draft = newDraft("d1", "Europe/Berlin", NOW * 1000, { name: "  Pub Open  ", guests: ["Mia", "mia ", "Jonas"], boards: ["Board 1"], starts: "2026-10-24T19:00" })
  assert.deepEqual(draftProblems(draft), [])
  assert.deepEqual(cleanNames(draft.guests), ["Mia", "Jonas"])
  const content = foundContent(draft, commitSeed("abc"))
  assert.equal(content.name, "Pub Open")
  assert.equal(content.rules.legsToWin, 3)
  assert.equal(content.timezone, "Europe/Berlin")
  assert.ok(content.starts && content.starts > NOW)
  // The template checks the content against the schema.
  assert.doesNotThrow(() => foundTemplate(content, NOW))
  assert.deepEqual(draftProblems({ ...draft, name: "" }), ["name"])
  assert.deepEqual(draftProblems({ ...draft, format: "groups", capacity: 3 }), ["groups"])
  assert.deepEqual(draftProblems({ ...draft, format: "double", capacity: 2 }), ["capacity"])
  assert.deepEqual(draftProblems({ ...draft, guests: Array.from({ length: 20 }, (_, i) => `G${i}`) }), ["guests"])
  assert.ok(draftProblems({ ...draft, format: "roundRobin", capacity: 100 }).includes("capacity"))
})

test("records, draw, boards, results, correction and the end run through the engine", () => {
  const seed = createDrawSeed()
  const draft = newDraft("d2", "Europe/Berlin", NOW * 1000, { name: "Donnerstagsturnier", capacity: 4, checkIn: false, boards: [] })
  const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed(seed)), NOW))
  const id = found.id
  let events = [found]
  let s = state(events, id)
  assert.equal(freePlaces(s), 4)
  assert.equal(registrationOpen(s, CLOCK), true)

  // Four players ask; the organizer admits them (auto admission is the device's job, not the protocol's).
  for (const [i, p] of players.entries()) events.push(sign(p, registerTemplate(state(events, id), `Spieler ${i + 1}`)))
  s = state(events, id)
  assert.equal(Object.values(s.participants).filter((p) => p.status === "pending").length, 4)
  for (const p of players) events.push(sign(organizer, admitTemplate(state(events, id), p.pubkey)))
  s = state(events, id)
  assert.equal(freePlaces(s), 0)
  assert.deepEqual(drawField(s).sort(), players.map((p) => p.pubkey).sort())
  // A guest would not fit any more.
  const full = reduceTournament([...events, sign(organizer, guestTemplate(s, "a".repeat(32), "Gast", false))], id, { now: CLOCK })
  assert.ok(full.state && full.state.participants["a".repeat(32)] === undefined)

  // The draw opens the commitment made at the founding; the bracket follows from it.
  events.push(sign(organizer, drawTemplate(s, seed, drawField(s), [players[0].pubkey])))
  s = state(events, id)
  assert.equal(s.phase, "drawn")
  assert.equal(s.draw?.order[0], players[0].pubkey)
  let r = read(events, id)
  assert.ok(r.view && r.bracket)
  assert.equal(r.view.matches.length, 3)
  assert.equal(r.view.matches.filter((m) => m.state === "ready").length, 2)
  assert.equal(r.names[players[0].pubkey], "Spieler 1")
  assert.equal(r.me.organizer, true)
  assert.equal(read(events, id, players[1].pubkey).me.participant?.id, players[1].pubkey)

  // A board is authorized and the first semi-final called to it; the board's live match starts it.
  const boardId = "b".repeat(32)
  events.push(sign(organizer, boardTemplate(state(events, id), boardId, "Board 1", boardKey.pubkey)))
  events.push(sign(organizer, phaseTemplate(state(events, id), "running")))
  const semi = r.view.matches.find((m) => m.state === "ready") as NonNullable<typeof r.view>["matches"][number]
  events.push(sign(organizer, assignTemplate(state(events, id), semi.id, boardId)))
  r = read(events, id)
  assert.equal(r.view?.match(semi.id)?.board, boardId)
  r = read(events, id, organizer.pubkey, [{ slot: semi.id, match: "c".repeat(64), by: boardKey.pubkey }])
  assert.equal(r.view?.match(semi.id)?.state, "live")
  assert.deepEqual(r.live[semi.id], { slot: semi.id, match: "c".repeat(64), board: boardId })

  // The board reports; nothing moves until the organizer approves (approval "organizer").
  const winner = semi.slots[0].participant as string
  events.push(sign(boardKey, resultTemplate(state(events, id), semi.id, { winner, score: [3, 1] })))
  s = state(events, id)
  assert.equal(awaitingApproval(s).length, 1)
  assert.equal(read(events, id).view?.match(semi.id)?.state, "ready")
  events.push(sign(organizer, approveTemplate(s, semi.id, awaitingApproval(s)[0].submissions[0].event)))
  r = read(events, id)
  assert.equal(r.view?.match(semi.id)?.state, "finished")
  assert.equal(r.view?.match(semi.id)?.winner, winner)
  assert.deepEqual(r.view?.match(semi.id)?.score, { legs: [3, 1] })

  // The other semi-final by the organizer (counts at once), then the final.
  const other = r.view?.matches.find((m) => m.id !== semi.id && m.state === "ready") as NonNullable<typeof r.view>["matches"][number]
  events.push(sign(organizer, resultTemplate(state(events, id), other.id, { winner: other.slots[1].participant, score: [0, 3] })))
  r = read(events, id)
  const final = r.view?.matches.find((m) => m.final) as NonNullable<typeof r.view>["matches"][number]
  assert.equal(final.state, "ready")
  assert.deepEqual(final.slots.map((x) => x.participant), [winner, other.slots[1].participant])
  events.push(sign(organizer, resultTemplate(state(events, id), final.id, { winner, score: [3, 2] })))
  r = read(events, id)
  assert.equal(r.view?.champion, winner)
  assert.equal(r.view?.complete, true)

  // A correction of the first semi-final: the played final no longer fits and is marked, never replayed.
  const loser = semi.slots[1].participant as string
  const dependents = dependentSlots(bracketOf(state(events, id)) as NonNullable<ReturnType<typeof bracketOf>>, semi.id)
  assert.deepEqual(dependents, [final.id])
  events.push(sign(organizer, correctTemplate(state(events, id), semi.id, loser, [1, 3], "Falsch eingetragen")))
  r = read(events, id)
  assert.equal(r.view?.match(semi.id)?.winner, loser)
  assert.equal(r.view?.match(final.id)?.affected, true)
  assert.equal(r.view?.champion, null)
  assert.equal(r.state?.slots[final.id].affected, true)
  assert.deepEqual(r.skipped, [])

  // The organizer corrects it back, finishes, and the badge occasion names the places.
  events.push(sign(organizer, correctTemplate(state(events, id), semi.id, winner, [3, 1], "Doch richtig")))
  r = read(events, id)
  assert.equal(r.view?.match(final.id)?.affected, false)
  assert.equal(r.view?.champion, winner)
  events.push(sign(organizer, phaseTemplate(state(events, id), "finished")))
  r = read(events, id)
  assert.equal(r.state?.phase, "finished")
  const occasion = badgeOccasion(r)
  assert.ok(occasion)
  assert.equal(occasion.scope, "tournament")
  assert.equal(occasion.ended.by, organizer.pubkey)
  assert.equal(occasion.final, true)
  assert.equal(occasion.places.find((p) => p.place === 1)?.pubkey, winner)
  assert.equal(occasion.places.length, 4)

  const csv = tournamentCsv(r, {
    round: (m) => `R${m.round}`,
    state: (m) => m.state,
    name: (p) => (p ? r.names[p] : ""),
    board: (b) => (b ? r.state?.boards[b]?.name ?? b : ""),
    columns: ["Nr", "Runde", "A", "B", "Ergebnis", "Sieger", "Board", "Status"],
  })
  const lines = csv.trim().split("\r\n")
  assert.equal(lines.length, 4)
  assert.ok(lines[1].includes("3:1"))
  assert.ok(lines[1].includes("Board 1"))
  const json = tournamentJson(stored(id, events), r)
  assert.equal(json.format, "blueline-tournament")
  assert.equal(json.summary?.matches.length, 3)
  assert.equal(json.events.length, events.length)
  assert.equal(exportFileName("Pub Open / Nr. 3", "csv"), "Pub-Open-Nr-3.csv")

  events = events.slice()
})

test("group matches feed the knockout: a group result affects every knockout slot of that group", () => {
  const seed = createDrawSeed()
  const field = Array.from({ length: 8 }, person)
  const draft = newDraft("d3", "Europe/Berlin", NOW * 1000, { name: "Gruppen", capacity: 8, checkIn: false, format: "groups", groups: { count: 2, advance: 2 } })
  const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed(seed)), NOW))
  const events = [found]
  for (const p of field) events.push(sign(p, registerTemplate(state(events, found.id))))
  for (const p of field) events.push(sign(organizer, admitTemplate(state(events, found.id), p.pubkey)))
  events.push(sign(organizer, drawTemplate(state(events, found.id), seed, drawField(state(events, found.id)), [])))
  const bare = bracketOf(state(events, found.id))
  assert.ok(bare)
  const groupMatch = bare.matches.find((m) => m.group === "A") as (typeof bare.matches)[number]
  const dependents = dependentSlots(bare, groupMatch.id)
  // The two semi-finals (fed by group A) and the final after them, no group matches.
  assert.ok(dependents.length === 3, dependents.join(","))
  assert.ok(dependents.every((d) => bare.matches.find((m) => m.id === d)?.bracket === "main"))
})

test("the local copy keeps unsent events in order until relays confirm them", async () => {
  const id = "d".repeat(64)
  const e = (i: number) => ({ id: `${i}`.padStart(64, "0"), pubkey: "", created_at: i, kind: 1180, tags: [], content: "", sig: "" }) as NostrEvent
  await updateTournament(id, { events: [e(1), e(2)], sent: { confirmed: [], missing: [e(1).id, e(2).id] }, relays: ["wss://a.example"] })
  let stored = await loadStoredTournament(id)
  assert.deepEqual(stored?.unsent, [e(1).id, e(2).id])
  await updateTournament(id, { sent: { confirmed: [e(1).id], missing: [e(2).id] } })
  stored = await loadStoredTournament(id)
  assert.deepEqual(stored?.unsent, [e(2).id])
  // A fetch that returns the event counts as confirmation; others are only added.
  await updateTournament(id, { events: [e(2), e(3)], loadedAt: 5 })
  stored = await loadStoredTournament(id)
  assert.deepEqual(stored?.unsent, [])
  assert.equal(stored?.events.length, 3)
  assert.equal(stored?.loadedAt, 5)
  assert.deepEqual(stored?.relays, ["wss://a.example"])
})
