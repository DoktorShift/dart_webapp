import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { getPublicKey } from "nostr-core"
import { buildRecord } from "../lib/protocol/records.ts"
import type { ContentOf, RecordType } from "../lib/protocol/records.ts"
import type { SignedEvent } from "../lib/protocol/tags.ts"
import { eventHash } from "../lib/protocol/tags.ts"
import { reduceTournament } from "../lib/protocol/tournament-state.ts"

// The hand-over rules (docs/protocol/conflicts.md, "Übergaben") on random histories: offers,
// withdrawals, acceptances and core changes by four keys, mostly in order, some dated back,
// on current or outdated bases. Fixed seed and size, so every run checks the same 200
// histories. Whatever the history, the replay must not depend on arrival order, and the
// organization must pass only through acceptances of the current organizer's offers. Replay
// never checks signatures (lib/nostr does, before parsing), so the events carry real ids and
// a placeholder signature.

const T0 = 1760000000
const secret = (name: string) => createHash("sha256").update(`blueline-handover-test:${name}`).digest()
const PEOPLE = ["organizer", "a", "b", "c"]
const pub = Object.fromEntries(PEOPLE.map((p) => [p, getPublicKey(secret(p))]))
const rules = { type: "x01", modeId: "501", startScore: 501, doubleIn: false, doubleOut: true, cutThroat: false, bullFinish: false, legsToWin: 2, setsToWin: 1, startRule: "alternate" } as const

function signed<T extends RecordType>(who: string, type: T, content: ContentOf<T>, at: number, root?: string): SignedEvent {
  const template = { ...buildRecord(type, content, { created_at: T0 + at, root }), pubkey: pub[who] }
  return { ...template, id: eventHash(template), sig: "0".repeat(128) }
}

const typeOf = (e: SignedEvent) => e.tags.find((t) => t[0] === "l")?.[1]

function history(next: () => number) {
  const pick = <X>(xs: readonly X[]) => xs[Math.floor(next() * xs.length)]
  const found = signed("organizer", "tournament.found", { name: "Cup", engine: 1, format: "single", rules, capacity: 8, admission: "manual", waitlist: false, checkIn: false, approval: "organizer" }, 0)
  const root = found.id
  const events = [found]
  const offers: { id: string; to: string }[] = []
  const chain = [root]
  const cores = [root]
  for (let i = 1; i <= 14; i++) {
    const at = next() < 0.8 ? 10 * i : 1 + Math.floor(next() * 10 * i)
    const who = pick(PEOPLE)
    const base = next() < 0.7 ? chain[chain.length - 1] : pick(chain)
    const core = next() < 0.7 ? cores[cores.length - 1] : pick(cores)
    const k = next()
    let e: SignedEvent
    if (k < 0.3) {
      const to = pick(PEOPLE.filter((p) => p !== who))
      e = signed(who, "tournament.handover.offer", { to: pub[to], prev: base, expires: T0 + at + 1 + Math.floor(next() * 300), core }, at, root)
      offers.push({ id: e.id, to })
      chain.push(e.id)
    } else if (k < 0.45 && offers.length > 0) {
      e = signed(who, "tournament.handover.cancel", { offer: pick(offers).id }, at, root)
      chain.push(e.id)
    } else if (k < 0.75 && offers.length > 0) {
      const offer = pick(offers)
      e = signed(next() < 0.8 ? offer.to : who, "tournament.handover.accept", { offer: offer.id, core }, at, root)
      chain.push(e.id)
    } else {
      e = signed(who, "tournament.update", { prev: core, name: `Cup ${i}` }, at, root)
      cores.push(e.id)
    }
    events.push(e)
  }
  return { root, events }
}

test("hand-overs on 200 random histories: order-independent, and only through the organizer's own offers", () => {
  let seed = 20261005
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
  let handovers = 0
  for (let round = 0; round < 200; round++) {
    const { root, events } = history(next)
    const now = T0 + 100000
    const result = reduceTournament(events, root, { now })
    assert.ok(result.state, `round ${round}`)
    const s = result.state
    const reference = JSON.stringify(s)
    const reversed = [...events].reverse()
    assert.equal(JSON.stringify(reduceTournament(reversed, root, { now }).state), reference, `round ${round}: arrival order`)

    const byId = new Map(events.map((e) => [e.id, e]))
    let organizer = events[0].pubkey
    for (const { id } of s.log.applied.slice(1)) {
      const e = byId.get(id) as SignedEvent
      if (typeOf(e) === "tournament.handover.accept") {
        const offer = byId.get(JSON.parse(e.content).offer) as SignedEvent
        assert.equal(offer.pubkey, organizer, `round ${round}: accepted an offer of someone who did not organize`)
        assert.equal(JSON.parse(offer.content).to, e.pubkey, `round ${round}: accepted by someone else`)
        organizer = e.pubkey
        handovers++
      } else {
        assert.equal(e.pubkey, organizer, `round ${round}: ${typeOf(e)} applied from someone who did not organize`)
      }
    }
    assert.equal(s.organizer, organizer, `round ${round}: organizer`)
  }
  // The histories are not trivial: a good number of hand-overs hold.
  assert.ok(handovers >= 20, `${handovers} hand-overs`)
})
