import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { openChannel, outcomeOf, repeat, REPEAT_MS, type ChannelFlow, type SendOutcome } from "../nostr/channel.ts"
import { publish, query, subscribe } from "../nostr/client.ts"
import { generalRelays } from "../nostr/relays.ts"
import { localKeyOf, newLocalKey, type LocalKey } from "../nostr/signers.ts"
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
import { adoptDeviceId } from "../sync/engine.ts"
import { deviceName } from "./device-name.ts"
import { deviceAdded } from "./list.ts"
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
// repeated until answered (lib/nostr/channel.ts), up to the session's expiry, and the screen
// hears whether the relays take them; one-time keys go when the pairing ends or runs out.

const PAIRING_FLOW: ChannelFlow<PairingMessage> = {
  kind: KIND_EPHEMERAL,
  plaintext: pairingPlaintext,
  template: ({ message, recipient, ciphertext, created_at }) => pairingTemplate({ message, recipient, ciphertext, created_at }),
  parse: parsePairingEvent,
}

// Where the messages travel: the first general relays, as many as the link can name.
const pairingRelays = () => generalRelays().slice(0, MAX_LINK_RELAYS)

// How long a device waits for the other one (to find its code, or to confirm there) before it
// says so; the pairing stays open all the same.
const UNANSWERED_MS = 20_000
// How long the device that sent the profile waits for the new device's acknowledgement, once a
// relay took the package, before it says the profile most likely arrived.
const ACK_WINDOW_MS = 30_000
// The new device asks for the package every REPEAT_MS until it comes: no ask for this long means
// it stopped asking.
const ASK_GAP_MS = 2 * REPEAT_MS
// The package fits the message schema with room for the message's own fields.
const PACKAGE_BUDGET = MAX_PACKAGE_BYTES - 200

type AbortReason = Extract<PairingMessage, { t: "abort" }>["reason"]

// What the other device's abort says: it declined (also because it saw another check code),
// its code ran out, or something went wrong there.
const abortedAs = (reason: AbortReason) => (reason === "expired" ? "expired" : reason === "error" ? "error" : "declined")

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
  // announce of a typed code. Stored without the code session's `auth`: that key is as good as
  // the code, so it is derived again from the sealed code instead.
  sessions: PairingSession[]
  // The typed code's session (its announce names the id in the clear anyway).
  codeSid: string | null
  // What the other device calls itself, once it said.
  peer: string | null
  expires: number
  // Existing device: the profile being sent.
  pubkey?: string
}

const stored = async () => (await dbGetAll<StoredPairing>("pending")).filter((r) => r.id.startsWith(ID_PREFIX))
const keep = (record: StoredPairing) => {
  const kept: StoredPairing = { ...record, sessions: record.sessions.map((s) => ({ ...s, auth: undefined })) }
  return dbPut("pending", kept)
}
const drop = (id: string) => dbDelete("pending", id)
const sealSecrets = (secrets: Secrets) => sealSecret(new TextEncoder().encode(JSON.stringify(secrets)), "pairing")

// The record's secrets, and its sessions with the code session's `auth` back in place.
async function unseal(record: StoredPairing) {
  const secrets: Secrets = JSON.parse(new TextDecoder().decode(await openSecret(record.secrets, "pairing")))
  const code = secrets.code ? pairingCodeKeys(hexToBytes(secrets.code)) : null
  record.sessions = record.sessions.map((s) => (code && s.sid === record.codeSid ? { ...s, auth: code.auth } : s))
  return { key: await localKeyOf(hexToBytes(secrets.key)), code, secrets }
}

// Pairings that ran out go, one-time keys and all: at start (components/devices/register.ts)
// and before every resume.
export async function purgeExpiredPairings(now = nowSeconds()) {
  for (const record of await stored()) if (record.expires <= now) await drop(record.id)
}

// How long until the session runs out.
const msUntil = (expires: number) => Math.max(0, expires - nowSeconds()) * 1000

// The device id a new device takes into the profile's device list (./list.ts): one both devices
// know from the pairing, the first half of its session id, so the device that gave the profile
// names it until the new device's own entry shows.
const pairedDeviceId = (sid: string) => sid.slice(0, 16)

// ---- One pairing as it runs ------------------------------------------------------------------

// Each change of step, and whether this device reaches the relays: `offline` while the last
// message sent reached none (the pairing keeps sending all the same).
export type PairingListener<S> = (state: S, offline: boolean) => void

const UNSENT: SendOutcome = { reached: false, delivered: false }

// A pairing running on this device: what its screen hears, and the repeats, timers and
// subscriptions that keep it going. The one place that knows the pairing is over: it ended
// (`end`, with the last step the screen shows) or its screen closed (`close`, the pairing stays
// stored to resume). Then everything running stops, the screen hears no other step, and a repeat
// or timer asked for later (by a step that went on after an await) never starts, so nothing is
// sent after the end.
function pairingRun<S>(onChange: PairingListener<S>) {
  let shown: S | null = null
  let offline = false
  let over = false
  let closed = false
  const running = new Set<() => void>()
  const tell = () => {
    if (shown && !closed) onChange(shown, offline)
  }
  const stopAll = () => {
    over = true
    for (const stop of running) stop()
    running.clear()
  }
  // Keeps `stop` until the end; at once when it is over already. Returns what stops it earlier.
  const hold = (stop: () => void) => {
    if (over) {
      stop()
      return () => {}
    }
    running.add(stop)
    return () => {
      running.delete(stop)
      stop()
    }
  }
  const reach = (ok: boolean) => {
    if (over || offline !== ok) return
    offline = !ok
    tell()
  }
  return {
    get over() {
      return over
    },
    show(state: S) {
      if (over) return
      shown = state
      tell()
    },
    reach,
    // A send that settles tells whether this device reaches a relay.
    track: (sending: Promise<SendOutcome>) =>
      sending.then(
        (outcome) => (reach(outcome.reached), outcome),
        () => (reach(false), UNSENT),
      ),
    hold,
    repeat: (send: () => Promise<unknown>) => (over ? () => {} : hold(repeat(send))),
    after(ms: number, then: () => void) {
      if (over) return () => {}
      const stop = () => clearTimeout(timer)
      const timer = setTimeout(() => {
        running.delete(stop)
        then()
      }, ms)
      return hold(stop)
    },
    end(last: S) {
      if (over) return
      stopAll()
      shown = last
      tell()
    },
    close() {
      stopAll()
      closed = true
    },
  }
}

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
  // couldn't be taken (another version of the app, damaged on the way). "other-device": the
  // other device stopped with a problem of its own.
  | { step: "failed"; reason: "occupied" | "invalid" | "other-device" }

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
  const sessions = [newPairingSession({ role: "new", sid: randomHex(16), self: key.pubkey, expires, now }), newPairingSession({ role: "new", sid: randomHex(16), self: key.pubkey, expires, now })]
  const record: StoredPairing = {
    id: `${ID_PREFIX}${sessions[0].sid}`,
    role: "new",
    relays: pairingRelays(),
    secrets: await sealSecrets({ key: bytesToHex(key.secret), code: bytesToHex(code) }),
    sessions,
    codeSid: sessions[1].sid,
    peer: null,
    expires,
  }
  await keep(record)
  return record
}

// Shows this device's codes and takes the profile that answers them. A pairing still open from
// before the reload goes on where it was; otherwise a fresh one starts. `apply` stands in for
// applyProfilePackage in the tests.
export async function pairNewDevice(onChange: PairingListener<NewDevicePairing>, options: { apply?: typeof applyProfilePackage } = {}): Promise<NewDeviceControl> {
  await purgeExpiredPairings()
  const record = (await stored()).find((r) => r.role === "new") ?? (await newRecord())
  const { key, code, secrets } = await unseal(record)
  const apply = options.apply ?? applyProfilePackage
  // The code's door, as long as both are open.
  const codeSession = () => record.sessions.find((s) => s.sid === record.codeSid)
  const chosen = () => (record.sessions.length === 1 ? record.sessions[0] : null)

  const run = pairingRun(onChange)
  let stopAnnouncing: (() => void) | null = null
  let stopAccepting: (() => void) | null = null
  let stopUnanswered: (() => void) | null = null
  let applied: Applied | null = null
  let applying: Promise<void> | null = null

  // Every end but "done" forgets the pairing at once; "done" keeps answering the other device's
  // repeats until the screen closes.
  const end = async (state: Exclude<NewDevicePairing, { step: "done" }>) => {
    run.end(state)
    await drop(record.id)
  }
  run.after(msUntil(record.expires), () => void end({ step: "expired" }))

  const channel = openChannel(PAIRING_FLOW, key, record.relays, (message, from) => void handle(message, from))
  const checkCodeOf = (s: PairingSession) => pairingCheckCode(key.pubkey, s.peer!, s.sid)
  const ack = (to: string, s: PairingSession) => channel.send(to, { t: "ack", sid: s.sid, hash: s.packageHash! }).catch(() => UNSENT)
  const abort = (to: string, s: PairingSession, reason: AbortReason) => channel.send(to, { t: "abort", sid: s.sid, reason }).catch(() => UNSENT)

  // The announce of the typed code, plaintext under the code's lookup tag.
  const announce = async () => {
    const s = codeSession()
    if (!s || !code) return UNSENT
    const message: PairingMessage = { t: "announce", sid: s.sid, exp: s.expires, mac: announceMac(code.auth, key.pubkey, s.sid, s.expires) }
    return outcomeOf(await publish(await key.signer.signEvent(pairingTemplate({ message, created_at: nowSeconds(), lookup: code.lookup })), record.relays))
  }

  async function handle(message: PairingMessage, from: string) {
    if (message.t === "announce" || run.over) return
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
    if (run.over) return
    if (message.t === "abort") {
      const why = abortedAs(message.reason)
      return end(why === "error" ? { step: "failed", reason: "other-device" } : { step: why })
    }
    if (message.t === "hello") {
      stopAnnouncing?.()
      run.show({ step: "found", checkCode: checkCodeOf(next), device: message.device })
    } else if (message.t === "package") {
      stopAccepting?.()
      stopUnanswered?.()
      run.show({ step: "receiving" })
      await (applying ??= take(message.data, next, from))
    }
  }

  // Takes the package: the profile is signed in here, then the other device hears so. This
  // device goes into the profile's device list under the id the other device knows it by, kept
  // before the profile signs in, so the first sync here already runs under it.
  async function take(data: Record<string, unknown>, current: PairingSession, from: string) {
    try {
      const pkg = parseProfilePackage(data)
      await adoptDeviceId(pkg.pubkey, pairedDeviceId(current.sid))
      applied = await apply(pkg, {})
    } catch (error) {
      void abort(from, current, "error")
      return end({ step: "failed", reason: error instanceof SessionError && error.code === "occupied" ? "occupied" : "invalid" })
    }
    await ack(from, current)
    run.show({ step: "done", applied })
  }

  const accept = (s: PairingSession) => {
    const checkCode = checkCodeOf(s)
    const device = record.peer ?? ""
    run.show({ step: "confirming", checkCode, device, unanswered: false })
    stopAccepting = run.repeat(() => run.track(channel.send(s.peer!, { t: "accept", sid: s.sid, device: deviceName() })))
    stopUnanswered = run.after(UNANSWERED_MS, () => run.show({ step: "confirming", checkCode, device, unanswered: true }))
  }

  // Where the pairing stands now (a fresh one waits; a resumed one may be further).
  const current = chosen()
  if (!current) {
    stopAnnouncing = run.repeat(() => run.track(announce()))
    run.show({ step: "waiting", link: encodePairingLink({ pubkey: key.pubkey, sid: record.sessions[0].sid, expires: record.expires, relays: record.relays }), code: encodePairingCode(hexToBytes(secrets.code!)), expires: record.expires })
  } else if (current.step === "confirm" && !current.confirmedHere) run.show({ step: "found", checkCode: checkCodeOf(current), device: record.peer ?? "" })
  else if (current.step === "confirm") accept(current)
  // The package came before the reload and may not have been taken: it comes again.
  else if (current.step === "done") run.show({ step: "receiving" })
  else void end({ step: "failed", reason: "invalid" })

  return {
    confirm() {
      const s = chosen()
      if (!s || s.step !== "confirm" || s.confirmedHere || run.over) return
      const { session: next, error } = confirmPairingHere(s, nowSeconds())
      if (error) return
      if (next.step === "expired") return void end({ step: "expired" })
      record.sessions = [next]
      void keep(record)
      accept(next)
    },
    decline() {
      const s = chosen()
      if (!s?.peer || run.over) return
      void abort(s.peer, s, "declined")
      void end({ step: "declined" })
    },
    close() {
      run.close()
      // One more acknowledgement on the way out, in case the last one got lost: the other
      // device then knows the profile arrived.
      const s = chosen()
      const last = applied && s?.peer ? ack(s.peer, s) : Promise.resolve(UNSENT)
      void last.finally(() => channel.close())
      if (applied) void drop(record.id)
    },
  }
}

// ---- The device that has the profile ---------------------------------------------------------

export type AddDevicePairing =
  // Typed code: looking for the new device's announce. `unanswered`: nothing found within
  // UNANSWERED_MS (a mistyped code, or the new device is offline or closed its code).
  | { step: "looking"; unanswered: boolean }
  // The check code is up; "Zugriff geben" once it is the one on the new device. `device` once
  // the new device said what it is (with its own confirmation).
  | { step: "found"; checkCode: string; device: string | null }
  // Confirmed here; waiting for the new device's confirmation.
  | { step: "confirmed"; checkCode: string; device: string | null; unanswered: boolean }
  // The profile goes out until the new device acknowledges it. `unanswered`: nothing came back
  // within UNANSWERED_MS (the new device closed its code, or is offline).
  | { step: "sending"; unanswered: boolean }
  // The new device's acknowledgement didn't come back, but its own signals say the profile most
  // likely arrived (the answer got lost, or the screen there closed at once). Sending goes on
  // while this shows, so a late answer still makes it "done"; leaving it ends the pairing.
  | { step: "sent" }
  | { step: "done" }
  | { step: "declined" }
  | { step: "expired" }
  // "too-long": the profile's package doesn't fit a message. "wrong-profile": the profile here
  // changed since the pairing started. "not-taken": the new device couldn't take the profile.
  | { step: "failed"; reason: "too-long" | "wrong-profile" | "not-taken" }

export interface AddDeviceControl {
  // The check code here is the one on the new device: send the profile once both confirmed.
  give: () => void
  decline: () => void
  close: () => void
}

export type PairingInput = { link: PairingLink } | { code: Uint8Array }

// A pairing link opened from outside the app (the camera app, a message, a code on a screen
// someone else controls): nothing is sent or kept until the person, on "Eigenes Gerät
// hinzufügen", has seen the check code it will have and taps to answer it (decision 0002 §7,
// research DR-08). Throws when the link has run out.
export interface HeldLink {
  checkCode: string
  answer: (onChange: PairingListener<AddDevicePairing>) => Promise<AddDeviceControl>
}

export async function holdLink(link: PairingLink): Promise<HeldLink> {
  const key = await newLocalKey()
  const session = newPairingSession({ role: "existing", sid: link.sid, self: key.pubkey, peer: link.pubkey, expires: link.expires, now: nowSeconds() })
  return {
    checkCode: pairingCheckCode(link.pubkey, key.pubkey, link.sid),
    answer: (onChange) => begin({ id: `${ID_PREFIX}${link.sid}`, relays: link.relays.length > 0 ? link.relays : pairingRelays(), sessions: [session], expires: link.expires }, key, null, onChange),
  }
}

// Answers a link scanned or pasted on "Eigenes Gerät hinzufügen", or a typed code. One pairing
// at a time: an earlier one is dropped. Throws without a profile, and when the link has run out.
export async function addDevice(input: PairingInput, onChange: PairingListener<AddDevicePairing>): Promise<AddDeviceControl> {
  if ("link" in input) return (await holdLink(input.link)).answer(onChange)
  return begin({ id: `${ID_PREFIX}${randomHex(16)}`, relays: pairingRelays(), sessions: [], expires: nowSeconds() + MAX_HANDSHAKE_SECONDS }, await newLocalKey(), input.code, onChange)
}

// The pairing in progress on this device, resumed; null without one.
export async function resumeAddDevice(onChange: PairingListener<AddDevicePairing>): Promise<AddDeviceControl | null> {
  await purgeExpiredPairings()
  const record = (await stored()).find((r) => r.role === "existing")
  return record ? runExisting(record, onChange) : null
}

async function begin(start: Pick<StoredPairing, "id" | "relays" | "sessions" | "expires">, key: LocalKey, code: Uint8Array | null, onChange: PairingListener<AddDevicePairing>) {
  const session = getSession()
  if (!session) throw new Error("no profile is signed in on this device")
  for (const old of await stored()) if (old.role === "existing") await drop(old.id)
  const secrets = await sealSecrets({ key: bytesToHex(key.secret), ...(code ? { code: bytesToHex(code) } : {}) })
  const record: StoredPairing = { ...start, role: "existing", secrets, codeSid: null, peer: null, pubkey: session.pubkey }
  await keep(record)
  return runExisting(record, onChange)
}

async function runExisting(record: StoredPairing, onChange: PairingListener<AddDevicePairing>): Promise<AddDeviceControl> {
  const { key, code } = await unseal(record)

  const run = pairingRun(onChange)
  let stopLooking: (() => void) | null = null
  let stopHello: (() => void) | null = null
  let stopUnanswered: (() => void) | null = null
  let stopExpiry: (() => void) | null = null
  // While the package goes out: when the new device last asked for it (its repeated accept), when
  // a relay first took it, and whether it most likely arrived (see sending below).
  let askedAt = 0
  let takenAt = 0
  let arrived = false

  const end = async (state: AddDevicePairing) => {
    run.end(state)
    await drop(record.id)
  }
  const armExpiry = () => {
    stopExpiry?.()
    stopExpiry = run.after(msUntil(record.expires), () => void end(arrived ? { step: "sent" } : { step: "expired" }))
  }
  armExpiry()
  // Shows `later` once UNANSWERED_MS pass without a change.
  const waitFor = (later: AddDevicePairing) => {
    stopUnanswered?.()
    stopUnanswered = run.after(UNANSWERED_MS, () => run.show(later))
  }

  const channel = openChannel(PAIRING_FLOW, key, record.relays, (message, from) => void handle(message, from))
  run.hold(() => channel.close())
  const checkCodeOf = (s: PairingSession) => pairingCheckCode(s.peer!, key.pubkey, s.sid)
  const abort = (s: PairingSession, reason: AbortReason) => channel.send(s.peer!, { t: "abort", sid: s.sid, reason }).catch(() => UNSENT)
  const hello = (s: PairingSession): PairingMessage => ({ t: "hello", sid: s.sid, device: deviceName(), ...(s.auth ? { mac: helloMac(s.auth, key.pubkey, s.peer!, s.sid) } : {}) })

  // Keeps the next step, unless the pairing is over by now: an end dropped the record, and
  // keeping it would bring it back. Whether the pairing goes on.
  const update = async (next: PairingSession) => {
    if (run.over) return false
    record.sessions = [next]
    await keep(record)
    return !run.over
  }

  async function handle(message: PairingMessage, from: string) {
    const current = record.sessions[0]
    if (!current || run.over || message.t === "announce" || message.sid !== current.sid) return
    // The new device repeats its confirmation until the package comes: once is enough, and
    // each repeat says it is still waiting.
    if (message.t === "accept" && from === current.peer) askedAt = Date.now()
    if (message.t === "accept" && current.confirmedThere) return
    const { session: next, error } = applyPairingMessage(current, from, message, nowSeconds())
    if (error) return
    if (next.step === "expired") return end({ step: "expired" })
    if (message.t === "accept") record.peer = message.device
    if (!(await update(next))) return
    if (message.t === "abort") {
      const why = abortedAs(message.reason)
      return end(why === "error" ? { step: "failed", reason: "not-taken" } : { step: why })
    }
    if (next.step === "done") {
      if (record.peer) deviceAdded(record.pubkey!, pairedDeviceId(next.sid), record.peer)
      return end({ step: "done" })
    }
    if (message.t === "accept") {
      if (next.step === "transfer") await send(next)
      else run.show({ step: "found", checkCode: checkCodeOf(next), device: record.peer })
    }
  }

  // The package most likely arrived when a relay took it (an OK, not "nobody listens") while the
  // new device still asked for it, and the asking stopped since, with no acknowledgement within
  // ACK_WINDOW_MS. Asks that go on say it didn't arrive; none at all, that the new device left.
  const likelyArrived = (now: number) => takenAt > 0 && now - takenAt >= ACK_WINDOW_MS && askedAt >= takenAt - ASK_GAP_MS && now - askedAt >= ASK_GAP_MS

  // Both confirmed: the package goes out until the new device acknowledges it.
  async function send(s: PairingSession) {
    stopHello?.()
    run.show({ step: "sending", unanswered: false })
    waitFor({ step: "sending", unanswered: true })
    if (getSession()?.pubkey !== record.pubkey) {
      void abort(s, "error")
      return end({ step: "failed", reason: "wrong-profile" })
    }
    const data = await packageData()
    if (run.over) return
    if (!data) {
      void abort(s, "error")
      return end({ step: "failed", reason: "too-long" })
    }
    const next = packageSent(s, data)
    if (!(await update(next))) return
    run.repeat(async () => {
      const { delivered } = await run.track(channel.send(next.peer!, { t: "package", sid: next.sid, data }))
      const now = Date.now()
      if (delivered && takenAt === 0) takenAt = now
      if (arrived || !likelyArrived(now)) return
      arrived = true
      stopUnanswered?.()
      run.show({ step: "sent" })
    })
  }

  // Typed code: the announce under the code's lookup tag, genuine only with the code's MAC.
  // Looking sends nothing, so a search for the code, now and again, says whether this device
  // reaches the relays.
  const look = () => {
    run.show({ step: "looking", unanswered: false })
    waitFor({ step: "looking", unanswered: true })
    const filter = { kinds: [KIND_EPHEMERAL], "#x": [code!.lookup], since: nowSeconds() - 60 }
    const sub = subscribe([filter], record.relays, {
      onevent: (event) => {
        const now = nowSeconds()
        const parsed = parsePairingEvent(event, { now })
        if (!parsed.ok || record.sessions.length > 0) return
        const found = checkAnnounce(parsed.from, parsed.message, code!.auth, now)
        if (!found.ok) return
        const next = newPairingSession({ role: "existing", sid: found.sid, self: key.pubkey, peer: parsed.from, expires: found.expires, now, auth: code!.auth })
        record.expires = found.expires
        record.codeSid = found.sid
        void update(next).then((going) => {
          if (!going) return
          stopLooking?.()
          armExpiry()
          greet(next)
        })
      },
    })
    const stopProbing = run.repeat(async () => run.reach((await query([filter], record.relays, { timeoutMs: REPEAT_MS })).answered.length > 0))
    stopLooking = run.hold(() => {
      sub.close()
      stopProbing()
    })
  }

  const greet = (s: PairingSession) => {
    stopUnanswered?.()
    stopHello = run.repeat(() => run.track(channel.send(s.peer!, hello(s))))
    run.show({ step: "found", checkCode: checkCodeOf(s), device: record.peer })
  }

  const confirmed = (s: PairingSession) => {
    const state = { step: "confirmed", checkCode: checkCodeOf(s), device: record.peer, unanswered: false } as const
    run.show(state)
    waitFor({ ...state, unanswered: true })
  }

  // Where the pairing stands now.
  const current = record.sessions[0]
  if (!current) look()
  else if (current.step === "confirm") {
    greet(current)
    if (current.confirmedHere) confirmed(current)
  } else if (current.step === "transfer") void send(current)
  else void end({ step: "failed", reason: "wrong-profile" })

  return {
    give() {
      const s = record.sessions[0]
      if (!s || s.step !== "confirm" || s.confirmedHere || run.over) return
      const { session: next, error } = confirmPairingHere(s, nowSeconds())
      if (error) return
      if (next.step === "expired") return void end({ step: "expired" })
      void update(next).then((going) => going && (next.step === "transfer" ? send(next) : confirmed(next)))
    },
    decline() {
      const s = record.sessions[0]
      if (run.over) return
      if (s?.peer) void abort(s, "declined")
      void end({ step: "declined" })
    },
    // Leaving "Wahrscheinlich angekommen" ends the pairing; any other step resumes next time.
    close() {
      run.close()
      if (arrived) void drop(record.id)
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
