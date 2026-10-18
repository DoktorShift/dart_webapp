import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { reduceClub } from "../lib/protocol/club-state.ts"
import { reduceMatch } from "../lib/protocol/match-state.ts"
import type { SignedEvent } from "../lib/protocol/tags.ts"
import { reduceTournament } from "../lib/protocol/tournament-state.ts"

// Replay is a function of the set of events: arrival order, duplicates and relays delivering
// different copies must not change the state (docs/protocol/conflicts.md). Checked on every
// vector case with seeded shuffles.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Vector = any
const load = (name: string): Vector => JSON.parse(readFileSync(new URL(`../docs/protocol/vectors/${name}.json`, import.meta.url), "utf8"))

function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// The plaintexts the case's reader can open (tests/protocol-vectors.test.ts checks that the
// reader really opens exactly these); replay itself never decrypts.
const open = (c: Vector) => (c.reader || c.linkKey ? (e: SignedEvent) => (c.reader && !readable(c).has(e.id) ? null : (c.plaintexts[e.id] ?? null)) : undefined)

// Sealed records the reader cannot open stay closed, as in the vector's expectation.
const readable = (c: Vector) => new Set<string>(Object.keys(c.plaintexts).filter((id) => !(c.expect.unapplied ?? []).some((u: { id: string; why: string }) => u.id === id && u.why === "sealed")))

// The rejected and unapplied lists come out in replay order too, so a plain comparison works.
const snapshot = (result: { state: unknown }) => JSON.stringify(result.state)

for (const [family, reduce] of [
  ["club", reduceClub],
  ["tournament", reduceTournament],
  ["match", reduceMatch],
] as const) {
  test(`${family}: any arrival order and duplicates give the same state`, () => {
    const file = load(family)
    for (const c of file.cases) {
      const opts = { now: c.now, open: open(c), ...(c.dependents ? { dependents: (slot: string) => c.dependents[slot] ?? [] } : {}) }
      const reference = snapshot(reduce(c.events, c.root, opts))
      for (let seed = 1; seed <= 12; seed++) {
        assert.equal(snapshot(reduce(shuffled(c.events, seed), c.root, opts)), reference, `${c.name}, shuffle ${seed}`)
      }
      assert.equal(snapshot(reduce([...c.events, ...shuffled(c.events, 99)], c.root, opts)), reference, `${c.name}, every event twice`)
    }
  })
}

test("events of another object are refused as wrong_root", () => {
  const file = load("club")
  const a = file.cases[0]
  const b = file.cases.find((x: Vector) => x.root !== a.root && !x.expect.problem)
  const result = reduceClub([...a.events, ...b.events], a.root, { now: a.now, open: open(a) })
  assert.ok(result.state)
  const own = new Set(a.events.map((e: SignedEvent) => e.id))
  const foreign = new Set(b.events.map((e: SignedEvent) => e.id).filter((id: string) => !own.has(id)))
  const refused = result.state.log.rejected.filter((r) => foreign.has(r.id))
  assert.equal(refused.length, foreign.size)
  assert.ok(refused.every((r) => r.reason === "wrong_root"))
  assert.equal(snapshot({ state: { ...result.state, log: null } }), snapshot({ state: { ...reduceClub(a.events, a.root, { now: a.now, open: open(a) }).state, log: null } }))
})

test("without its founding there is no state, and the reason is told", () => {
  const file = load("club")
  const c = file.cases[0]
  assert.deepEqual(reduceClub(c.events.slice(1), c.root, { now: c.now }), { state: null, problem: "missing" })
  assert.deepEqual(reduceClub(c.events, c.root, { now: c.now }), { state: null, problem: "sealed" })
})
