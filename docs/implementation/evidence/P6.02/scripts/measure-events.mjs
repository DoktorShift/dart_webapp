// Load measurement for a tournament of 128 participants on 16 boards (PLAN.md, first binding
// load size): how many records such a tournament is, how long reading them takes (the protocol
// replay plus the engine, as every screen does it), what one more change costs, and how long a
// relay needs to deliver all of it. Run from the repository root, with nak:
//
//   node docs/implementation/evidence/P6.02/scripts/measure-events.mjs [--relay ws://127.0.0.1:20642]
//
// Without --relay only the local figures are measured. The relay figures start the tournament's
// records on an empty nak serve and fetch them back the way the app does. Wall-clock times on
// a loaded development machine: lab values, not field measurements.
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-core"
import { reduceTournament } from "../../../../../lib/protocol/tournament-state.ts"
import { foundContent, newDraft } from "../../../../../lib/tournaments/draft.ts"
import { commitSeed, createDrawSeed, suggestBoards } from "../../../../../lib/tournaments/engine.ts"
import { bracketOf, dependentSlots, drawField, readTournament } from "../../../../../lib/tournaments/read.ts"
import {
  admitTemplate,
  approveTemplate,
  assignTemplate,
  boardTemplate,
  drawTemplate,
  foundTemplate,
  phaseTemplate,
  registerTemplate,
  resultTemplate,
} from "../../../../../lib/tournaments/records.ts"

const PARTICIPANTS = 128
const BOARDS = 16
const relayUrl = process.argv.includes("--relay") ? process.argv[process.argv.indexOf("--relay") + 1] : null

const person = () => {
  const secret = generateSecretKey()
  return { secret, pubkey: getPublicKey(secret) }
}
const sign = (who, template) => finalizeEvent(template, who.secret)
const stored = (tournament, events) => ({ id: `tournament:${tournament}`, tournament, events, relays: [], unsent: [], loadedAt: null, seeds: {}, boardKeys: {}, openedAt: null })
const now = () => Math.floor(Date.now() / 1000) + 120
const state = (events, id) => {
  const r = reduceTournament(events, id, { now: now(), dependents: (slot, s) => (bracketOf(s) ? dependentSlots(bracketOf(s), slot) : []) })
  if (!r.state) throw new Error(`no state: ${r.problem}`)
  return r.state
}
const timed = (fn) => {
  const start = performance.now()
  const value = fn()
  return [performance.now() - start, value]
}
const bytes = (events) => events.reduce((n, e) => n + JSON.stringify(e).length, 0)

// ---- Building the tournament's records --------------------------------------------------------

const organizer = person()
const players = Array.from({ length: PARTICIPANTS }, person)
const boards = Array.from({ length: BOARDS }, (_, i) => ({ id: `${i}`.padStart(32, "b"), name: `Board ${i + 1}`, key: person() }))
const seed = createDrawSeed()
const draft = newDraft("load", "Europe/Berlin", Date.now(), { name: "Lasttest 128", capacity: PARTICIPANTS, checkIn: false, approval: "organizer" })
const found = sign(organizer, foundTemplate(foundContent(draft, commitSeed(seed))))
const id = found.id
const events = [found]
let s = state(events, id)
for (const p of players) events.push(sign(p, registerTemplate(s, `Spieler ${p.pubkey.slice(0, 4)}`)))
s = state(events, id)
for (const p of players) events.push(sign(organizer, admitTemplate(s, p.pubkey)))
for (const b of boards) events.push(sign(organizer, boardTemplate(s, b.id, b.name, b.key.pubkey)))
s = state(events, id)
events.push(sign(organizer, drawTemplate(s, seed, drawField(s), [])))
s = state(events, id)
events.push(sign(organizer, phaseTemplate(s, "running")))
const registrationEvents = events.length

// The whole tournament: every match called to a board and its result submitted by the board
// and approved by the organizer (two records per match), 16 boards at a time.
let rounds = 0
let calls = 0
const callTimes = []
const approveTimes = []
for (;;) {
  let read = readTournament(stored(id, events), { pubkey: organizer.pubkey, now: now() })
  const suggestions = suggestBoards(read.view, boards.map((b) => b.id))
  if (suggestions.length === 0) break
  rounds++
  for (const c of suggestions) {
    const [ms] = timed(() => {
      s = state(events, id)
      events.push(sign(organizer, assignTemplate(s, c.match, c.board)))
    })
    callTimes.push(ms)
    calls++
  }
  read = readTournament(stored(id, events), { pubkey: organizer.pubkey, now: now() })
  for (const c of suggestions) {
    const m = read.view.match(c.match)
    const board = boards.find((b) => b.id === c.board)
    s = state(events, id)
    events.push(sign(board.key, resultTemplate(s, c.match, { winner: m.slots[0].participant, score: [3, calls % 3] })))
    const [ms] = timed(() => {
      s = state(events, id)
      const slot = s.slots[c.match]
      events.push(sign(organizer, approveTemplate(s, c.match, slot.submissions.at(-1).event)))
    })
    approveTimes.push(ms)
  }
}
const final = readTournament(stored(id, events), { pubkey: organizer.pubkey, now: now() })
if (!final.view.complete || !final.view.champion) throw new Error("not complete")
events.push(sign(organizer, phaseTemplate(state(events, id), "finished")))

// ---- Reading --------------------------------------------------------------------------------

const q = (list, p) => [...list].sort((a, b) => a - b)[Math.floor(p * (list.length - 1))].toFixed(1)
const [cold] = timed(() => readTournament(stored(id, events), { pubkey: players[0].pubkey, now: now() }))
const warm = Math.min(...[1, 2, 3].map(() => timed(() => readTournament(stored(id, events), { pubkey: players[0].pubkey, now: now() }))[0]))
const [replayOnly] = timed(() => reduceTournament(events, id, { now: now() }))
const [withLive] = timed(() =>
  readTournament(stored(id, events), {
    pubkey: players[0].pubkey,
    now: now(),
    live: boards.map((b, i) => ({ slot: final.view.matches[i].id, match: `${i}`.padStart(64, "0"), by: b.key.pubkey })),
  }),
)

console.log(`Node ${process.version}, ${process.platform} ${process.arch}, Wanduhr`)
console.log(`Teilnehmer ${PARTICIPANTS}, Boards ${BOARDS}, Format ${draft.format}, Spiele ${final.view.matches.length}, Runden mit Aufrufen ${rounds}`)
console.log(`Datensätze: ${events.length} (davon bis zum Start ${registrationEvents}), ${(bytes(events) / 1024).toFixed(0)} kB als JSON`)
console.log(`Lesen (Abspielen + Spielplan): kalt ${cold.toFixed(1)} ms, warm ${warm.toFixed(1)} ms, Abspielen allein ${replayOnly.toFixed(1)} ms, mit 16 Live-Spielen ${withLive.toFixed(1)} ms`)
console.log(`Eine Änderung (Aufruf: Zustand lesen + Datensatz bauen): p50 ${q(callTimes, 0.5)} / p99 ${q(callTimes, 0.99)} / max ${q(callTimes, 1)} ms über ${callTimes.length}`)
console.log(`Eine Freigabe: p50 ${q(approveTimes, 0.5)} / p99 ${q(approveTimes, 0.99)} / max ${q(approveTimes, 1)} ms über ${approveTimes.length}`)

// ---- Relay -----------------------------------------------------------------------------------

if (relayUrl) {
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relayUrl
  const { publish, relayClient } = await import("../../../../../lib/nostr/client.ts")
  const { fetchTournament } = await import("../../../../../lib/tournaments/sync.ts")
  const startedAt = performance.now()
  let ok = 0
  for (const event of events) {
    const results = await publish(event, [relayUrl])
    if (results.some((r) => r.ok)) ok++
  }
  const sendMs = performance.now() - startedAt
  const fetchedAt = performance.now()
  const fetched = await fetchTournament(id, [])
  const fetchMs = performance.now() - fetchedAt
  const [readFetched] = timed(() => readTournament(stored(id, fetched.events), { pubkey: players[0].pubkey, now: now() }))
  console.log(`Relay ${relayUrl}: ${ok} von ${events.length} Datensätzen angenommen in ${sendMs.toFixed(0)} ms (einzeln, nacheinander)`)
  console.log(`Abruf des ganzen Turniers: ${fetched.events.length} Datensätze in ${fetchMs.toFixed(0)} ms, danach lesen ${readFetched.toFixed(1)} ms`)
  relayClient().close()
}
