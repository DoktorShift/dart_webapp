import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { openChannel, repeat, type ChannelFlow } from "../nostr/channel.ts"
import { publish, subscribe } from "../nostr/client.ts"
import { generalRelays } from "../nostr/relays.ts"
import { localKeyOf, newLocalKey } from "../nostr/signers.ts"
import { nowSeconds } from "../nostr/time.ts"
import { getSession, SessionError } from "../profile/session.ts"
import { openSecret, sealSecret, type SealedSecret } from "../profile/vault.ts"
import { KIND_EPHEMERAL, MAX_HANDSHAKE_SECONDS } from "../protocol/kinds.ts"
import { MAX_LINK_RELAYS } from "../protocol/links.ts"
import {
  announceMac,
  applyPairingMessage,
  checkAnnounce,
  confirmPairingHere,
  encodePairingCode,
  encodePairingLink,
  helloMac,
  MAX_PACKAGE_BYTES,
  newPairingSecret,
  newPairingSession,
  packageHash,
  packageSent,
  pairingCheckCode,
  pairingCodeKeys,
  pairingPlaintext,
  pairingTemplate,
  parsePairingEvent,
  type PairingLink,
  type PairingMessage,
  type PairingSession,
} from "../protocol/pairing.ts"
import { utf8Length } from "../protocol/schema.ts"
import { applyProfilePackage, buildProfilePackage, parseProfilePackage, type Applied } from "../recovery/package.ts"
import { dbDelete, dbGetAll, dbPut, type Keyed } from "../storage/db.ts"
import { randomHex } from "../storage/ids.ts"
import { deviceName } from "./device-name.ts"
import { PAIRING_PENDING_PREFIX } from "./storage-keys.ts"

// "Eigenes Gerät hinzufügen" (docs/protocol/families/pairing.md, decision 0002 §7): the new
// device shows a code to scan (and a link, and a code to type), the device that has the
// profile answers it, both show the same check code, each person confirms on their device, and
// only then does the profile package travel, encrypted between the two one-time keys. The new
// device acknowledges the package it took; only that makes it "done" on both sides.
//
// The messages are the protocol's (lib/protocol/pairing.ts keeps the state machine); this
// module runs it: the one-time keys and the state sit in the "pending" store, sealed like every
// other key (lib/profile/vault.ts), so a reload resumes the same pairing. Every message is
// repeated until answered (lib/nostr/channel.ts), up to the session's expiry; one-time keys go
// when the pairing ends or runs out.

const PAIRING_FLOW: ChannelFlow<PairingMessage> = {
  kind: KIND_EPHEMERAL,
  plaintext: pairingPlaintext,
  template: ({ message, recipient, ciphertext, created_at }) => pairingTemplate({ message, recipient, ciphertext, created_at }),
  parse: parsePairingEvent,
}

// Where the messages travel: the first general relays, as many as the link can name.
const pairingRelays = () => generalRelays().slice(0, MAX_LINK_RELAYS)

// How long a device waits after confirming before it says the other one hasn't answered: the
// person there has to compare the code and tap.
const UNANSWERED_MS = 20_000
// The package fits the message schema with room for the message's own fields.
const PACKAGE_BUDGET = MAX_PACKAGE_BYTES - 200

// ---- Storage ----------------------------------------------------------------------------------

const ID_PREFIX = PAIRING_PENDING_PREFIX

interface Secrets {
  key: string
  // The new device's typed code (its 60-bit secret).
  code?: string
}

interface StoredPairing extends Keyed {
  role: "new" | "existing"
  relays: string[]
  // Secrets as JSON, sealed with the device's vault key.
  secrets: SealedSecret
  // The new device keeps two doors open (the QR link and the typed code) until one is answered;
  // then only that one. The existing device has one session, or none yet while it looks for the
  // announce of a typed code.
  sessions: PairingSession[]
  // What the other device calls itself, once it said.
  peer: string | null
  expires: number
  // Existing device: the profile being sent.
  pubkey?: string
}

const stored = async () => (await dbGetAll<StoredPairing>("pending")).filter((r) => r.id.startsWith(ID_PREFIX))
const keep = (record: StoredPairing) => dbPut("pending", record)
const drop = (id: string) => dbDelete("pending", id)
const sealSecrets = (secrets: Secrets) => sealSecret(new TextEncoder().encode(JSON.stringify(secrets)), "pairing")
const openSecrets = async (sealed: SealedSecret): Promise<Secrets> => JSON.parse(new TextDecoder().decode(await openSecret(sealed, "pairing")))

// Pairings that ran out go, one-time keys and all: at start (components/devices/register.ts)
// and before every resume.
export async function purgeExpiredPairings(now = nowSeconds()) {
  for (const record of await stored()) if (record.expires <= now) await drop(record.id)
}

// A timer until the session runs out.
const untilExpiry = (expires: number, then: () => void) => setTimeout(then, Math.max(0, expires - nowSeconds()) * 1000)

// ---- The new device ---------------------------------------------------------------------------

export type NewDevicePairing =
  // The code to scan (an app link), the code to type, and until when they are good.
  | { step: "waiting"; link: string; code: string; expires: number }
  // The other device answered: compare the check code, then confirm or decline here.
  | { step: "found"; checkCode: string; device: string }
  // Confirmed here; the person at the other device confirms too. `unanswered`: nothing came
  // back within UNANSWERED_MS; the pairing stays open all the same.
  | { step: "confirming"; checkCode: string; device: string; unanswered: boolean }
  | { step: "receiving" }
  | { step: "done"; applied: Applied }
  | { step: "declined" }
  | { step: "expired" }
  // "occupied": another profile signed in on this device meanwhile. "invalid": the package
  // couldn't be taken (another version of the app, damaged on the way).
  | { step: "failed"; reason: "occupied" | "invalid" }

export interface NewDeviceControl {
  // The check code here is the one the other device shows.
  confirm: () => void
  // It isn't, or the person changed their mind: the other device hears so.
  decline: () => void
  close: () => void
}

async function newRecord(): Promise<StoredPairing> {
  const key = await newLocalKey()
  const code = newPairingSecret()
  const now = nowSeconds()
  const expires = now + MAX_HANDSHAKE_SECONDS
  const sessions = [
    newPairingSession({ role: "new", sid: randomHex(16), self: key.pubkey, expires, now }),
    newPairingSession({ role: "new", sid: randomHex(16), self: key.pubkey, expires, now, auth: pairingCodeKeys(code).auth }),
  ]
  const record: StoredPairing = {
    id: `${ID_PREFIX}${sessions[0].sid}`,
    role: "new",
    relays: pairingRelays(),
    secrets: await sealSecrets({ key: bytesToHex(key.secret), code: bytesToHex(code) }),
    sessions,
    peer: null,
    expires,
  }
  await keep(record)
  return record
}

// Shows this device's codes and takes the profile that answers them. A pairing still open from
// before the reload goes on where it was; otherwise a fresh one starts. `apply` stands in for
// applyProfilePackage in the tests.
export async function pairNewDevice(onChange: (state: NewDevicePairing) => void, options: { apply?: typeof applyProfilePackage } = {}): Promise<NewDeviceControl> {
  await purgeExpiredPairings()
  const record = (await stored()).find((r) => r.role === "new") ?? (await newRecord())
  const secrets = await openSecrets(record.secrets)
  const key = await localKeyOf(hexToBytes(secrets.key))
  const { lookup, auth } = pairingCodeKeys(hexToBytes(secrets.code!))
  const apply = options.apply ?? applyProfilePackage
  // The code's door, as long as both are open.
  const codeSession = () => record.sessions.find((s) => s.auth)
  const chosen = () => (record.sessions.length === 1 ? record.sessions[0] : null)

  let closed = false
  let finished = false
  let stopAnnouncing: (() => void) | null = null
  let stopAccepting: (() => void) | null = null
  let unanswered: ReturnType<typeof setTimeout> | undefined
  let applied: Applied | null = null
  let applying: Promise<void> | null = null

  const set = (state: NewDevicePairing) => {
    if (!closed) onChange(state)
  }
  const stopAll = () => {
    stopAnnouncing?.()
    stopAnnouncing = null
    stopAccepting?.()
    stopAccepting = null
    clearTimeout(unanswered)
  }
  // Every end but "done" forgets the pairing at once; "done" keeps answering the other device's
  // repeats until the screen closes.
  const end = async (state: Exclude<NewDevicePairing, { step: "done" }>) => {
    finished = true
    stopAll()
    clearTimeout(expiry)
    await drop(record.id)
    set(state)
  }
  const expiry = untilExpiry(record.expires, () => void end({ step: "expired" }))

  const channel = openChannel(PAIRING_FLOW, key, record.relays, (message, from) => void handle(message, from))
  const checkCodeOf = (s: PairingSession) => pairingCheckCode(key.pubkey, s.peer!, s.sid)
  const ack = (to: string, s: PairingSession) => channel.send(to, { t: "ack", sid: s.sid, hash: s.packageHash! }).catch(() => {})
  const abort = (to: string, s: PairingSession, reason: "declined" | "error") => channel.send(to, { t: "abort", sid: s.sid, reason }).catch(() => {})

  // The announce of the typed code, plaintext under the code's lookup tag.
  const announce = async () => {
    const s = codeSession()
    if (!s) return
    const message: PairingMessage = { t: "announce", sid: s.sid, exp: s.expires, mac: announceMac(auth, key.pubkey, s.sid, s.expires) }
    await publish(await key.signer.signEvent(pairingTemplate({ message, created_at: nowSeconds(), lookup })), record.relays)
  }

  async function handle(message: PairingMessage, from: string) {
    if (message.t === "announce" || finished) return
    const current = record.sessions.find((s) => s.sid === message.sid)
    if (!current) return
    // The package may come again (the acknowledgement got lost on the way): taken once,
    // acknowledged each time.
    if (message.t === "package" && current.step === "done") {
      if (packageHash(message.data) !== current.packageHash) return
      if (applied) await ack(from, current)
      else await (applying ??= take(message.data, current, from))
      return
    }
    // A hello repeated by the device already answered changes nothing.
    if (message.t === "hello" && current.peer === from) return
    const { session: next, error } = applyPairingMessage(current, from, message, nowSeconds())
    if (error) return
    if (next.step === "expired") return end({ step: "expired" })
    // The first door answered is the one; the other closes.
    record.sessions = [next]
    if (message.t === "hello") record.peer = message.device
    await keep(record)
    if (next.step === "aborted") return end(message.t === "abort" && message.reason === "declined" ? { step: "declined" } : { step: "failed", reason: "invalid" })
    if (message.t === "hello") {
      stopAnnouncing?.()
      stopAnnouncing = null
      set({ step: "found", checkCode: checkCodeOf(next), device: message.device })
    } else if (message.t === "package") {
      stopAccepting?.()
      stopAccepting = null
      clearTimeout(unanswered)
      set({ step: "receiving" })
      await (applying ??= take(message.data, next, from))
    }
  }

  // Takes the package: the profile is signed in here, then the other device hears so.
  async function take(data: Record<string, unknown>, current: PairingSession, from: string) {
    try {
      applied = await apply(parseProfilePackage(data), {})
    } catch (error) {
      void abort(from, current, "error")
      return end({ step: "failed", reason: error instanceof SessionError && error.code === "occupied" ? "occupied" : "invalid" })
    }
    await ack(from, current)
    set({ step: "done", applied })
  }

  const accept = (s: PairingSession) => {
    const checkCode = checkCodeOf(s)
    const device = record.peer ?? ""
    set({ step: "confirming", checkCode, device, unanswered: false })
    stopAccepting = repeat(() => channel.send(s.peer!, { t: "accept", sid: s.sid, device: deviceName() }))
    unanswered = setTimeout(() => set({ step: "confirming", checkCode, device, unanswered: true }), UNANSWERED_MS)
  }

  // Where the pairing stands now (a fresh one waits; a resumed one may be further).
  const current = chosen()
  if (!current) {
    stopAnnouncing = repeat(announce)
    set({ step: "waiting", link: encodePairingLink({ pubkey: key.pubkey, sid: record.sessions[0].sid, expires: record.expires, relays: record.relays }), code: encodePairingCode(hexToBytes(secrets.code!)), expires: record.expires })
  } else if (current.step === "confirm" && !current.confirmedHere) set({ step: "found", checkCode: checkCodeOf(current), device: record.peer ?? "" })
  else if (current.step === "confirm") accept(current)
  // The package came before the reload and may not have been taken: it comes again.
  else if (current.step === "done") set({ step: "receiving" })
  else void end({ step: "failed", reason: "invalid" })

  return {
    confirm() {
      const s = chosen()
      if (!s || s.step !== "confirm" || s.confirmedHere) return
      const { session: next, error } = confirmPairingHere(s, nowSeconds())
      if (error) return
      if (next.step === "expired") return void end({ step: "expired" })
      record.sessions = [next]
      void keep(record)
      accept(next)
    },
    decline() {
      const s = chosen()
      if (!s?.peer || finished) return
      void abort(s.peer, s, "declined")
      void end({ step: "declined" })
    },
    close() {
      closed = true
      stopAll()
      clearTimeout(expiry)
      channel.close()
      if (applied) void drop(record.id)
    },
  }
}

// ---- The device that has the profile ---------------------------------------------------------

export type AddDevicePairing =
  // Typed code: looking for the new device's announce.
  | { step: "looking" }
  // The check code is up; "Zugriff geben" once it is the one on the new device. `device` once
  // the new device said what it is (with its own confirmation).
  | { step: "found"; checkCode: string; device: string | null }
  // Confirmed here; waiting for the new device's confirmation.
  | { step: "confirmed"; checkCode: string; device: string | null; unanswered: boolean }
  | { step: "sending" }
  | { step: "done" }
  | { step: "declined" }
  | { step: "expired" }
  // "too-long": the profile's package doesn't fit a message. "wrong-profile": the profile here
  // changed since the pairing started.
  | { step: "failed"; reason: "too-long" | "wrong-profile" }

export type PairingInput = { link: PairingLink } | { code: Uint8Array }

export interface AddDeviceControl {
  // The check code here is the one on the new device: send the profile once both confirmed.
  give: () => void
  decline: () => void
  close: () => void
}

// The pairing in progress on this device, resumed; null without one.
export async function resumeAddDevice(onChange: (state: AddDevicePairing) => void): Promise<AddDeviceControl | null> {
  await purgeExpiredPairings()
  const record = (await stored()).find((r) => r.role === "existing")
  return record ? runExisting(record, onChange) : null
}

// Answers a scanned or pasted link, or a typed code. One pairing at a time: an earlier one is
// dropped. Throws without a profile, and when the link has run out.
export async function addDevice(input: PairingInput, onChange: (state: AddDevicePairing) => void): Promise<AddDeviceControl> {
  const session = getSession()
  if (!session) throw new Error("no profile is signed in on this device")
  for (const old of await stored()) if (old.role === "existing") await drop(old.id)
  const key = await newLocalKey()
  const now = nowSeconds()
  let record: StoredPairing
  if ("link" in input) {
    const { link } = input
    const pairing = newPairingSession({ role: "existing", sid: link.sid, self: key.pubkey, peer: link.pubkey, expires: link.expires, now })
    record = { id: `${ID_PREFIX}${link.sid}`, role: "existing", relays: link.relays.length > 0 ? link.relays : pairingRelays(), secrets: await sealSecrets({ key: bytesToHex(key.secret) }), sessions: [pairing], peer: null, expires: link.expires, pubkey: session.pubkey }
  } else {
    record = { id: `${ID_PREFIX}${randomHex(16)}`, role: "existing", relays: pairingRelays(), secrets: await sealSecrets({ key: bytesToHex(key.secret), code: bytesToHex(input.code) }), sessions: [], peer: null, expires: now + MAX_HANDSHAKE_SECONDS, pubkey: session.pubkey }
  }
  await keep(record)
  return runExisting(record, onChange)
}

async function runExisting(record: StoredPairing, onChange: (state: AddDevicePairing) => void): Promise<AddDeviceControl> {
  const secrets = await openSecrets(record.secrets)
  const key = await localKeyOf(hexToBytes(secrets.key))
  const code = secrets.code ? pairingCodeKeys(hexToBytes(secrets.code)) : null

  let closed = false
  let finished = false
  let stopLooking: (() => void) | null = null
  let stopHello: (() => void) | null = null
  let stopSending: (() => void) | null = null
  let unanswered: ReturnType<typeof setTimeout> | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined

  const set = (state: AddDevicePairing) => {
    if (!closed) onChange(state)
  }
  const stopAll = () => {
    stopLooking?.()
    stopLooking = null
    stopHello?.()
    stopHello = null
    stopSending?.()
    stopSending = null
    clearTimeout(unanswered)
    clearTimeout(expiry)
  }
  const end = async (state: AddDevicePairing) => {
    finished = true
    stopAll()
    await drop(record.id)
    set(state)
  }
  const armExpiry = () => {
    clearTimeout(expiry)
    expiry = untilExpiry(record.expires, () => void end({ step: "expired" }))
  }
  armExpiry()

  const channel = openChannel(PAIRING_FLOW, key, record.relays, (message, from) => void handle(message, from))
  const checkCodeOf = (s: PairingSession) => pairingCheckCode(s.peer!, key.pubkey, s.sid)
  const abort = (s: PairingSession, reason: "declined" | "error") => channel.send(s.peer!, { t: "abort", sid: s.sid, reason }).catch(() => {})
  const hello = (s: PairingSession): PairingMessage => ({ t: "hello", sid: s.sid, device: deviceName(), ...(s.auth ? { mac: helloMac(s.auth, key.pubkey, s.peer!, s.sid) } : {}) })

  const update = async (next: PairingSession) => {
    record.sessions = [next]
    await keep(record)
  }

  async function handle(message: PairingMessage, from: string) {
    const current = record.sessions[0]
    if (!current || finished || message.t === "announce" || message.sid !== current.sid) return
    // The new device repeats its confirmation until the package comes: once is enough.
    if (message.t === "accept" && current.confirmedThere) return
    const { session: next, error } = applyPairingMessage(current, from, message, nowSeconds())
    if (error) return
    if (next.step === "expired") return end({ step: "expired" })
    if (message.t === "accept") record.peer = message.device
    await update(next)
    if (next.step === "aborted") return end({ step: "declined" })
    if (next.step === "done") return end({ step: "done" })
    if (message.t === "accept") {
      if (next.step === "transfer") await send(next)
      else set({ step: "found", checkCode: checkCodeOf(next), device: record.peer })
    }
  }

  // Both confirmed: the package goes out until the new device acknowledges it.
  async function send(s: PairingSession) {
    stopHello?.()
    stopHello = null
    clearTimeout(unanswered)
    set({ step: "sending" })
    if (getSession()?.pubkey !== record.pubkey) {
      void abort(s, "error")
      return end({ step: "failed", reason: "wrong-profile" })
    }
    const data = await packageData()
    if (!data) {
      void abort(s, "error")
      return end({ step: "failed", reason: "too-long" })
    }
    const next = packageSent(s, data)
    await update(next)
    stopSending = repeat(() => channel.send(next.peer!, { t: "package", sid: next.sid, data }))
  }

  // Typed code: the announce under the code's lookup tag, genuine only with the code's MAC.
  const look = () => {
    set({ step: "looking" })
    const sub = subscribe([{ kinds: [KIND_EPHEMERAL], "#x": [code!.lookup], since: nowSeconds() - 60 }], record.relays, {
      onevent: (event) => {
        const now = nowSeconds()
        const parsed = parsePairingEvent(event, { now })
        if (!parsed.ok || record.sessions.length > 0) return
        const found = checkAnnounce(parsed.from, parsed.message, code!.auth, now)
        if (!found.ok) return
        const next = newPairingSession({ role: "existing", sid: found.sid, self: key.pubkey, peer: parsed.from, expires: found.expires, now, auth: code!.auth })
        record.expires = found.expires
        void update(next).then(() => {
          stopLooking?.()
          stopLooking = null
          armExpiry()
          greet(next)
        })
      },
    })
    stopLooking = () => sub.close()
  }

  const greet = (s: PairingSession) => {
    stopHello = repeat(() => channel.send(s.peer!, hello(s)))
    set({ step: "found", checkCode: checkCodeOf(s), device: record.peer })
  }

  // Where the pairing stands now.
  const current = record.sessions[0]
  if (!current) look()
  else if (current.step === "confirm" && !current.confirmedHere) greet(current)
  else if (current.step === "confirm") {
    greet(current)
    set({ step: "confirmed", checkCode: checkCodeOf(current), device: record.peer, unanswered: false })
  } else if (current.step === "transfer") void send(current)
  else void end({ step: "failed", reason: "wrong-profile" })

  return {
    give() {
      const s = record.sessions[0]
      if (!s || s.step !== "confirm" || s.confirmedHere || finished) return
      const { session: next, error } = confirmPairingHere(s, nowSeconds())
      if (error) return
      if (next.step === "expired") return void end({ step: "expired" })
      void update(next).then(() => {
        if (next.step === "transfer") return send(next)
        const checkCode = checkCodeOf(next)
        set({ step: "confirmed", checkCode, device: record.peer, unanswered: false })
        unanswered = setTimeout(() => set({ step: "confirmed", checkCode, device: record.peer, unanswered: true }), UNANSWERED_MS)
      })
    },
    decline() {
      const s = record.sessions[0]
      if (finished) return
      if (s?.peer) void abort(s, "declined")
      void end({ step: "declined" })
    },
    close() {
      closed = true
      stopAll()
      channel.close()
    },
  }
}

// The signed-in profile's package, trimmed to the message budget: the name and relay list are
// a courtesy and go first; null when even the key alone doesn't fit (it always does).
async function packageData(): Promise<Record<string, unknown> | null> {
  const pkg = await buildProfilePackage()
  for (const events of [pkg.events, pkg.events.slice(0, 1), []]) {
    const data = { ...pkg, events } as unknown as Record<string, unknown>
    if (utf8Length(JSON.stringify(data)) <= PACKAGE_BUDGET) return data
  }
  return null
}
