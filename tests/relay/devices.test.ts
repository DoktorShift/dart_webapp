// Pairing a second device and the device list end to end over a real relay ("nak serve" on
// 127.0.0.1): the device that has the profile runs here, the new device in a worker thread
// with a database of its own (./pairing-device.ts). Nothing touches a public relay.
// Run: npm run test:relay
import { after, before, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { Worker } from "node:worker_threads"
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { ANNA, resetStorage } from "../storage-helpers.ts"
import { newDevice, switchTo } from "../support/devices.ts"
import { freePort, startRelay, type NakRelay } from "../support/nak.ts"
import type { AddDeviceControl, AddDevicePairing, NewDevicePairing } from "../../lib/devices/pairing.ts"
import { relayClient, subscribe } from "../../lib/nostr/client.ts"
import { nowSeconds } from "../../lib/nostr/time.ts"
import type { NostrEvent } from "../../lib/nostr/types.ts"
import { newRelayList, relayListTemplate } from "../../lib/profile/relay-list.ts"
import { getSigner, importLocalKey, signOut } from "../../lib/profile/session.ts"
import { rememberOwn } from "../../lib/profile/own-events.ts"
import { MAX_HANDSHAKE_SECONDS } from "../../lib/protocol/kinds.ts"
import { decodePairingCode, decodePairingLink, newPairingSecret, pairingTemplate } from "../../lib/protocol/pairing.ts"
import { dbGetAll } from "../../lib/storage/db.ts"
import { randomHex } from "../../lib/storage/ids.ts"
import { newPlayerRecord, savePlayers } from "../../lib/storage/players.ts"
import { syncHistory } from "../../lib/sync/engine.ts"
import { deliverNow, outboxStatus } from "../../lib/sync/outbox.ts"

let relay: NakRelay
let pairing: typeof import("../../lib/devices/pairing.ts")
let list: typeof import("../../lib/devices/list.ts")
let signers: typeof import("../../lib/nostr/signers.ts")

before(async () => {
  relay = await startRelay()
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  ;[pairing, list, signers] = await Promise.all([import("../../lib/devices/pairing.ts"), import("../../lib/devices/list.ts"), import("../../lib/nostr/signers.ts")])
})

const opened: (() => unknown)[] = []
const keep = <T extends { close: () => unknown }>(handle: T) => {
  opened.push(() => handle.close())
  return handle
}

beforeEach(async () => {
  for (const close of opened.splice(0)) await close()
  await signOut({ keepLocalData: true })
  await resetStorage()
})

after(async () => {
  for (const close of opened) await close()
  await signOut({ keepLocalData: true })
  relayClient().close()
  await relay?.stop()
})

async function until<T>(what: string, check: () => T | null | undefined | false | Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The profile on this device: a local key and a relay list, so the package has events to carry.
async function profileHere() {
  const secret = randomBytes(32)
  const session = await importLocalKey(secret)
  const signer = await getSigner()
  await rememberOwn(session.pubkey, [await signer.signEvent(relayListTemplate(newRelayList()))])
  return { secret, pubkey: session.pubkey }
}

// The new device, in its thread.
interface NewDevice {
  states: NewDevicePairing[]
  // Whether its last message reached no relay.
  offline: () => boolean
  latest: () => NewDevicePairing | undefined
  send: (command: { type: "start" | "confirm" | "decline" | "reload" | "close" | "sync" }) => void
  session: () => Promise<{ pubkey: string; kind: string } | null>
  // The ids in its "pending" store: the pairing's one-time keys, while it has them.
  pending: () => Promise<string[]>
  close: () => Promise<number>
}

// `stall`: it takes the package but never gets done with it (closed meanwhile).
async function newDeviceThread(relayUrl = relay.url, options: { stall?: boolean } = {}): Promise<NewDevice> {
  const worker = new Worker(new URL("./pairing-device.ts", import.meta.url), { workerData: { relay: relayUrl, ...options } })
  const states: NewDevicePairing[] = []
  let ready = false
  let offline = false
  const answers = new Map<string, (value: unknown) => void>()
  worker.on("message", (m: { type: string; state?: NewDevicePairing; offline?: boolean; session?: unknown; ids?: unknown }) => {
    if (m.type === "ready") ready = true
    else if (m.type === "state" && m.state) {
      states.push(m.state)
      offline = m.offline === true
    }
    else answers.get(m.type)?.(m.type === "session" ? (m.session ?? null) : m.ids)
  })
  const ask = <T>(type: "session" | "pending") =>
    new Promise<T>((resolve) => {
      answers.set(type, resolve as (value: unknown) => void)
      worker.postMessage({ type })
    })
  const device: NewDevice = {
    states,
    offline: () => offline,
    latest: () => states[states.length - 1],
    send: (command) => worker.postMessage(command),
    session: () => ask("session"),
    pending: () => ask("pending"),
    close: () => worker.terminate(),
  }
  keep(device)
  await until("the new device", () => ready)
  return device
}

const step = <S extends NewDevicePairing["step"]>(device: NewDevice, s: S) => until(`the new device at "${s}"`, () => device.states.find((x): x is Extract<NewDevicePairing, { step: S }> => x.step === s))
const latestStep = <S extends NewDevicePairing["step"]>(device: NewDevice, s: S) => until(`the new device now at "${s}"`, () => (device.latest()?.step === s ? (device.latest() as Extract<NewDevicePairing, { step: S }>) : null))

// The existing device's side, with its states.
function existing() {
  const states: AddDevicePairing[] = []
  let control: AddDeviceControl | null = null
  const here = {
    states,
    latest: () => states[states.length - 1],
    at: <S extends AddDevicePairing["step"]>(s: S, ms?: number) => until(`this device at "${s}"`, () => (here.latest()?.step === s ? (here.latest() as Extract<AddDevicePairing, { step: S }>) : null), ms),
    // A state that may already have passed (the transfer takes a moment at most).
    saw: <S extends AddDevicePairing["step"]>(s: S) => until(`this device at "${s}"`, () => states.find((x): x is Extract<AddDevicePairing, { step: S }> => x.step === s)),
    start: async (input: Parameters<typeof pairing.addDevice>[0]) => {
      control = await pairing.addDevice(input, (next) => states.push(next))
      return control
    },
    resume: async () => {
      control = await pairing.resumeAddDevice((next) => states.push(next))
      return control
    },
    control: () => control!,
    close: () => control?.close(),
  }
  keep(here)
  return here
}

// What the relay carries during a pairing, as anyone can see it.
function spy() {
  const seen: NostrEvent[] = []
  keep(subscribe([{ kinds: [21180] }], [relay.url], { onevent: (event) => seen.push(event) }))
  return seen
}

test("QR path: both devices show the same check code, both confirm, the profile arrives with its data key and relay list, and the one-time keys go", async () => {
  const { secret, pubkey } = await profileHere()
  const seen = spy()
  const device = await newDeviceThread()
  device.send({ type: "start" })
  const waiting = await step(device, "waiting")
  assert.match(waiting.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  assert.ok(waiting.expires <= nowSeconds() + MAX_HANDSHAKE_SECONDS)

  // The person scans the new device's code here (the link's payload), on "Eigenes Gerät hinzufügen".
  const here = existing()
  await here.start({ link: decodePairingLink(waiting.link) })
  const found = await here.at("found")
  const there = await step(device, "found")
  assert.equal(found.checkCode, there.checkCode)
  assert.match(found.checkCode, /^\d{4} \d{4}$/)
  assert.equal(there.device, "Computer")

  // Confirmed on the new device first: this device learns its name and still waits for the tap here.
  device.send({ type: "confirm" })
  await step(device, "confirming")
  const named = await until("the new device's name here", () => {
    const latest = here.latest()
    return latest?.step === "found" && latest.device === "Computer" ? latest : null
  })
  assert.equal(named.step, "found")
  await pause(1000)
  assert.ok(!device.states.some((s) => s.step === "receiving" || s.step === "done"), "nothing moves before the tap here")

  here.control().give()
  await here.saw("sending")
  const done = await step(device, "done")
  assert.equal(done.applied.access, "local")
  assert.equal(done.applied.access === "local" && done.applied.session.pubkey, pubkey)
  await here.at("done")
  const session = await device.session()
  assert.equal(session?.pubkey, pubkey)
  assert.equal(session?.kind, "local")

  // The secret never crossed the relay in the clear; every message was encrypted to a one-time key.
  await pause(500)
  const everything = JSON.stringify(seen)
  assert.ok(seen.length >= 4)
  assert.ok(!everything.includes(bytesToHex(secret)))
  assert.ok(!everything.includes(pubkey), "not even the profile's public key")
  // This side forgot the pairing (one-time keys and all); the new device does once its screen
  // closes, having answered the package's repeats until then.
  assert.deepEqual((await dbGetAll("pending")).filter((r) => r.id.startsWith("pairing:")), [])
  assert.equal((await device.pending()).length, 1)
  device.send({ type: "close" })
  await until("the new device's keys gone", async () => (await device.pending()).length === 0)
})

// What an outsider who reads the relay can send to the new device: a message from a key of
// their own, encrypted to the one-time key the announce names.
async function fromOutsider(to: string, message: Parameters<typeof pairingTemplate>[0]["message"]) {
  const outsider = await signers.newLocalKey()
  const ciphertext = await outsider.signer.nip44!.encrypt(to, JSON.stringify(message))
  await relayClient().publish(await outsider.signer.signEvent(pairingTemplate({ message, created_at: nowSeconds(), recipient: to, ciphertext })), [relay.url])
}

test("code path: the typed code finds the new device; an outsider who reads the announce can neither answer it, nor end it, nor pass for it", async () => {
  const { pubkey } = await profileHere()
  const device = await newDeviceThread()
  device.send({ type: "start" })
  const waiting = await step(device, "waiting")

  // The announce is plaintext on the relay: an outsider learns the session id and the key. A
  // hello without the code's MAC, and an abort, are both ignored: the new device waits on.
  const announce = await until("the announce on the relay", async () => {
    const seen = spy()
    await pause(300)
    return seen.find((e) => e.tags.some((t) => t[0] === "x"))
  })
  const { sid } = JSON.parse(announce.content)
  await fromOutsider(announce.pubkey, { t: "hello", sid, device: "Angreifer" })
  await fromOutsider(announce.pubkey, { t: "abort", sid, reason: "declined" })
  await pause(1500)
  assert.deepEqual(device.states.map((s) => s.step), ["waiting"])

  // The existing device looks under the code's lookup tag; an announce there without the code's
  // MAC (anyone can copy the tag from the real one) is passed over.
  const here = existing()
  await here.start({ code: decodePairingCode(waiting.code)! })
  await here.at("looking")
  const lookup = announce.tags.find((t) => t[0] === "x")![1]
  const outsider = await signers.newLocalKey()
  const fake = { t: "announce" as const, sid: randomHex(16), exp: nowSeconds() + 300, mac: "00".repeat(32) }
  await relayClient().publish(await outsider.signer.signEvent(pairingTemplate({ message: fake, created_at: nowSeconds(), lookup })), [relay.url])
  const found = await here.at("found")
  const there = await step(device, "found")
  assert.equal(found.checkCode, there.checkCode, "the existing device answered the real new device")
  assert.notEqual(found.checkCode.replace(" ", ""), waiting.code.replace(/-/g, ""), "the check code is never the typed code")
  here.control().give()
  await here.at("confirmed")
  device.send({ type: "confirm" })
  const done = await step(device, "done")
  assert.equal(done.applied.access === "local" && done.applied.session.pubkey, pubkey)
  await here.at("done")
})

test("a link opened from outside sends nothing until it is answered, with the check code shown before", async () => {
  await profileHere()
  const device = await newDeviceThread()
  device.send({ type: "start" })
  const waiting = await step(device, "waiting")

  const held = await pairing.holdLink(decodePairingLink(waiting.link))
  await pause(1500)
  assert.deepEqual(device.states.map((s) => s.step), ["waiting"], "the new device heard nothing")
  assert.deepEqual((await dbGetAll("pending")).filter((r) => r.id.startsWith("pairing:")), [], "nothing kept either")

  const states: AddDevicePairing[] = []
  keep(await held.answer((next) => states.push(next)))
  const there = await step(device, "found")
  assert.equal(there.checkCode, held.checkCode, "the check code shown before the tap is the one the new device shows")
  await until("found here", () => states.find((s) => s.step === "found"))

  // A link that ran out is refused before anything else.
  await assert.rejects(pairing.holdLink({ ...decodePairingLink(waiting.link), expires: nowSeconds() - 1 }), /expiry/)
})

test("without a relay to reach, the new device says so while it keeps trying", async () => {
  const dead = `ws://127.0.0.1:${await freePort()}`
  const device = await newDeviceThread(dead)
  device.send({ type: "start" })
  await step(device, "waiting")
  await until("offline", () => device.offline())
  assert.equal(device.latest()?.step, "waiting")
})

test("a check code that doesn't match: declining on either side ends the pairing on both", async () => {
  await profileHere()
  const device = await newDeviceThread()
  device.send({ type: "start" })
  const waiting = await step(device, "waiting")
  const here = existing()
  await here.start({ link: decodePairingLink(waiting.link) })
  await step(device, "found")
  device.send({ type: "decline" })
  await latestStep(device, "declined")
  await here.at("declined")
  assert.equal(await device.session(), null)

  // The other way round, with fresh codes.
  device.send({ type: "reload" })
  const again = await until("fresh codes", () => {
    const w = device.latest()
    return w?.step === "waiting" && w.link !== waiting.link ? w : null
  })
  const second = existing()
  await second.start({ link: decodePairingLink(again.link) })
  await second.at("found")
  await latestStep(device, "found")
  device.send({ type: "confirm" })
  await latestStep(device, "confirming")
  second.control().decline()
  await latestStep(device, "declined")
  assert.equal(await device.session(), null)
})

test("an expired code is refused; messages replayed to the new device on a fresh subscription change nothing there", async () => {
  const { pubkey } = await profileHere()
  const seen = spy()
  const device = await newDeviceThread()
  device.send({ type: "start" })
  const waiting = await step(device, "waiting")
  const link = decodePairingLink(waiting.link)

  // A screenshot of yesterday's code.
  await assert.rejects(pairing.addDevice({ link: { ...link, expires: nowSeconds() - 1 } }, () => {}), /expiry/)
  // A code claiming to last longer than a pairing may.
  await assert.rejects(pairing.addDevice({ link: { ...link, expires: nowSeconds() + MAX_HANDSHAKE_SECONDS * 2 } }, () => {}), /expiry/)

  const here = existing()
  await here.start({ link })
  await here.at("found")
  await step(device, "found")
  device.send({ type: "confirm" })
  await step(device, "confirming")
  await until("the new device's name here", () => {
    const latest = here.latest()
    return latest?.step === "found" && latest.device ? latest : null
  })

  // The new device reloads: the same one-time key on a new subscription, which hasn't seen any
  // event yet (a subscription drops one it has seen). Everything this device sent it so far,
  // played to it again, reaches the pairing itself, and changes nothing there: no step back to
  // "found", no profile before this device gives it.
  device.send({ type: "reload" })
  await until("confirming again", () => device.states.filter((s) => s.step === "confirming").length >= 2)
  const steps = device.states.length
  const captured = seen.filter((event) => event.tags.some((t) => t[0] === "p" && t[1] === link.pubkey))
  assert.ok(captured.length > 0, "this device's messages were captured")
  for (const event of captured) await relayClient().publish(event, [relay.url])
  await pause(2000)
  assert.deepEqual(device.states.slice(steps).map((s) => s.step), [], "no step again")
  assert.equal(await device.session(), null)

  here.control().give()
  const done = await step(device, "done")
  assert.equal(done.applied.access === "local" && done.applied.session.pubkey, pubkey)
  await here.at("done")
})

test("a reload on either side resumes the pairing where it was", async () => {
  const { pubkey } = await profileHere()
  const device = await newDeviceThread()
  device.send({ type: "start" })
  const waiting = await step(device, "waiting")

  // The new device reloads while waiting: the same codes come back.
  device.send({ type: "reload" })
  await until("the same codes", () => device.states.filter((s) => s.step === "waiting").length === 2)
  const same = device.latest()
  assert.equal(same?.step === "waiting" && same.link, waiting.link)

  // This device reloads after "Zugriff geben", before the new device confirmed: the resumed
  // pairing waits on, under the same check code.
  const here = existing()
  await here.start({ link: decodePairingLink(waiting.link) })
  const found = await here.at("found")
  here.control().give()
  await here.at("confirmed")
  here.close()
  const resumed = existing()
  assert.ok(await resumed.resume(), "the pairing was still stored")
  const again = await resumed.at("confirmed")
  assert.equal(again.checkCode, found.checkCode)

  // The new device reloads once found: still found, under the same check code; then confirms.
  const there = await step(device, "found")
  assert.equal(there.checkCode, found.checkCode)
  device.send({ type: "reload" })
  const back = await until("found again", () => {
    const latest = device.latest()
    return device.states.filter((s) => s.step === "found").length >= 2 && latest?.step === "found" ? latest : null
  })
  assert.equal(back.checkCode, found.checkCode)
  device.send({ type: "confirm" })
  const done = await step(device, "done")
  assert.equal(done.applied.access === "local" && done.applied.session.pubkey, pubkey)
  await resumed.at("done")
  assert.equal(await pairing.resumeAddDevice(() => {}), null, "nothing left to resume")
})

// Both devices at "found", the new one confirmed there, and this device knows its name.
async function bothConfirmedThere(options: { stall?: boolean } = {}) {
  await profileHere()
  const device = await newDeviceThread(relay.url, options)
  device.send({ type: "start" })
  const link = decodePairingLink((await step(device, "waiting")).link)
  const here = existing()
  await here.start({ link })
  await here.at("found")
  await step(device, "found")
  device.send({ type: "confirm" })
  await step(device, "confirming")
  await until("the new device's name here", () => {
    const latest = here.latest()
    return latest?.step === "found" && latest.device ? latest : null
  })
  return { device, here, newKey: link.pubkey }
}

// How many of the events seen went to `key`.
const sentTo = (seen: readonly NostrEvent[], key: string) => seen.filter((event) => event.tags.some((t) => t[0] === "p" && t[1] === key)).length

test("closing while the profile goes out, also right after a resume, stops sending: nothing more goes out", async () => {
  const seen = spy()
  const { device, here, newKey } = await bothConfirmedThere()
  // The new device goes away (phone locked, tab killed) right after confirming.
  await device.close()
  here.control().give()
  await here.at("sending")
  await pause(500)
  here.close()
  // The screen opens again, resumes the transfer, and is left at once, while the package is
  // still being made.
  ;(await pairing.resumeAddDevice(() => {}))!.close()
  await pause(1000)
  const before = sentTo(seen, newKey)
  await pause(7000)
  assert.equal(sentTo(seen, newKey) - before, 0, "nothing goes out after both screens closed")
})

test("a new device that went away: no relay answer counts as arrived, and Abbrechen leaves nothing to resume", async () => {
  const { device, here } = await bothConfirmedThere()
  await device.close()
  here.control().give()
  await here.at("sending")
  // Nobody listens on the new device's key any more, and the relay says so ("mute:"): that is no
  // delivery, however soon after the new device's last word it came. After a while this device
  // says the new device doesn't answer, and never that the profile probably arrived.
  const unanswered = await until("no answer", () => here.states.find((s) => s.step === "sending" && s.unanswered))
  assert.ok(unanswered)
  await pause(18_000)
  assert.ok(!here.states.some((s) => s.step === "sent"), "not 'Wahrscheinlich angekommen'")
  assert.deepEqual(here.latest(), { step: "sending", unanswered: true })

  here.control().decline()
  await here.at("declined")
  here.close()
  assert.equal(await pairing.resumeAddDevice(() => {}), null, "nothing left to resume")
})

test("the package arrived but no acknowledgement came: 'probably arrived' once the new device stopped asking for it, and leaving that ends the pairing", async () => {
  const seen = spy()
  const { device, here, newKey } = await bothConfirmedThere({ stall: true })
  here.control().give()
  await step(device, "receiving")
  await here.at("sent", 45_000)
  // Sending goes on while it shows, so a late acknowledgement still makes it "done"; "Fertig"
  // (the screen closes) ends it.
  here.close()
  await pause(1000)
  const before = sentTo(seen, newKey)
  await pause(4000)
  assert.equal(sentTo(seen, newKey) - before, 0, "nothing goes out after Fertig")
  assert.equal(await pairing.resumeAddDevice(() => {}), null, "nothing left to resume")
})

test("looking for a typed code without a relay to reach: says so, and stops saying so once the relay is back", async () => {
  await profileHere()
  const port = await freePort()
  const states: { step: string; unanswered?: boolean; offline: boolean }[] = []
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `ws://127.0.0.1:${port}`
  try {
    keep(await pairing.addDevice({ code: newPairingSecret() }, (state, offline) => states.push({ ...state, offline })))
  } finally {
    process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  }
  await until("offline", () => states.at(-1)?.offline, 15_000)
  const late = await startRelay({ port })
  try {
    await until("online again", () => states.at(-1)?.offline === false, 15_000)
    assert.equal(states.at(-1)?.step, "looking")
  } finally {
    await late.stop()
  }
})

test("the new device lists itself after its first sync, under the id this device names it by until then", async () => {
  const secret = randomBytes(32)
  const { pubkey } = await importLocalKey(secret)
  // A profile that synced once has its data key, which the package takes along.
  await savePlayers([{ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey }])
  assert.equal((await syncHistory(pubkey, { full: true }))?.state, "complete")
  await deliverNow((await outboxStatus()).map((s) => s.id))
  await list.addThisDevice(pubkey, "iPhone · Safari")

  const device = await newDeviceThread()
  device.send({ type: "start" })
  const here = existing()
  await here.start({ link: decodePairingLink((await step(device, "waiting")).link) })
  await here.at("found")
  await step(device, "found")
  device.send({ type: "confirm" })
  here.control().give()
  await step(device, "done")
  await here.at("done")
  const arriving = (await list.loadDeviceList(pubkey)).arriving
  assert.equal(arriving.length, 1)
  assert.equal(arriving[0].name, "Computer")

  // The screen there closes at once; once the device synced, it lists itself all the same.
  device.send({ type: "close" })
  device.send({ type: "sync" })
  const listed = await until("the new device's own entry", async () => {
    const current = await list.loadDeviceList(pubkey)
    return current.entries.length === 2 ? current : null
  })
  assert.deepEqual(listed.arriving, [], "no longer on its way")
  assert.deepEqual(listed.entries.map((d) => [d.id === listed.thisDevice, d.name]), [[true, "iPhone · Safari"], [false, "Computer"]])
  assert.equal(listed.entries[1].id, arriving[0].id, "under the id it was named by")
})

test("the device list: each device writes itself in; renaming and removing from another device show up", async () => {
  const secret = randomBytes(32)
  const first = newDevice()
  const second = newDevice()
  const send = async () => deliverNow((await outboxStatus()).map((s) => s.id))

  await switchTo(first)
  const session = await importLocalKey(secret)
  const { pubkey } = session
  // The first sync that writes (here: the profile's player) makes the profile's data key; the
  // list hangs off it.
  await savePlayers([{ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey }])
  assert.equal((await syncHistory(pubkey, { full: true }))?.state, "complete")
  await send()
  await list.addThisDevice(pubkey, "iPhone · Safari")
  const mine = await list.loadDeviceList(pubkey)
  assert.equal(mine.state, "complete")
  assert.deepEqual(mine.entries.map((d) => [d.id === mine.thisDevice, d.name]), [[true, "iPhone · Safari"]])

  await switchTo(second)
  await importLocalKey(secret)
  assert.equal((await syncHistory(pubkey, { full: true }))?.state, "complete")
  await list.addThisDevice(pubkey, "iPad · Safari")
  const theirs = await list.loadDeviceList(pubkey)
  assert.deepEqual(theirs.entries.map((d) => d.name), ["iPhone · Safari", "iPad · Safari"])
  const iphone = theirs.entries.find((d) => d.id !== theirs.thisDevice)!
  await list.renameDevice(pubkey, iphone.id, "Mias iPhone")
  await list.removeDevice(pubkey, theirs.thisDevice)

  await switchTo(first)
  await importLocalKey(secret)
  const back = await list.loadDeviceList(pubkey)
  assert.deepEqual(back.entries.map((d) => [d.id === back.thisDevice, d.name]), [[true, "Mias iPhone"]])
  // Removed elsewhere, the iPad doesn't put itself back when its list opens.
  await switchTo(second)
  await importLocalKey(secret)
  await list.addThisDevice(pubkey, "iPad · Safari")
  assert.deepEqual((await list.loadDeviceList(pubkey)).entries.map((d) => d.name), ["Mias iPhone"])
})

// Two devices of one profile, each in the list, as in the test above.
async function twoListedDevices() {
  const secret = randomBytes(32)
  const first = newDevice()
  const second = newDevice()
  await switchTo(first)
  const { pubkey } = await importLocalKey(secret)
  await savePlayers([{ ...newPlayerRecord("Anna", "2026-09-01T10:00:00.000Z", ANNA), pubkey }])
  assert.equal((await syncHistory(pubkey, { full: true }))?.state, "complete")
  await deliverNow((await outboxStatus()).map((s) => s.id))
  await list.addThisDevice(pubkey, "iPhone · Safari")
  await switchTo(second)
  await importLocalKey(secret)
  assert.equal((await syncHistory(pubkey, { full: true }))?.state, "complete")
  return { secret, pubkey, first, second }
}

test("the device list: a change made on a stale copy keeps the device added elsewhere", async () => {
  const { secret, pubkey, first } = await twoListedDevices()
  await list.addThisDevice(pubkey, "iPad · Safari")
  // The first device hasn't opened Profil › Geräte since; its copy has only itself. Saving a
  // backup file there notes it in the list.
  await pause(1100)
  await switchTo(first)
  await importLocalKey(secret)
  await list.noteBackupFile(pubkey)
  const fresh = newDevice()
  await switchTo(fresh)
  await importLocalKey(secret)
  await syncHistory(pubkey, { full: true })
  assert.deepEqual((await list.loadDeviceList(pubkey)).entries.map((d) => d.name), ["iPhone · Safari", "iPad · Safari"])
})

test("the device list: a device that reaches no relay writes nothing, and puts itself in once it does", async () => {
  const { pubkey } = await twoListedDevices()
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `ws://127.0.0.1:${await freePort()}`
  try {
    await assert.rejects(list.addThisDevice(pubkey, "iPad · Safari"), (e: unknown) => e instanceof list.DeviceListError && e.problem === "offline")
    assert.deepEqual(await outboxStatus(), [], "no list of this device alone is waiting to go out")
    const offline = await list.loadDeviceList(pubkey)
    assert.equal(offline.state, "unavailable")
  } finally {
    process.env.NEXT_PUBLIC_BLUELINE_RELAYS = relay.url
  }
  await list.addThisDevice(pubkey, "iPad · Safari")
  assert.deepEqual((await list.loadDeviceList(pubkey)).entries.map((d) => d.name), ["iPhone · Safari", "iPad · Safari"])
})
