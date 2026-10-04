import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"

// Interop checks against nak (github.com/fiatjaf/nak), an independent Go implementation:
// signatures and ids of every vector event, NIP-44 decryption of sealed records, and a round
// trip through nak's in-memory relay (only localhost, never a public relay).
//
//   node --test tests/relay/nak.test.ts        (needs nak on PATH or in /opt/homebrew/bin)

const NAK = ["/opt/homebrew/bin/nak", "/usr/local/bin/nak"].find((p) => spawnSync(p, ["--version"]).status === 0) ?? (spawnSync("nak", ["--version"]).status === 0 ? "nak" : null)
const PORT = 10604
const RELAY = `ws://localhost:${PORT}`
const skip = NAK ? false : "nak is not installed"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Vector = any
type Event = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

const load = (name: string): Vector => JSON.parse(readFileSync(new URL(`../../docs/protocol/vectors/${name}.json`, import.meta.url), "utf8"))
const nak = (args: string[], input?: string) => execFileSync(NAK as string, args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 20000 })

function signedEvents(v: unknown, out: Event[] = []): Event[] {
  if (Array.isArray(v)) v.forEach((x) => signedEvents(x, out))
  else if (typeof v === "object" && v !== null) {
    const e = v as Record<string, unknown>
    if (typeof e.sig === "string" && typeof e.id === "string" && Array.isArray(e.tags)) out.push(e as Event)
    else Object.values(e).forEach((x) => signedEvents(x, out))
  }
  return out
}

test("nak verifies id and signature of every vector event", { skip }, () => {
  const seen = new Map<string, Event>()
  for (const name of ["club", "tournament", "match", "badges", "pairing", "board-join", "private-records"]) for (const e of signedEvents(load(name))) seen.set(e.id, e)
  assert.ok(seen.size > 150)
  // One nak run checks a whole batch (one event per line) and prints only failures.
  const lines = [...seen.values()].map((e) => JSON.stringify(e)).join("\n")
  assert.equal(nak(["verify"], `${lines}\n`).trim(), "")
  // Control: a tampered event is reported.
  const [first] = seen.values()
  const run = spawnSync(NAK as string, ["verify"], { input: JSON.stringify({ ...first, content: `${first.content} ` }), encoding: "utf8" })
  assert.notEqual(run.status, 0)
  assert.match(run.stdout + run.stderr, /invalid/)
})

test("nak decrypts sealed club records with the club key to the documented plaintext", { skip }, () => {
  const file = load("club")
  const secret = file.keys.club.secret
  let checked = 0
  // nak starts slowly (seconds per run): the founding and the invite of the first case.
  const c = file.cases[0]
  for (const e of (c.events as Event[]).filter((x) => c.plaintexts[x.id]).slice(0, 2)) {
    assert.equal(nak(["decrypt", "--sec", secret, "-p", e.pubkey, e.content]).trim(), c.plaintexts[e.id])
    checked++
  }
  assert.equal(checked, 2)
})

let relay: ChildProcess | null = null

// A plain NIP-01 client over the platform WebSocket (deliberately neither nostr-core nor nak).
function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error("relay not reachable"))
  })
}

function exchange(ws: WebSocket, message: unknown[], done: (reply: unknown[]) => boolean): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const replies: unknown[][] = []
    const timer = setTimeout(() => reject(new Error(`no answer to ${JSON.stringify(message).slice(0, 80)}`)), 5000)
    ws.onmessage = (m) => {
      const reply = JSON.parse(String(m.data)) as unknown[]
      replies.push(reply)
      if (done(reply)) {
        clearTimeout(timer)
        resolve(replies)
      }
    }
    ws.send(JSON.stringify(message))
  })
}

async function publish(ws: WebSocket, e: Event) {
  const replies = await exchange(ws, ["EVENT", e], (r) => r[0] === "OK" && r[1] === e.id)
  const ok = replies.at(-1) as [string, string, boolean, string]
  assert.ok(ok[2], `relay refused ${e.id}: ${ok[3]}`)
}

let sub = 0
async function query(ws: WebSocket, filter: Record<string, unknown>) {
  const id = `q${++sub}`
  const replies = await exchange(ws, ["REQ", id, filter], (r) => r[0] === "EOSE" && r[1] === id)
  ws.send(JSON.stringify(["CLOSE", id]))
  return replies.filter((r) => r[0] === "EVENT").map((r) => r[2] as Event)
}

before(async () => {
  if (!NAK) return
  relay = spawn(NAK, ["serve", "--port", String(PORT)], { stdio: "ignore" })
  for (let i = 0; i < 100; i++) {
    try {
      ;(await connect()).close()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error("nak serve did not start")
})

after(() => {
  relay?.kill()
})

test("a relay stores records, keeps the newest snapshot per writer and match, and forgets handshakes", { skip }, async () => {
  const ws = await connect()
  try {
    const match = load("match").cases.find((c: Vector) => c.name === "session-handover")
    for (const e of match.events as Event[]) await publish(ws, e)
    const records = await query(ws, { kinds: [1501], "#e": [match.root] })
    assert.deepEqual(new Set(records.map((e) => e.id)), new Set((match.events as Event[]).filter((e) => e.kind === 1501 && e.id !== match.root).map((e) => e.id)))
    // Session 1 published two snapshots (n 1 and 3): only the newer is kept; session 2's stays.
    const snapshots = await query(ws, { kinds: [31501], "#d": [match.root] })
    assert.deepEqual(new Set(snapshots.map((e) => e.id)), new Set([match.labels["live-2"], match.labels["live-old"]]))

    const club = load("club").cases[0]
    for (const e of club.events as Event[]) await publish(ws, e)
    assert.equal((await query(ws, { kinds: [1501], "#e": [club.root], "#l": ["club.join"] })).length, 2)
    assert.equal((await query(ws, { kinds: [1501], "#L": ["blueline"], ids: [club.root] })).length, 1)

    // A handshake reaches only who listens at that moment; with nobody listening the relay
    // answers "mute:" (retry later), and nothing is stored either way (research DR-10).
    const hello: Event = load("pairing").steps.hello.event
    const nobody = await exchange(ws, ["EVENT", hello], (r) => r[0] === "OK" && r[1] === hello.id)
    assert.deepEqual((nobody.at(-1) as unknown[]).slice(2, 3), [false])
    assert.match(String((nobody.at(-1) as unknown[])[3]), /^mute:/)
    const listener = await connect()
    const device = hello.tags.find((t) => t[0] === "p")?.[1]
    await exchange(listener, ["REQ", "pair", { kinds: [21501], "#p": [device] }], (r) => r[0] === "EOSE")
    const delivered = new Promise<Event>((resolve) => {
      listener.onmessage = (m) => {
        const r = JSON.parse(String(m.data))
        if (r[0] === "EVENT") resolve(r[2])
      }
    })
    await publish(ws, hello)
    assert.equal((await delivered).id, hello.id)
    listener.close()
    assert.equal((await query(ws, { kinds: [21501] })).length, 0, "ephemeral handshakes are not stored")

    const priv = load("private-records")
    await publish(ws, priv.events.valid)
    assert.deepEqual(
      (await query(ws, { kinds: [30078], "#d": [priv.records[0].slot] })).map((e) => e.id),
      [priv.events.valid.id],
    )

    const badges = load("badges")
    await publish(ws, badges.cases[0].definition)
    await publish(ws, badges.cases[0].award)
    const recipient = badges.cases[0].award.tags.find((t: string[]) => t[0] === "p")[1]
    assert.equal((await query(ws, { kinds: [8], "#p": [recipient] })).length, 1)
  } finally {
    ws.close()
  }
})
