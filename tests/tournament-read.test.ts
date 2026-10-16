import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import "./storage-helpers.ts"
import type { EventTemplate, NostrEvent } from "../lib/nostr/types.ts"
import { reduceTournament } from "../lib/protocol/tournament-state.ts"
import { cleanNames, draftProblems, foundContent, newDraft } from "../lib/tournaments/draft.ts"
import { createLocalSigner } from "../lib/nostr/signers.ts"
import { buildRecord } from "../lib/protocol/records.ts"
import { tagValue } from "../lib/protocol/tags.ts"
import type { SealedSecret } from "../lib/profile/vault.ts"
import { dbGetAll } from "../lib/storage/db.ts"
import { createDrawSeed, commitSeed, previewChange, recordResult } from "../lib/tournaments/engine.ts"
import { exportFileName, tournamentCsv, tournamentJson } from "../lib/tournaments/export.ts"
import { badgeOccasion } from "../lib/tournaments/occasion.ts"
import { awaitingApproval, bracketOf, dependentSlots, drawField, freePlaces, nextAdmission, notCheckedIn, playedMatches, readTournament, registrationOpen } from "../lib/tournaments/read.ts"
import {
  admitTemplate,
  approveTemplate,
  assignTemplate,
  boardTemplate,
  checkInTemplate,
  correctTemplate,
  drawTemplate,
  foundTemplate,
  guestTemplate,
  phaseTemplate,
  registerTemplate,
  resultTemplate,
  revokeBoardTemplate,
  updateTemplate,
  waitlistTemplate,
  withdrawTemplate,
} from "../lib/tournaments/records.ts"
import { send, waitingRecords } from "../lib/tournaments/send.ts"
import { admitNext } from "../lib/tournaments/admission.ts"
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

const stored = (tournament: string, events: NostrEvent[]): StoredTournament => ({ id: `tournament:${tournament}`, tournament, events, relays: [], loadedAt: null, seeds: {}, boardKeys: {}, openedAt: null })

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

// A tournament of `n` players, admitted, drawn and running, for the bridge's edge cases.
function running(n: number, options: { format?: "single" | "double"; approval?: "organizer" | "board" } = {}) {
  const seed = createDrawSeed()
  const field = Array.from({ length: n }, person)
  const draft = newDraft("e", "Europe/Berlin", NOW * 1000, { name: "Kante", capacity: n, checkIn: false, boards: [], format: options.format ?? "single", approval: options.approval ?? "organizer" })
  const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed(seed)), NOW))
  const id = found.id
  const events = [found]
  field.forEach((p, i) => events.push(sign(p, registerTemplate(state(events, id), `P${i}`))))
  for (const p of field) events.push(sign(organizer, admitTemplate(state(events, id), p.pubkey)))
  events.push(sign(organizer, drawTemplate(state(events, id), seed, drawField(state(events, id)), [])))
  events.push(sign(organizer, phaseTemplate(state(events, id), "running")))
  return { id, events, field }
}

type Match = NonNullable<ReturnType<typeof read>["view"]>["matches"][number]
const readyMatches = (events: NostrEvent[], id: string) => (read(events, id).view?.matches ?? []).filter((m) => m.state === "ready")
const finalOf = (events: NostrEvent[], id: string) => read(events, id).view?.matches.find((m) => m.final) as Match

test("'Neu spielen lassen' starts a match over: it is called, played and decided again", () => {
  const { id, events } = running(4)
  const semis = readyMatches(events, id)
  for (const m of semis) events.push(sign(organizer, resultTemplate(state(events, id), m.id, { winner: m.slots[0].participant, score: [3, 0] })))
  const final = finalOf(events, id)
  events.push(sign(organizer, resultTemplate(state(events, id), final.id, { winner: final.slots[0].participant, score: [3, 1] })))
  events.push(sign(organizer, correctTemplate(state(events, id), semis[0].id, semis[0].slots[1].participant, [0, 3], "Falsch")))
  assert.equal(read(events, id).view?.match(final.id)?.affected, true)

  events.push(sign(organizer, correctTemplate(state(events, id), final.id, null, [0, 0], "Neu spielen")))
  let r = read(events, id)
  assert.equal(r.state?.slots[final.id].approved, null)
  assert.equal(r.view?.match(final.id)?.state, "ready")
  assert.equal(r.view?.match(final.id)?.affected, false)

  const boardId = "b".repeat(32)
  events.push(sign(organizer, boardTemplate(state(events, id), boardId, "Board 1", boardKey.pubkey)))
  events.push(sign(organizer, assignTemplate(state(events, id), final.id, boardId)))
  const replayed = read(events, id).view?.match(final.id) as Match
  assert.equal(replayed.board, boardId)
  events.push(sign(boardKey, resultTemplate(state(events, id), final.id, { winner: replayed.slots[1].participant, score: [2, 3] })))
  const s = state(events, id)
  assert.deepEqual(s.log.rejected, [])
  events.push(sign(organizer, approveTemplate(s, final.id, s.slots[final.id].submissions[0].event)))
  r = read(events, id)
  assert.equal(r.view?.complete, true)
  assert.equal(r.view?.champion, replayed.slots[1].participant)
  assert.deepEqual(r.skipped, [])
})

test("a board match a player played counts for their own games once approved, and no longer once corrected or played again", () => {
  const { id, events, field } = running(4)
  const semi = readyMatches(events, id)[0]
  const [a, b] = semi.slots.map((x) => x.participant as string)
  const spectator = field.find((p) => p.pubkey !== a && p.pubkey !== b)!.pubkey
  const boardId = "b".repeat(32)
  const match = "c".repeat(64)
  events.push(sign(organizer, boardTemplate(state(events, id), boardId, "Board 1", boardKey.pubkey)))
  events.push(sign(organizer, assignTemplate(state(events, id), semi.id, boardId)))
  events.push(sign(boardKey, resultTemplate(state(events, id), semi.id, { winner: a, score: [3, 1], match })))
  const played = (pubkey: string) => playedMatches(read(events, id, pubkey), events)

  // Reported, not approved yet: nothing to keep.
  assert.deepEqual(played(b), [{ match, slot: semi.id, seat: 1, record: null }])
  const s = state(events, id)
  const approval = sign(organizer, approveTemplate(s, semi.id, s.slots[semi.id].submissions[0].event))
  events.push(approval)
  assert.deepEqual(played(a), [{ match, slot: semi.id, seat: 0, record: approval.id }])
  assert.deepEqual(played(b), [{ match, slot: semi.id, seat: 1, record: approval.id }])
  assert.equal(played(spectator)[0].record, null, "only the two players keep it")

  // A correction takes it out; "Neu spielen" too, and the board's new match is the one kept.
  events.push(sign(organizer, correctTemplate(state(events, id), semi.id, b, [1, 3], "Falsch eingetragen")))
  assert.equal(played(b)[0].record, null)
  events.push(sign(organizer, correctTemplate(state(events, id), semi.id, null, [0, 0], "Neu spielen")))
  events.push(sign(organizer, assignTemplate(state(events, id), semi.id, boardId)))
  const again = "d".repeat(64)
  events.push(sign(boardKey, resultTemplate(state(events, id), semi.id, { winner: b, score: [1, 3], match: again })))
  const t = state(events, id)
  const second = sign(organizer, approveTemplate(t, semi.id, t.slots[semi.id].submissions[0].event))
  events.push(second)
  assert.deepEqual(played(b), [
    { match, slot: semi.id, seat: 1, record: null },
    { match: again, slot: semi.id, seat: 1, record: second.id },
  ])
})

test("a correction to a walkover changes the winner in the bracket too", () => {
  const { id, events } = running(4)
  const m = readyMatches(events, id)[0]
  events.push(sign(organizer, resultTemplate(state(events, id), m.id, { winner: m.slots[0].participant, score: [3, 0] })))
  const winner = m.slots[1].participant as string
  events.push(sign(organizer, correctTemplate(state(events, id), m.id, winner, [0, 0], "Nicht angetreten", "noShow")))
  const r = read(events, id)
  assert.equal(r.state?.slots[m.id].approved?.walkover, "noShow")
  assert.equal(r.view?.match(m.id)?.state, "walkover")
  assert.equal(r.view?.match(m.id)?.winner, winner)
  assert.deepEqual(r.skipped, [])
})

test("a winner who does not play the match is refused by the bracket and left to the organizer", () => {
  const { id, events, field } = running(4, { approval: "board" })
  const boardId = "b".repeat(32)
  events.push(sign(organizer, boardTemplate(state(events, id), boardId, "Board 1", boardKey.pubkey)))
  const m = readyMatches(events, id)[0]
  events.push(sign(organizer, assignTemplate(state(events, id), m.id, boardId)))
  const outsider = field.map((p) => p.pubkey).find((p) => !m.slots.some((x) => x.participant === p)) as string
  events.push(sign(boardKey, resultTemplate(state(events, id), m.id, { winner: outsider, score: [3, 1] })))
  const r = read(events, id)
  assert.equal(r.state?.slots[m.id].approved?.winner, outsider)
  assert.equal(r.view?.match(m.id)?.state, "ready")
  assert.deepEqual(r.skipped.map((x) => x.slot), [m.id])
})

test("a correction's preview is what the reading shows after it (double elimination)", () => {
  const { id, events } = running(4, { format: "double" })
  let r = read(events, id)
  for (let next = r.view?.matches.find((m) => m.state === "ready"); next; next = r.view?.matches.find((m) => m.state === "ready")) {
    events.push(sign(organizer, resultTemplate(state(events, id), next.id, { winner: next.slots[0].participant, score: [3, 1] })))
    r = read(events, id)
  }
  assert.equal(r.view?.complete, true)
  const first = r.view?.matches.find((m) => m.round === 1 && m.bracket === "winners") as Match
  const bracket = r.bracket as NonNullable<typeof r.bracket>
  const preview = previewChange(bracket, recordResult(bracket, first.id, { legs: [1, 3] })).filter((c) => c.match !== first.id && c.kind === "affected")
  events.push(sign(organizer, correctTemplate(state(events, id), first.id, first.slots[1].participant, [1, 3], "Falsch")))
  const after = read(events, id)
  assert.deepEqual(after.view?.matches.filter((m) => m.affected).map((m) => m.id).sort(), preview.map((c) => c.match).sort())
  assert.deepEqual(after.skipped, [])
})

test("a withdrawal after the draw applies where it was made, so the next results still count", () => {
  const { id, events, field } = running(4)
  const [semi1, semi2] = readyMatches(events, id)
  events.push(sign(organizer, resultTemplate(state(events, id), semi1.id, { winner: semi1.slots[0].participant, score: [3, 0] })))
  const quitter = field.find((p) => p.pubkey === semi2.slots[1].participant) as ReturnType<typeof person>
  events.push(sign(quitter, withdrawTemplate(state(events, id))))
  let r = read(events, id)
  assert.equal(r.view?.match(semi2.id)?.state, "walkover")
  assert.equal(r.view?.match(semi2.id)?.winner, semi2.slots[0].participant)
  const final = finalOf(events, id)
  assert.equal(final.state, "ready")
  events.push(sign(organizer, resultTemplate(state(events, id), final.id, { winner: final.slots[0].participant, score: [3, 1] })))
  r = read(events, id)
  assert.equal(r.view?.complete, true)
  assert.equal(r.view?.champion, final.slots[0].participant)
  assert.deepEqual(r.skipped, [])
})

test("a withdrawal dated before the draw takes the player out of the drawn field first", () => {
  const seed = createDrawSeed()
  const draft = newDraft("w", "Europe/Berlin", NOW * 1000, { name: "Rückdatiert", capacity: 4, checkIn: false, boards: [] })
  const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed(seed)), NOW))
  const id = found.id
  const events = [found]
  for (const p of players) events.push(sign(p, registerTemplate(state(events, id))))
  for (const p of players) events.push(sign(organizer, admitTemplate(state(events, id), p.pubkey)))
  const draw = sign(organizer, drawTemplate(state(events, id), seed, drawField(state(events, id)), []))
  events.push(draw)
  events.push(sign(players[2], buildRecord("tournament.withdraw", {}, { created_at: draw.created_at - 1, root: id })))
  const r = read(events, id)
  assert.equal(r.state?.participants[players[2].pubkey].status, "withdrawn")
  const theirs = r.view?.matches.find((m) => m.round === 1 && m.slots.some((x) => x.participant === players[2].pubkey)) as Match
  assert.equal(theirs.state, "walkover")
  assert.notEqual(theirs.winner, players[2].pubkey)
})

test("a player who left before the draw and came back keeps what they played when they leave again", () => {
  // Review round 2 (ADV5): the status at the draw decides, not the final one.
  const seed = createDrawSeed()
  const draft = newDraft("b", "Europe/Berlin", NOW * 1000, { name: "Zurück", capacity: 4, checkIn: false, boards: [] })
  const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed(seed)), NOW))
  const id = found.id
  const events = [found]
  for (const p of players) events.push(sign(p, registerTemplate(state(events, id))))
  for (const p of players) events.push(sign(organizer, admitTemplate(state(events, id), p.pubkey)))
  const back = players[0]
  events.push(sign(back, withdrawTemplate(state(events, id))))
  events.push(sign(back, registerTemplate(state(events, id), "Wieder da")))
  events.push(sign(organizer, admitTemplate(state(events, id), back.pubkey)))
  events.push(sign(organizer, drawTemplate(state(events, id), seed, drawField(state(events, id)), [])))
  events.push(sign(organizer, phaseTemplate(state(events, id), "running")))
  const theirs = readyMatches(events, id).find((m) => m.slots.some((x) => x.participant === back.pubkey)) as Match
  events.push(sign(organizer, resultTemplate(state(events, id), theirs.id, { winner: back.pubkey, score: [3, 2] })))
  events.push(sign(back, withdrawTemplate(state(events, id), "Verletzt")))
  let r = read(events, id)
  assert.equal(r.view?.match(theirs.id)?.state, "finished")
  assert.equal(r.view?.match(theirs.id)?.winner, back.pubkey)
  assert.deepEqual(r.skipped, [])
  // They left after their win: the final goes to the other semi's winner without a game.
  const other = readyMatches(events, id)[0]
  events.push(sign(organizer, resultTemplate(state(events, id), other.id, { winner: other.slots[0].participant, score: [3, 0] })))
  r = read(events, id)
  assert.equal(r.view?.complete, true)
  assert.equal(r.view?.champion, other.slots[0].participant)
})

test("a result for a walkover from a withdrawal stays a task only until it is taken back", () => {
  // Review round 2 (ADV9, ADV12): the bracket refuses a result for a match a player left; taking
  // the decision back (a correction without a winner) is the one thing that clears it.
  const { id, events, field } = running(4)
  const m = readyMatches(events, id)[0]
  const quitter = field.find((p) => p.pubkey === m.slots[1].participant) as ReturnType<typeof person>
  events.push(sign(quitter, withdrawTemplate(state(events, id))))
  assert.equal(read(events, id).view?.match(m.id)?.walkover, "withdrawn")
  events.push(sign(organizer, resultTemplate(state(events, id), m.id, { winner: m.slots[1].participant, score: [1, 3] })))
  let r = read(events, id)
  assert.deepEqual(r.skipped.map((x) => x.slot), [m.id])
  events.push(sign(organizer, correctTemplate(state(events, id), m.id, null, [0, 0], "Zurückgenommen")))
  r = read(events, id)
  assert.deepEqual(state(events, id).log.rejected, [])
  assert.deepEqual(r.skipped, [])
  assert.equal(r.view?.match(m.id)?.state, "walkover")
  assert.equal(r.view?.match(m.id)?.winner, m.slots[0].participant)
})

test("a withdrawal dated before a played result of the same player: the tournament still finishes", () => {
  const { id, events, field } = running(4)
  const m = readyMatches(events, id)[0]
  const result = sign(organizer, resultTemplate(state(events, id), m.id, { winner: m.slots[0].participant, score: [3, 0] }))
  events.push(result)
  const p = field.find((x) => x.pubkey === m.slots[0].participant) as ReturnType<typeof person>
  events.push(sign(p, buildRecord("tournament.withdraw", {}, { created_at: result.created_at - 1, root: id })))
  for (let next = readyMatches(events, id)[0]; next; next = readyMatches(events, id)[0])
    events.push(sign(organizer, resultTemplate(state(events, id), next.id, { winner: next.slots[0].participant, score: [3, 0] })))
  let r = read(events, id)
  assert.equal(r.view?.complete, true)
  assert.deepEqual(r.skipped.map((x) => x.slot), [m.id])
  events.push(sign(organizer, correctTemplate(state(events, id), m.id, null, [0, 0], "Zurückgenommen")))
  r = read(events, id)
  assert.deepEqual(r.skipped, [])
  assert.equal(r.view?.complete, true)
})

test("a live match counts only from the key of the board it is called to", () => {
  const { id, events } = running(4)
  const boardId = "b".repeat(32)
  const other = person()
  events.push(sign(organizer, boardTemplate(state(events, id), boardId, "Board 1", boardKey.pubkey)))
  events.push(sign(organizer, boardTemplate(state(events, id), "c".repeat(32), "Board 2", other.pubkey)))
  const [called, uncalled] = readyMatches(events, id)
  events.push(sign(organizer, assignTemplate(state(events, id), called.id, boardId)))
  const live = [
    { slot: called.id, match: "1".repeat(64), by: other.pubkey },
    { slot: uncalled.id, match: "2".repeat(64), by: boardKey.pubkey },
  ]
  let r = read(events, id, organizer.pubkey, live)
  assert.deepEqual(r.live, {})
  assert.equal(r.view?.match(called.id)?.state, "ready")
  r = read(events, id, organizer.pubkey, [{ slot: called.id, match: "3".repeat(64), by: boardKey.pubkey }])
  assert.equal(r.view?.match(called.id)?.state, "live")
  events.push(sign(organizer, revokeBoardTemplate(state(events, id), boardId)))
  r = read(events, id, organizer.pubkey, [{ slot: called.id, match: "3".repeat(64), by: boardKey.pubkey }])
  assert.deepEqual(r.live, {})
})

test("guests the organizer entered count as present at the check-in", () => {
  const seed = createDrawSeed()
  const draft = newDraft("g", "Europe/Berlin", NOW * 1000, { name: "Gäste", capacity: 4, checkIn: true, boards: [] })
  const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed(seed)), NOW))
  const id = found.id
  const events = [found]
  events.push(sign(organizer, guestTemplate(state(events, id), "a".repeat(32), "Mia", false)))
  for (const p of players.slice(0, 2)) events.push(sign(p, registerTemplate(state(events, id))))
  for (const p of players.slice(0, 2)) events.push(sign(organizer, admitTemplate(state(events, id), p.pubkey)))
  events.push(sign(organizer, phaseTemplate(state(events, id), "checkin")))
  events.push(sign(players[0], checkInTemplate(state(events, id))))
  const s = state(events, id)
  assert.deepEqual(notCheckedIn(s).map((p) => p.id), [players[1].pubkey])
  assert.deepEqual(drawField(s).sort(), ["a".repeat(32), players[0].pubkey].sort())
})

test("automatic admission takes requests by their date, keeps the waiting list's order and fills it once the field is full", () => {
  const draft = newDraft("a", "Europe/Berlin", NOW * 1000, { name: "Auto", capacity: 2, checkIn: false, boards: [], admission: "auto", waitlist: true })
  const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed("s")), NOW))
  const id = found.id
  const events = [found]
  // Kept in this order (a fetch reads relays newest first); the third asks with the earliest date.
  events.push(sign(players[0], buildRecord("tournament.register", {}, { created_at: NOW + 3, root: id })))
  events.push(sign(players[1], buildRecord("tournament.register", {}, { created_at: NOW + 2, root: id })))
  events.push(sign(players[2], buildRecord("tournament.register", {}, { created_at: NOW + 1, root: id })))
  const decide = () => nextAdmission(state(events, id))
  const step = () => {
    const next = decide() as NonNullable<ReturnType<typeof decide>>
    const s = state(events, id)
    events.push(sign(organizer, next.to === "admit" ? admitTemplate(s, next.participant.id) : waitlistTemplate(s, next.participant.id)))
    return [next.to, next.participant.id]
  }
  assert.deepEqual(step(), ["admit", players[2].pubkey])
  assert.deepEqual(step(), ["admit", players[1].pubkey])
  assert.deepEqual(step(), ["waitlist", players[0].pubkey])
  events.push(sign(players[3], registerTemplate(state(events, id))))
  assert.deepEqual(step(), ["waitlist", players[3].pubkey])
  assert.equal(decide(), null)
  // A place frees up and the one who left asks again: the first on the waiting list comes in.
  events.push(sign(players[2], withdrawTemplate(state(events, id))))
  events.push(sign(players[2], registerTemplate(state(events, id))))
  assert.deepEqual(step(), ["admit", players[0].pubkey])
  // The full field again: the new request goes behind the one waiting longer.
  assert.deepEqual(step(), ["waitlist", players[2].pubkey])
})

test("sending keeps the records, then queues them in order after what still waits", async () => {
  const author = { pubkey: organizer.pubkey, signer: await createLocalSigner(organizer.secret) }
  const draft = newDraft("s", "Europe/Berlin", NOW * 1000, { name: "Gesendet", capacity: 4, checkIn: false, boards: [] })
  const [found] = await send(null, [foundTemplate(foundContent(draft, commitSeed("seed")), NOW)], author, { seed: { commit: commitSeed("seed"), seed: "seed" } })
  const id = found.id
  let kept = await loadStoredTournament(id)
  assert.equal(kept?.seeds[commitSeed("seed")], "seed")
  assert.deepEqual(kept?.events.map((e) => e.id), [id])
  const s = state([found], id)
  const [update, phase] = await send(id, [updateTemplate(s, { name: "Umbenannt" }), phaseTemplate(s, "checkin")], author)
  kept = await loadStoredTournament(id)
  assert.equal(kept?.events.length, 3)
  const after = new Map((await dbGetAll<{ id: string; after: string[] }>("outbox")).map((e) => [e.id, e.after]))
  assert.deepEqual(after.get(id), [])
  assert.deepEqual(after.get(update.id), [id])
  assert.deepEqual(after.get(phase.id), [update.id])
  assert.equal((await waitingRecords()).get(id), 3)
})

test("two tabs deciding automatic admission at the same moment sign each decision once", async () => {
  const author = { pubkey: organizer.pubkey, signer: await createLocalSigner(organizer.secret) }
  const draft = newDraft("t", "Europe/Berlin", NOW * 1000, { name: "Zwei Tabs", capacity: 2, checkIn: false, boards: [], admission: "auto", waitlist: true })
  const [found] = await send(null, [foundTemplate(foundContent(draft, commitSeed("s")), NOW)], author)
  const id = found.id
  const asks = players.slice(0, 3).map((p, i) => sign(p, buildRecord("tournament.register", {}, { created_at: NOW + i + 1, root: id })))
  await updateTournament(id, { events: asks })
  // Both tabs see the same requests and decide at once; the second decides on the first's record.
  const [a, b] = await Promise.all([admitNext(id, author), admitNext(id, author)])
  assert.ok(a && b)
  const third = await admitNext(id, author)
  assert.equal(await admitNext(id, author), null)
  const s = state((await loadStoredTournament(id))?.events ?? [], id)
  assert.deepEqual(s.log.rejected, [])
  assert.deepEqual([a, b, third].map((e) => e && tagValue(e.tags, "l")), ["tournament.admit", "tournament.admit", "tournament.waitlist"])
  assert.equal(s.participants[players[0].pubkey].status, "registered")
  assert.equal(s.participants[players[1].pubkey].status, "registered")
  assert.equal(s.participants[players[2].pubkey].status, "waitlist")
})

test("writes of one tournament from two tabs at the same moment keep each other's seed and board key", async () => {
  // Two module instances stand for two tabs: each has its own queues, only the lock is shared.
  const secondTab = "../lib/tournaments/store.ts?tab=2"
  const other = (await import(secondTab)) as typeof import("../lib/tournaments/store.ts")
  const id = "c".repeat(64)
  const key = {} as SealedSecret
  await Promise.all([
    updateTournament(id, { seed: { commit: "commit", seed: "seed" } }),
    other.updateTournament(id, { boardKey: { board: "board", key } }),
    updateTournament(id, { relays: ["wss://a.example"] }),
    other.updateTournament(id, { openedAt: 1 }),
  ])
  const kept = await loadStoredTournament(id)
  assert.equal(kept?.seeds.commit, "seed")
  assert.ok(kept?.boardKeys.board)
  assert.deepEqual(kept?.relays, ["wss://a.example"])
  assert.equal(kept?.openedAt, 1)
})
