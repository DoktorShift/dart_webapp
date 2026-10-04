// Writes the BlueLine protocol test vectors (docs/protocol/vectors/*.json) and the JSON Schemas
// (docs/protocol/schemas/*.schema.json). Deterministic: fixed secret keys derived from names,
// fixed created_at, fixed NIP-44 nonces and BIP-340 signatures with zero auxiliary randomness,
// so a re-run produces byte-identical files (tests/protocol-vectors.test.ts checks that).
//
//   node tests/support/make-vectors.ts
//
// Expected outcomes are written by hand per case from the rules in docs/protocol/, not computed
// by the reducers they test. Where a case needs a value the rules define (draw order, invite
// proof, tie-break by id), it is computed here with a separate few lines, not with lib/protocol.

import { writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { schnorr } from "@noble/curves/secp256k1"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { getEventHash, nip44 } from "nostr-core"
import { replay } from "../../lib/game/engine.ts"
import type { Throw } from "../../lib/game/types.ts"
import { badgeAwardTemplate, badgeD, badgeDefinitionTemplate } from "../../lib/protocol/badges.ts"
import { BOARD_MESSAGES, boardPlaintext, boardTemplate } from "../../lib/protocol/board.ts"
import { chunkData } from "../../lib/protocol/chunks.ts"
import { liveContent } from "../../lib/protocol/live.ts"
import { ENGINE_VERSION } from "../../lib/protocol/match.ts"
import { announceMac, encodePairingCode, helloMac, PAIRING_MESSAGES, pairingCheckCode, pairingCodeKeys, pairingPlaintext, pairingTemplate } from "../../lib/protocol/pairing.ts"
import { paymentRequestRumor } from "../../lib/protocol/payment.ts"
import { dataKeyRecord, dataKeySlot, encodeEnvelope, privateRecord, privateTemplate, recordPart, recordSlot } from "../../lib/protocol/private.ts"
import { buildRecord, RECORD_TYPES, sealTemplate } from "../../lib/protocol/records.ts"
import type { ContentOf, RecordType } from "../../lib/protocol/records.ts"
import type { JsonSchema, Schema } from "../../lib/protocol/schema.ts"
import type { SignedEvent } from "../../lib/protocol/tags.ts"
import { encodeLinkPayload } from "../../lib/protocol/links.ts"
import { encodeThrows } from "../../lib/protocol/throws.ts"
import { config, dart, miss3, play } from "../helpers.ts"

type EventTemplate = { kind: number; created_at: number; tags: string[][]; content: string }

export const T0 = 1760000000

// ---- Keys and signing -------------------------------------------------------------------------

// Names of the keys a vector file uses; its key table lists exactly these.
const usedKeys = new Set<string>()

const secretOf = (name: string) => sha256(utf8ToBytes(`blueline-vector:${name}`))
export const pub = (name: string) => {
  usedKeys.add(name)
  return bytesToHex(schnorr.getPublicKey(secretOf(name)))
}
export const sec = (name: string) => {
  usedKeys.add(name)
  return bytesToHex(secretOf(name))
}

function sign(name: string, t: EventTemplate): SignedEvent {
  usedKeys.add(name)
  const pubkey = pub(name)
  const id = getEventHash({ ...t, pubkey })
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secretOf(name), new Uint8Array(32)))
  return { id, pubkey, created_at: t.created_at, kind: t.kind, tags: t.tags, content: t.content, sig }
}

const nonceFor = (...parts: (string | number)[]) => sha256(utf8ToBytes(`blueline-vector-nonce:${parts.join(":")}`))

// NIP-44 from `author` to `recipient` (a group key or a one-time key) with a fixed nonce.
function encryptTo(author: string, recipient: string, plaintext: string) {
  usedKeys.add(author)
  usedKeys.add(recipient)
  return nip44.encrypt(plaintext, nip44.getConversationKey(secretOf(author), pub(recipient)), nonceFor(author, recipient, plaintext))
}

const at = (seconds: number) => T0 + seconds

// ---- Cases ------------------------------------------------------------------------------------

interface Expect {
  applied?: string[]
  rejected?: [string, string][]
  unapplied?: [string, "unknown" | "sealed"][]
  problem?: string
  state?: Record<string, unknown>
}

function newCase(name: string, description: string, opts: { now?: number; group?: string; open?: boolean } = {}) {
  const events: SignedEvent[] = []
  const labels: Record<string, string> = {}
  const plaintexts: Record<string, string> = {}
  let root = ""
  const c = {
    add(label: string, event: SignedEvent, plaintext?: string) {
      if (labels[label]) throw new Error(`label ${label} twice`)
      events.push(event)
      labels[label] = event.id
      if (plaintext !== undefined) plaintexts[event.id] = plaintext
      return event
    },
    // The same event delivered once more (a second relay).
    again(label: string) {
      events.push(events.find((e) => e.id === labels[label]) as SignedEvent)
    },
    id: (label: string) => {
      const id = labels[label]
      if (!id) throw new Error(`no label ${label}`)
      return id
    },
    setRoot(label: string) {
      root = c.id(label)
    },
    done(expect: Expect, extra: Record<string, unknown> = {}) {
      const id = (label: string) => c.id(label)
      return {
        name,
        description,
        now: opts.now ?? at(100000),
        root,
        ...(opts.group ? { groupKey: opts.group } : {}),
        open: opts.open ?? true,
        ...extra,
        events,
        plaintexts,
        labels,
        expect: {
          ...(expect.problem ? { problem: expect.problem } : {}),
          ...(expect.applied ? { applied: expect.applied.map(id) } : {}),
          ...(expect.rejected ? { rejected: expect.rejected.map(([label, reason]) => ({ id: id(label), label, reason })) } : {}),
          ...(expect.unapplied ? { unapplied: expect.unapplied.map(([label, why]) => ({ id: id(label), label, why })) } : {}),
          ...(expect.state ? { state: expect.state } : {}),
        },
      }
    },
  }
  return c
}

type CaseBuilder = ReturnType<typeof newCase>

function record<T extends RecordType>(
  author: string,
  type: T,
  content: ContentOf<T>,
  opts: { at: number; root?: string; d?: string; seal?: string; version?: string },
): { event: SignedEvent; plaintext?: string } {
  let template = buildRecord(type, content, { created_at: at(opts.at), root: opts.root, d: opts.d })
  let plaintext: string | undefined
  if (opts.version) template = { ...template, tags: template.tags.map((t) => (t[0] === "v" ? ["v", opts.version as string] : t)) }
  if (opts.seal) {
    plaintext = template.content
    template = sealTemplate(template, pub(opts.seal), encryptTo(author, opts.seal, template.content))
  }
  return { event: sign(author, template), plaintext }
}

const put = <T extends RecordType>(c: CaseBuilder, label: string, author: string, type: T, content: ContentOf<T>, opts: Parameters<typeof record>[3]) => {
  const r = record(author, type, content, opts)
  return c.add(label, r.event, r.plaintext)
}

// Independent helpers (deliberately not lib/protocol): the rules from docs/protocol.
const proof = (token: string, pubkey: string) => bytesToHex(hmac(sha256, hexToBytes(token), utf8ToBytes(`blueline-invite-v1:${pubkey}`)))
const commit = (seed: string) => bytesToHex(sha256(utf8ToBytes(`blueline-seed-v1:${seed}`)))
const order = (seed: string, field: string[]) =>
  field
    .map((id) => ({ id, k: bytesToHex(sha256(utf8ToBytes(`blueline-draw-v1:${seed}:${id}`))) }))
    .sort((a, b) => (a.k < b.k ? -1 : 1))
    .map((x) => x.id)

const hex16 = (label: string) => bytesToHex(sha256(utf8ToBytes(`blueline-vector-id:${label}`))).slice(0, 32)
const hex32 = (label: string) => bytesToHex(sha256(utf8ToBytes(`blueline-vector-id:${label}`)))

// ---- Club ---------------------------------------------------------------------------------------

const club = (extra: Partial<ContentOf<"club.found">> = {}): ContentOf<"club.found"> => ({ name: "Dartfreunde Nord", visibility: "closed", key: pub("club"), ...extra })

function clubCases() {
  const cases = []
  const T = hex16("token-1")
  const T2 = hex16("token-2")
  const INV = hex16("invite-1")
  const INV2 = hex16("invite-2")
  const invite = (id = INV, token = T, extra: Partial<ContentOf<"club.invite">> = {}): ContentOf<"club.invite"> => ({ invite: id, token, maxUses: 5, expires: at(86400), ...extra })
  const join = (who: string, id = INV, token = T): ContentOf<"club.join"> => ({ invite: id, proof: proof(token, pub(who)) })

  {
    const c = newCase("invite-join", "A closed club (founding and invite encrypted to the club key). Two people join with the invite's proof.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(INV, T, { maxUses: 2 }), { at: 10, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 20, root })
    put(c, "join-bob", "bob", "club.join", join("bob"), { at: 30, root })
    cases.push(c.done({ applied: ["found", "invite", "join-alice", "join-bob"], rejected: [], state: { owner: "owner", members: { owner: "owner", alice: "member", bob: "member" }, inviteUses: { [INV]: 2 } } }))
  }
  {
    const c = newCase("replayed-invite", "Mallory copies Alice's proof into her own join: worthless for another key. Alice's join arrives twice and counts once.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 20, root })
    c.again("join-alice")
    put(c, "join-mallory", "mallory", "club.join", { invite: INV, proof: proof(T, pub("alice")) }, { at: 30, root })
    cases.push(c.done({ applied: ["found", "invite", "join-alice"], rejected: [["join-mallory", "invite_proof_invalid"]], state: { members: { owner: "owner", alice: "member" }, inviteUses: { [INV]: 1 } } }))
  }
  {
    const c = newCase("invite-race", "Single-use invites: the earlier join (created_at, then id) takes the place, the other is refused. Dave and Erin join the second invite in the same second; the lower event id wins.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(INV, T, { maxUses: 1 }), { at: 10, root, seal: "club" })
    put(c, "join-bob", "bob", "club.join", join("bob"), { at: 30, root })
    put(c, "join-carol", "carol", "club.join", join("carol"), { at: 25, root })
    put(c, "invite-2", "owner", "club.invite", invite(INV2, T2, { maxUses: 1 }), { at: 40, root, seal: "club" })
    const dave = put(c, "join-dave", "dave", "club.join", join("dave", INV2, T2), { at: 50, root })
    const erin = put(c, "join-erin", "erin", "club.join", join("erin", INV2, T2), { at: 50, root })
    const [first, second] = dave.id < erin.id ? ["join-dave", "join-erin"] : ["join-erin", "join-dave"]
    const winner = first === "join-dave" ? "dave" : "erin"
    cases.push(
      c.done({
        applied: ["found", "invite", "join-carol", "invite-2", first],
        rejected: [
          ["join-bob", "invite_exhausted"],
          [second, "invite_exhausted"],
        ],
        state: { members: { owner: "owner", carol: "member", [winner]: "member" } },
      }),
    )
  }
  {
    const c = newCase("expired-and-revoked-invite", "A join after the invite's expiry, and one after the invite was ended.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(INV, T, { expires: at(100) }), { at: 10, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 200, root })
    put(c, "invite-2", "owner", "club.invite", invite(INV2, T2), { at: 300, root, seal: "club" })
    put(c, "revoke", "owner", "club.invite.revoke", { invite: INV2 }, { at: 310, root })
    put(c, "join-bob", "bob", "club.join", join("bob", INV2, T2), { at: 320, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "invite-2", "revoke"],
        rejected: [
          ["join-alice", "invite_expired"],
          ["join-bob", "invite_revoked"],
        ],
        state: { members: { owner: "owner" } },
      }),
    )
  }
  {
    const c = newCase("over-capacity", "A club for two: the third valid join is refused.", { group: "club" })
    put(c, "found", "owner", "club.found", club({ capacity: 2 }), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 20, root })
    put(c, "join-bob", "bob", "club.join", join("bob"), { at: 30, root })
    cases.push(c.done({ applied: ["found", "invite", "join-alice"], rejected: [["join-bob", "club_full"]], state: { members: { owner: "owner", alice: "member" } } }))
  }
  {
    const c = newCase("roles", "Who may do what: the owner appoints an admin, the admin appoints a director and removes a member; a director may not invite, a member may not give roles, an admin may not appoint admins or remove the owner.", {
      group: "club",
    })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-admin", "admin", "club.join", join("admin"), { at: 20, root })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 21, root })
    put(c, "join-bob", "bob", "club.join", join("bob"), { at: 22, root })
    put(c, "make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 30, root })
    put(c, "make-director", "admin", "club.role", { member: pub("alice"), role: "director", prev: c.id("join-alice") }, { at: 40, root })
    put(c, "director-invites", "alice", "club.invite", invite(INV2, T2), { at: 50, root, seal: "club" })
    put(c, "member-gives-role", "bob", "club.role", { member: pub("alice"), role: "member", prev: c.id("make-director") }, { at: 60, root })
    put(c, "admin-appoints-admin", "admin", "club.role", { member: pub("bob"), role: "admin", prev: c.id("join-bob") }, { at: 70, root })
    put(c, "admin-removes-owner", "admin", "club.remove", { member: pub("owner"), prev: root }, { at: 80, root })
    put(c, "admin-removes-bob", "admin", "club.remove", { member: pub("bob"), prev: c.id("join-bob"), reason: "Auf eigenen Wunsch" }, { at: 90, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "join-alice", "join-bob", "make-admin", "make-director", "admin-removes-bob"],
        rejected: [
          ["director-invites", "not_authorized"],
          ["member-gives-role", "not_authorized"],
          ["admin-appoints-admin", "not_authorized"],
          ["admin-removes-owner", "not_authorized"],
        ],
        state: { members: { owner: "owner", admin: "admin", alice: "director" }, former: { bob: "removed" } },
      }),
    )
  }
  {
    const c = newCase("requests", "Joining without an invite waits for the leadership: Dave is accepted, Carol declined; accepting a gone request and asking twice are refused.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "ask-dave", "dave", "club.join", { message: "Ich spiele dienstags mit." }, { at: 10, root })
    put(c, "ask-carol", "carol", "club.join", {}, { at: 11, root })
    put(c, "ask-carol-again", "carol", "club.join", {}, { at: 12, root })
    put(c, "accept-dave", "owner", "club.accept", { request: c.id("ask-dave"), member: pub("dave") }, { at: 20, root })
    put(c, "decline-carol", "owner", "club.decline", { request: c.id("ask-carol") }, { at: 30, root })
    put(c, "accept-carol", "owner", "club.accept", { request: c.id("ask-carol"), member: pub("carol") }, { at: 40, root })
    put(c, "ask-dave-again", "dave", "club.join", {}, { at: 50, root })
    put(c, "outsider-accepts", "mallory", "club.accept", { request: c.id("ask-dave"), member: pub("dave") }, { at: 60, root })
    cases.push(
      c.done({
        applied: ["found", "ask-dave", "ask-carol", "accept-dave", "decline-carol"],
        rejected: [
          ["ask-carol-again", "duplicate"],
          ["accept-carol", "request_unknown"],
          ["ask-dave-again", "already_member"],
          ["outsider-accepts", "not_authorized"],
        ],
        state: { members: { owner: "owner", dave: "member" }, requests: [] },
      }),
    )
  }
  {
    const c = newCase("role-conflict", "Owner and admin change Alice's role from the same base. The later one is a visible conflict; the admin resolves it on the new base.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-admin", "admin", "club.join", join("admin"), { at: 20, root })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 21, root })
    put(c, "make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 30, root })
    put(c, "owner-sets", "owner", "club.role", { member: pub("alice"), role: "director", prev: c.id("join-alice") }, { at: 50, root })
    put(c, "admin-sets", "admin", "club.role", { member: pub("alice"), role: "member", prev: c.id("join-alice") }, { at: 51, root })
    put(c, "admin-resolves", "admin", "club.role", { member: pub("alice"), role: "member", prev: c.id("owner-sets") }, { at: 60, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "join-alice", "make-admin", "owner-sets", "admin-resolves"],
        rejected: [["admin-sets", "stale_predecessor"]],
        state: { members: { owner: "owner", admin: "admin", alice: "member" } },
      }),
    )
  }
  {
    const c = newCase("owner-transfer", "Ownership changes only by offer and acceptance of the offered member. Afterwards the former owner is an admin and loses owner rights.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 20, root })
    put(c, "join-bob", "bob", "club.join", join("bob"), { at: 21, root })
    put(c, "offer", "owner", "club.owner.offer", { to: pub("alice"), prev: root }, { at: 30, root })
    put(c, "bob-accepts", "bob", "club.owner.accept", { offer: c.id("offer") }, { at: 40, root })
    put(c, "alice-accepts", "alice", "club.owner.accept", { offer: c.id("offer") }, { at: 50, root })
    put(c, "old-owner-rotates", "owner", "club.key", { epoch: 1, key: pub("club-2"), wraps: [] }, { at: 60, root })
    put(c, "old-owner-offers", "owner", "club.owner.offer", { to: pub("bob"), prev: c.id("alice-accepts") }, { at: 70, root })
    put(c, "new-owner-rotates", "alice", "club.key", { epoch: 1, key: pub("club-2"), wraps: [encryptTo("alice", "owner", sec("club-2")), encryptTo("alice", "bob", sec("club-2"))] }, { at: 80, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "join-bob", "offer", "alice-accepts", "new-owner-rotates"],
        rejected: [
          ["bob-accepts", "not_authorized"],
          ["old-owner-rotates", "not_authorized"],
          ["old-owner-offers", "not_authorized"],
        ],
        state: { owner: "alice", members: { owner: "admin", alice: "owner", bob: "member" }, keyEpoch: 1 },
      }),
    )
  }
  {
    const c = newCase("leave-and-rejoin", "The owner cannot leave; a member leaves once. A removed member cannot come back with an invite made before the removal, but can with a new one.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 20, root })
    put(c, "join-bob", "bob", "club.join", join("bob"), { at: 21, root })
    put(c, "owner-leaves", "owner", "club.leave", {}, { at: 30, root })
    put(c, "bob-leaves", "bob", "club.leave", {}, { at: 31, root })
    put(c, "bob-leaves-again", "bob", "club.leave", {}, { at: 32, root })
    put(c, "remove-alice", "owner", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 40, root })
    put(c, "alice-old-invite", "alice", "club.join", join("alice"), { at: 50, root })
    put(c, "invite-2", "owner", "club.invite", invite(INV2, T2), { at: 60, root, seal: "club" })
    put(c, "alice-new-invite", "alice", "club.join", join("alice", INV2, T2), { at: 70, root })
    put(c, "bob-returns", "bob", "club.join", join("bob", INV2, T2), { at: 80, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "join-bob", "bob-leaves", "remove-alice", "invite-2", "alice-new-invite", "bob-returns"],
        rejected: [
          ["owner-leaves", "owner_cannot_leave"],
          ["bob-leaves-again", "not_member"],
          ["alice-old-invite", "removed_requires_new_invite"],
        ],
        state: { members: { owner: "owner", alice: "member", bob: "member" } },
      }),
    )
  }
  {
    const c = newCase("key-rotation", "Only the owner rotates the club key, one epoch at a time.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-admin", "admin", "club.join", join("admin"), { at: 20, root })
    put(c, "make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 30, root })
    put(c, "rotate-1", "owner", "club.key", { epoch: 1, key: pub("club-2"), wraps: [encryptTo("owner", "admin", sec("club-2"))] }, { at: 40, root })
    put(c, "rotate-skip", "owner", "club.key", { epoch: 3, key: pub("club-3"), wraps: [] }, { at: 50, root })
    put(c, "admin-rotates", "admin", "club.key", { epoch: 2, key: pub("club-3"), wraps: [] }, { at: 60, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "make-admin", "rotate-1"],
        rejected: [
          ["rotate-skip", "epoch_mismatch"],
          ["admin-rotates", "not_authorized"],
        ],
        state: { keyEpoch: 1, key: pub("club-2") },
      }),
    )
  }
  {
    const SEASON = hex16("season-1")
    const rules: ContentOf<"club.season">["rules"] = { modes: ["501"], points: { win: 2, draw: 1, loss: 0 }, confirmations: "opponent", minGames: 5, tiebreak: ["wins", "legDifference"] }
    const c = newCase("season-rules", "Season rules are versioned: free changes before the start, after it only with a visible reason, one version at a time, none after the end.", { group: "club" })
    put(c, "found", "owner", "club.found", club(), { at: 0, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 1, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 2, root })
    put(c, "season", "owner", "club.season", { season: SEASON, name: "Herbst 2025", starts: at(1000), rules }, { at: 10, root })
    put(c, "member-season", "alice", "club.season", { season: hex16("season-2"), name: "Eigene Saison", starts: at(1000), rules }, { at: 11, root })
    put(c, "v2-before", "owner", "club.season.rules", { season: SEASON, version: 2, rules: { ...rules, minGames: 3 } }, { at: 20, root })
    put(c, "v3-silent", "owner", "club.season.rules", { season: SEASON, version: 3, rules: { ...rules, minGames: 1 } }, { at: 1100, root })
    put(c, "v3-reason", "owner", "club.season.rules", { season: SEASON, version: 3, rules: { ...rules, minGames: 1 }, reason: "Beschluss Clubabend 14.10." }, { at: 1110, root })
    put(c, "v5-skip", "owner", "club.season.rules", { season: SEASON, version: 5, rules, reason: "Sprung" }, { at: 1120, root })
    put(c, "end", "owner", "club.season.end", { season: SEASON }, { at: 1200, root })
    put(c, "after-end", "owner", "club.season.rules", { season: SEASON, version: 4, rules, reason: "Zu spät" }, { at: 1300, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "season", "v2-before", "v3-reason", "end"],
        rejected: [
          ["member-season", "not_authorized"],
          ["v3-silent", "rules_change_needs_reason"],
          ["v5-skip", "season_version_mismatch"],
          ["after-end", "season_ended"],
        ],
        state: { seasons: { [SEASON]: { versions: 3, ended: true } } },
      }),
    )
  }
  {
    const c = newCase("unknown-version-and-time", "A change in a newer format version is kept, not executed. A record dated more than 15 minutes ahead of the reader's clock and one dated before the founding are refused.", {
      group: "club",
      now: at(5000),
    })
    put(c, "found", "owner", "club.found", club(), { at: 1000, seal: "club" })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "update-v2", "owner", "club.update", { prev: root, name: "Version 2" }, { at: 1010, root, version: "2" })
    put(c, "update-v1", "owner", "club.update", { prev: root, name: "Dartfreunde Nord e.V." }, { at: 1020, root })
    put(c, "future", "owner", "club.update", { prev: c.id("update-v1"), about: "Aus der Zukunft" }, { at: 5000 + 901, root })
    put(c, "too-early", "owner", "club.update", { prev: root, about: "Vor der Gründung" }, { at: 900, root })
    cases.push(
      c.done({
        applied: ["found", "update-v1"],
        rejected: [
          ["future", "future_timestamp"],
          ["too-early", "before_founding"],
        ],
        unapplied: [["update-v2", "unknown"]],
        state: { name: "Dartfreunde Nord e.V." },
      }),
    )
  }
  {
    const c = newCase("reader-without-club-key", "A public club read by an outsider: invites are always encrypted, so a join with an invite waits like a request until the leadership accepts it.", { open: false })
    put(c, "found", "owner", "club.found", club({ visibility: "public" }), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "invite", "owner", "club.invite", invite(), { at: 10, root, seal: "club" })
    put(c, "join-alice", "alice", "club.join", join("alice"), { at: 20, root })
    put(c, "join-bob", "bob", "club.join", join("bob"), { at: 21, root })
    put(c, "accept-alice", "owner", "club.accept", { request: c.id("join-alice"), member: pub("alice") }, { at: 30, root })
    cases.push(
      c.done({
        applied: ["found", "join-alice", "join-bob", "accept-alice"],
        rejected: [],
        unapplied: [["invite", "sealed"]],
        state: { members: { owner: "owner", alice: "member" }, requests: ["bob"] },
      }),
    )
  }
  return cases
}

// ---- Tournament -----------------------------------------------------------------------------------

const rules501: ContentOf<"tournament.found">["rules"] = {
  type: "x01",
  modeId: "501",
  startScore: 501,
  doubleIn: false,
  doubleOut: true,
  cutThroat: false,
  bullFinish: false,
  legsToWin: 2,
  setsToWin: 1,
  startRule: "alternate",
}
const SEED = hex32("seed-1")
const cup = (extra: Partial<ContentOf<"tournament.found">> = {}): ContentOf<"tournament.found"> => ({
  name: "Herbstcup",
  format: "single_ko",
  rules: rules501,
  capacity: 4,
  admission: "auto",
  waitlist: true,
  checkIn: true,
  approval: "organizer",
  starts: at(7200),
  timezone: "Europe/Berlin",
  seedCommit: commit(SEED),
  ...extra,
})

function tournamentCases() {
  const cases = []
  const G = hex16("guest-1")
  {
    const c = newCase("registration-waitlist", "Two places: the third registration goes to the waiting list and moves up when a player withdraws. Registering twice, and after registration closed, is refused.")
    put(c, "found", "organizer", "tournament.found", cup({ capacity: 2 }), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "p1", "p1", "tournament.register", { alias: "Mia" }, { at: 10, root })
    put(c, "p2", "p2", "tournament.register", {}, { at: 20, root })
    put(c, "p3", "p3", "tournament.register", {}, { at: 30, root })
    put(c, "p1-withdraws", "p1", "tournament.withdraw", { reason: "krank" }, { at: 40, root })
    put(c, "p2-again", "p2", "tournament.register", {}, { at: 45, root })
    put(c, "p4", "p4", "tournament.register", {}, { at: 50, root })
    put(c, "checkin", "organizer", "tournament.phase", { phase: "checkin", prev: root }, { at: 60, root })
    put(c, "p5-late", "p5", "tournament.register", {}, { at: 70, root })
    cases.push(
      c.done({
        applied: ["found", "p1", "p2", "p3", "p1-withdraws", "p4", "checkin"],
        rejected: [
          ["p2-again", "already_registered"],
          ["p5-late", "registration_closed"],
        ],
        state: { phase: "checkin", participants: { p1: "withdrawn", p2: "registered", p3: "registered", p4: "waitlist" } },
      }),
    )
  }
  {
    const c = newCase("full-without-waitlist", "No waiting list: a registration beyond capacity is refused; manual admission keeps registrations waiting for the organizer.")
    put(c, "found", "organizer", "tournament.found", cup({ capacity: 2, waitlist: false }), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "p1", "p1", "tournament.register", {}, { at: 10, root })
    put(c, "p2", "p2", "tournament.register", {}, { at: 20, root })
    put(c, "p3", "p3", "tournament.register", {}, { at: 30, root })
    cases.push(c.done({ applied: ["found", "p1", "p2"], rejected: [["p3", "tournament_full"]], state: { participants: { p1: "registered", p2: "registered" } } }))
  }
  {
    const c = newCase("guests-and-claims", "The organizer adds a guest under an alias. A guest place is linked to a player only after that player claimed it; only the organizer adds guests.")
    put(c, "found", "organizer", "tournament.found", cup(), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "guest", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 10, root })
    put(c, "link-unclaimed", "organizer", "tournament.link", { guest: G, player: pub("p1"), prev: c.id("guest") }, { at: 20, root })
    put(c, "claim", "p1", "tournament.claim", { guest: G }, { at: 30, root })
    put(c, "link", "organizer", "tournament.link", { guest: G, player: pub("p1"), prev: c.id("guest") }, { at: 40, root })
    put(c, "mallory-guest", "mallory", "tournament.guest", { guest: hex16("guest-2"), alias: "Gast 2" }, { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "guest", "claim", "link"],
        rejected: [
          ["link-unclaimed", "not_authorized"],
          ["mallory-guest", "not_authorized"],
        ],
        state: { participants: { [G]: "registered" }, linked: { [G]: "p1" } },
      }),
    )
  }
  {
    const c = newCase("checkin-and-draw", "Check-in, then the draw opens the seed committed at the founding. The field is everyone admitted and checked in; a wrong seed, a wrong field and a second draw without a new commitment are refused.")
    put(c, "found", "organizer", "tournament.found", cup(), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "p1", "p1", "tournament.register", {}, { at: 10, root })
    put(c, "p2", "p2", "tournament.register", {}, { at: 11, root })
    put(c, "p3", "p3", "tournament.register", {}, { at: 12, root })
    put(c, "guest", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 13, root })
    put(c, "checkin", "organizer", "tournament.phase", { phase: "checkin", prev: root }, { at: 20, root })
    put(c, "in-p1", "p1", "tournament.checkin", {}, { at: 30, root })
    put(c, "in-p2", "p2", "tournament.checkin", {}, { at: 31, root })
    put(c, "in-guest", "organizer", "tournament.checkin", { participant: G, prev: c.id("guest") }, { at: 32, root })
    put(c, "in-mallory", "mallory", "tournament.checkin", {}, { at: 33, root })
    const field = [pub("p1"), pub("p2"), G]
    put(c, "draw-wrong-seed", "organizer", "tournament.draw", { seed: hex32("other-seed"), seeded: [], order: order(hex32("other-seed"), field), prev: c.id("checkin") }, { at: 40, root })
    put(c, "draw-wrong-field", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [...field, pub("p3")]), prev: c.id("checkin") }, { at: 41, root })
    put(c, "draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, field), prev: c.id("checkin") }, { at: 42, root })
    put(c, "redraw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, field), prev: c.id("draw") }, { at: 50, root })
    cases.push(
      c.done(
        {
          applied: ["found", "p1", "p2", "p3", "guest", "checkin", "in-p1", "in-p2", "in-guest", "draw"],
          rejected: [
            ["in-mallory", "not_registered"],
            ["draw-wrong-seed", "seed_mismatch"],
            ["draw-wrong-field", "draw_mismatch"],
            ["redraw", "seed_not_committed"],
          ],
          state: { phase: "drawn", order: order(SEED, field), checkedIn: [pub("p1"), pub("p2"), G] },
        },
        { seed: SEED, field },
      ),
    )
  }
  {
    const c = newCase("boards-and-results", "Boards submit results only for slots assigned to them; the organizer approves and corrects. A correction marks the next match built on it as affected.")
    put(c, "found", "organizer", "tournament.found", cup({ capacity: 4, checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "p1", "p1", "tournament.register", {}, { at: 10, root })
    put(c, "p2", "p2", "tournament.register", {}, { at: 11, root })
    put(c, "draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [pub("p1"), pub("p2")]), prev: root }, { at: 20, root })
    const B1 = hex16("board-1")
    const B2 = hex16("board-2")
    put(c, "board-1", "organizer", "tournament.board", { board: B1, name: "Board 1", key: pub("board1"), prev: root }, { at: 30, root })
    put(c, "board-2", "organizer", "tournament.board", { board: B2, name: "Board 2", key: pub("board2"), prev: root }, { at: 31, root })
    put(c, "assign", "organizer", "tournament.assign", { slot: "R1-1", board: B1, prev: root }, { at: 40, root })
    put(c, "assign-next", "organizer", "tournament.assign", { slot: "R2-1", board: B2, prev: root }, { at: 41, root })
    put(c, "early-result", "board1", "tournament.result", { slot: "R1-1", winner: pub("p1"), score: [2, 1] }, { at: 45, root })
    put(c, "start", "organizer", "tournament.phase", { phase: "running", prev: c.id("draw") }, { at: 50, root })
    put(c, "wrong-board", "board2", "tournament.result", { slot: "R1-1", winner: pub("p2"), score: [0, 2] }, { at: 60, root })
    put(c, "stranger", "mallory", "tournament.result", { slot: "R1-1", winner: pub("p2"), score: [0, 2] }, { at: 61, root })
    put(c, "result", "board1", "tournament.result", { slot: "R1-1", winner: pub("p1"), score: [2, 1] }, { at: 70, root })
    put(c, "approve", "organizer", "tournament.approve", { slot: "R1-1", submission: c.id("result"), prev: c.id("assign") }, { at: 80, root })
    put(c, "result-again", "board1", "tournament.result", { slot: "R1-1", winner: pub("p2"), score: [1, 2] }, { at: 90, root })
    put(c, "correct", "organizer", "tournament.correct", { slot: "R1-1", winner: pub("p2"), score: [1, 2], reason: "Leg 2 falsch eingetragen", prev: c.id("approve") }, { at: 100, root })
    cases.push(
      c.done(
        {
          applied: ["found", "p1", "p2", "draw", "board-1", "board-2", "assign", "assign-next", "start", "result", "approve", "correct"],
          rejected: [
            ["early-result", "phase_invalid"],
            ["wrong-board", "board_not_assigned"],
            ["stranger", "not_authorized"],
            ["result-again", "already_approved"],
          ],
          state: { phase: "running", slots: { "R1-1": { winner: pub("p2"), corrected: true }, "R2-1": { affected: true } } },
        },
        { dependents: { "R1-1": ["R2-1"] } },
      ),
    )
  }
  {
    const c = newCase("organizer-handover", "The organization changes only by offer and acceptance. Afterwards the former organizer's decisions are refused.")
    put(c, "found", "organizer", "tournament.found", cup(), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "offer", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root }, { at: 10, root })
    put(c, "mallory-accepts", "mallory", "tournament.handover.accept", { offer: c.id("offer") }, { at: 20, root })
    put(c, "accept", "organizer2", "tournament.handover.accept", { offer: c.id("offer") }, { at: 30, root })
    put(c, "old-organizer", "organizer", "tournament.phase", { phase: "checkin", prev: root }, { at: 40, root })
    put(c, "new-organizer", "organizer2", "tournament.phase", { phase: "checkin", prev: root }, { at: 50, root })
    put(c, "player-admits", "p1", "tournament.admit", { participant: pub("p1"), prev: root }, { at: 60, root })
    cases.push(
      c.done({
        applied: ["found", "offer", "accept", "new-organizer"],
        rejected: [
          ["mallory-accepts", "not_authorized"],
          ["old-organizer", "not_authorized"],
          ["player-admits", "not_authorized"],
        ],
        state: { organizer: "organizer2", phase: "checkin" },
      }),
    )
  }
  {
    const c = newCase("rules-locked-and-unknown", "Rules cannot change once drawn, details can. A registration in a newer format version is kept, not executed.")
    put(c, "found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.id("found")
    put(c, "p1", "p1", "tournament.register", {}, { at: 10, root })
    put(c, "p2", "p2", "tournament.register", {}, { at: 11, root })
    put(c, "p3-v2", "p3", "tournament.register", {}, { at: 12, root, version: "2" })
    put(c, "draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [pub("p1"), pub("p2")]), prev: root }, { at: 20, root })
    put(c, "rules", "organizer", "tournament.update", { prev: c.id("draw"), rules: { ...rules501, legsToWin: 3 } }, { at: 30, root })
    put(c, "place", "organizer", "tournament.update", { prev: c.id("draw"), place: "Vereinsheim, Saal 2" }, { at: 31, root })
    cases.push(
      c.done({
        applied: ["found", "p1", "p2", "draw", "place"],
        rejected: [["rules", "rules_locked"]],
        unapplied: [["p3-v2", "unknown"]],
        state: { phase: "drawn", place: "Vereinsheim, Saal 2" },
      }),
    )
  }
  return cases
}

// ---- Match: session authorization, live snapshot, result -------------------------------------------

const agreement = (extra: Partial<ContentOf<"match.session">["agreement"] & object> = {}) => ({
  engine: ENGINE_VERSION,
  rules: { ...rules501, legsToWin: 1 },
  seats: [
    { alias: "Mia", pubkey: pub("p1") },
    { alias: "Jonas", pubkey: pub("p2") },
  ],
  visibility: "public" as const,
  ...extra,
})

const gameConfig = () => config({ startScore: 501, legsToWin: 1 })
const sampleLog = (): Throw[] => play(gameConfig(), [dart(20, 3), dart(20, 3), dart(20, 3), dart(19), dart(19), dart(19), dart(20, 3), dart(20), dart(5)])

function snapshot(author: string, root: string, auth: SignedEvent, sv: number, n: number, atSeconds: number, version?: string) {
  const log = sampleLog().slice(0, Math.min(9, 3 * n))
  const content = liveContent({ state: replay(gameConfig(), log), throws: log, sv, n, status: "playing", auth })
  return record(author, "match.live", content, { at: atSeconds, root, d: root, version })
}

function result(author: string, root: string, sv: number, atSeconds: number, extra: Partial<ContentOf<"match.result">> = {}) {
  return record(author, "match.result", { sv, status: "finished", winner: 0, legs: [1, 0], throws: encodeThrows(sampleLog()), finishedAt: at(atSeconds), ...extra }, { at: atSeconds, root })
}

function matchCases() {
  const cases = []
  const session = (sv: number, key: string, from: number, prev?: string, extra: Record<string, unknown> = {}) => ({
    sv,
    session: pub(key),
    from: at(from),
    until: at(from + 3 * 3600),
    ...(prev ? { prev } : { agreement: agreement() }),
    ...extra,
  })
  {
    const c = newCase("session-handover", "The match moves to another device: session 2 replaces session 1. From the handover on, session 1's snapshots and results are refused.")
    const found = put(c, "found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    c.add("live-1", snapshot("session1", root, found, 1, 1, 100).event)
    const hand = put(c, "handover", "host", "match.session", session(2, "session2", 200, root), { at: 200, root })
    c.add("live-2", snapshot("session2", root, hand, 2, 2, 210).event)
    c.add("live-old", snapshot("session1", root, found, 1, 3, 220).event)
    c.add("result-old", result("session1", root, 1, 230, { auth: found }).event)
    c.add("result", result("session2", root, 2, 240, { auth: hand }).event)
    cases.push(
      c.done({
        applied: ["found", "live-1", "handover", "live-2", "result"],
        rejected: [
          ["live-old", "session_superseded"],
          ["result-old", "session_superseded"],
        ],
        state: { sv: 2, writer: "session2", live: "live-2", result: "result" },
      }),
    )
  }
  {
    const c = newCase("forged-handover", "Only the match authority hands over, always to the next session on top of the current one; strangers cannot write.")
    const found = put(c, "found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    put(c, "by-session", "session1", "match.session", session(2, "session2", 100, root), { at: 100, root })
    put(c, "skip", "host", "match.session", session(3, "session2", 110, root), { at: 110, root })
    put(c, "wrong-prev", "host", "match.session", session(2, "session2", 120, hex32("not-a-session")), { at: 120, root })
    c.add("stranger-live", snapshot("mallory", root, found, 1, 1, 130).event)
    cases.push(
      c.done({
        applied: ["found"],
        rejected: [
          ["by-session", "not_authorized"],
          ["skip", "stale_predecessor"],
          ["wrong-prev", "stale_predecessor"],
          ["stranger-live", "not_authorized"],
        ],
        state: { sv: 1, writer: "session1" },
      }),
    )
  }
  {
    const c = newCase("session-window", "A session writes only inside its window, and a snapshot must carry its own session's authorization.")
    const found = put(c, "found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    const hand = put(c, "handover", "host", "match.session", session(2, "session2", 100, root), { at: 100, root })
    c.add("wrong-auth", snapshot("session2", root, found, 2, 1, 110).event)
    c.add("live", snapshot("session2", root, hand, 2, 2, 120).event)
    c.add("too-late", snapshot("session2", root, hand, 2, 3, 100 + 3 * 3600 + 1).event)
    cases.push(
      c.done({
        applied: ["found", "handover", "live"],
        rejected: [
          ["wrong-auth", "session_mismatch"],
          ["too-late", "session_expired"],
        ],
        state: { live: "live" },
      }),
    )
  }
  {
    const c = newCase("confirm-and-correct", "Players confirm or dispute one exact result. A correction replaces it and its verdicts no longer count; only seated players give verdicts; a second result must name the one it replaces.")
    const found = put(c, "found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    c.add("result-1", result("session1", root, 1, 100, { auth: found }).event)
    put(c, "p1-confirms", "p1", "match.confirm", { result: c.id("result-1"), verdict: "confirm", seat: 0 }, { at: 110, root })
    put(c, "p2-disputes", "p2", "match.confirm", { result: c.id("result-1"), verdict: "dispute", seat: 1, reason: "Letzte Aufnahme war 45" }, { at: 111, root })
    put(c, "mallory-confirms", "mallory", "match.confirm", { result: c.id("result-1"), verdict: "confirm", seat: 0 }, { at: 112, root })
    c.add("unlinked", result("host", root, 1, 115).event)
    c.add("result-2", result("host", root, 1, 120, { replaces: c.id("result-1"), reason: "Aufnahme korrigiert", legs: [0, 1], winner: 1 }).event)
    put(c, "p2-confirms", "p2", "match.confirm", { result: c.id("result-2"), verdict: "confirm", seat: 1 }, { at: 130, root })
    cases.push(
      c.done({
        applied: ["found", "result-1", "p1-confirms", "p2-disputes", "result-2", "p2-confirms"],
        rejected: [
          ["mallory-confirms", "not_a_player"],
          ["unlinked", "stale_predecessor"],
        ],
        state: { result: "result-2", confirmations: { 1: "confirm" }, stale: 2 },
      }),
    )
  }
  {
    const c = newCase("public-stake", "A stake is only written into a private, encrypted match; a public founding with a stake is invalid, so no match exists.")
    // buildRecord refuses to write this; a careless or hostile client might.
    const template = buildRecord("match.session", session(1, "session1", 0), { created_at: at(0) })
    const content = JSON.parse(template.content)
    content.agreement.stake = { msat: 500000 }
    c.add("found", sign("host", { ...template, content: JSON.stringify(content) }))
    c.setRoot("found")
    cases.push(c.done({ problem: "invalid" }))
  }
  {
    const c = newCase("private-match", "A private match: founding and snapshots are encrypted to the match key from the link; the agreed stake is inside.", { group: "matchkey" })
    const found = put(c, "found", "host", "match.session", session(1, "session1", 0, undefined, { agreement: agreement({ visibility: "private", stake: { msat: 500000, note: "Verlierer zahlt" } }) }), {
      at: 0,
      seal: "matchkey",
    })
    c.setRoot("found")
    const root = found.id
    const live = snapshot("session1", root, found, 1, 1, 100)
    const sealedLive = sealTemplate(
      { kind: live.event.kind, created_at: live.event.created_at, tags: live.event.tags, content: live.event.content },
      pub("matchkey"),
      encryptTo("session1", "matchkey", live.event.content),
    )
    c.add("live", sign("session1", sealedLive), live.event.content)
    cases.push(c.done({ applied: ["found", "live"], rejected: [], state: { stake: 500000, live: "live" } }))
  }
  {
    const c = newCase("chunked-log", "A long throw log travels in hash-chained pieces; the result names the chain's head, piece count and size.")
    const found = put(c, "found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    const legs: Throw[] = []
    for (let i = 0; i < 40; i++) legs.push(dart(1), dart(1), dart(1))
    const log = play(config({ startScore: 501, legsToWin: 1 }), [...legs.slice(0, 120), ...miss3()])
    const text = encodeThrows(log)
    const { chunks, head, bytes } = chunkData(text, 64)
    chunks.forEach((piece, i) => put(c, `log-${i}`, "session1", "match.log", piece, { at: 100 + i, root }))
    c.add("result", result("session1", root, 1, 200, { auth: found, throws: undefined, log: { head, total: chunks.length, bytes }, status: "finished", winner: null, legs: [0, 0] }).event)
    cases.push(c.done({ applied: ["found", ...chunks.map((_, i) => `log-${i}`), "result"], rejected: [], state: { result: "result", log: { head, pieces: chunks.length, text } } }))
  }
  {
    const c = newCase("unknown-version", "A snapshot in a newer format version is kept, not executed.")
    const found = put(c, "found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    c.add("live-v2", snapshot("session1", found.id, found, 1, 1, 100, "2").event)
    cases.push(c.done({ applied: ["found"], rejected: [], unapplied: [["live-v2", "unknown"]], state: { live: null } }))
  }
  return cases
}

// ---- Payment requests ------------------------------------------------------------------------------

// BOLT-11 specification example ("1 cup coffee", 2500u, expiry 60 s), decoded independently.
const INVOICE =
  "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp"
const INVOICE_DECODED = { amountMsat: 250000000, paymentHash: "0001020304050607080900010203040506070809000102030405060708090102", expiresAt: 1496314718 }

function paymentCases() {
  const match = hex32("payment-match")
  const now = 1496314670
  const stakeAgreement = agreement({ visibility: "private", stake: { msat: 250000000 } })
  const content = (extra: Partial<ContentOf<"payment.request">> = {}): ContentOf<"payment.request"> => ({
    amount: 250000000,
    invoice: INVOICE,
    hash: INVOICE_DECODED.paymentHash,
    expires: 1496314700,
    seat: 0,
    memo: "501, Verlierer zahlt",
    ...extra,
  })
  const rumor = (author: string, c: ContentOf<"payment.request">, opts: { version?: string; payer?: string } = {}) => {
    usedKeys.add(author)
    const t = paymentRequestRumor(c, { match, payer: pub(opts.payer ?? "p2"), created_at: now - 5 })
    const tags = opts.version ? t.tags.map((x) => (x[0] === "v" ? ["v", opts.version as string] : x)) : t.tags
    const unsigned = { ...t, tags, pubkey: pub(author) }
    return { ...unsigned, id: getEventHash(unsigned) }
  }
  const one = (name: string, description: string, r: ReturnType<typeof rumor>, expect: { ok: true } | { ok: false; reason: string }, extra: Record<string, unknown> = {}) => ({
    name,
    description,
    now,
    match,
    payer: pub("p2"),
    sealPubkey: r.pubkey,
    agreement: stakeAgreement,
    invoice: INVOICE_DECODED,
    ...extra,
    rumor: r,
    expect,
  })
  const tampered = { ...rumor("p1", content()), content: JSON.stringify(content({ memo: "geändert" })) }
  return [
    one("valid", "Mia asks Jonas for the agreed stake; the invoice matches amount and hash and is still valid.", rumor("p1", content()), { ok: true }),
    one("session-key-requests", "The board's session key tries to request a payment: it is no player.", rumor("session1", content()), { ok: false, reason: "not_a_player" }),
    one("seal-differs", "The seal is signed by someone other than the request's author.", rumor("p1", content()), { ok: false, reason: "not_authorized" }, { sealPubkey: pub("mallory") }),
    one("wrong-amount", "The amount differs from the agreed stake.", rumor("p1", content({ amount: 300000000 })), { ok: false, reason: "amount_mismatch" }),
    one("hash-differs", "The request names another payment hash than the invoice.", rumor("p1", content({ hash: hex32("other-hash") })), { ok: false, reason: "invoice_mismatch" }),
    one("expired", "Checked after the invoice expired.", rumor("p1", content()), { ok: false, reason: "invoice_expired" }, { now: 1496314720 }),
    one("other-seat", "Mia claims Jonas' seat.", rumor("p1", content({ seat: 1 })), { ok: false, reason: "not_a_player" }),
    one("newer-version", "A request in a newer format version is not executed.", rumor("p1", content(), { version: "2" }), { ok: false, reason: "unknown_version" }),
    one("tampered-id", "The rumor's id does not match its content (nostr-core's unwrap does not check this).", tampered, { ok: false, reason: "invalid_event" }),
  ]
}

// ---- Badges ----------------------------------------------------------------------------------------

function badgeCases() {
  const tournament = hex32("badge-tournament")
  const resultId = hex32("badge-result")
  const defTournament = sign("organizer", badgeDefinitionTemplate({ badge: "tournament-winner", version: 1, scope: "tournament", scopeId: tournament, name: "Turniersieg", description: "Hat das Turnier gewonnen." }, at(10)))
  const defSelf = sign("p1", badgeDefinitionTemplate({ badge: "first-180", version: 1, scope: "self", name: "Erste 180", description: "Drei Triple-20 in einer Aufnahme." }, at(20)))
  const defClub = sign("owner", badgeDefinitionTemplate({ badge: "season-winner", version: 1, scope: "club", scopeId: hex32("badge-club"), name: "Saisonsieg", description: "Hat die Saison gewonnen." }, at(30)))
  const dT = badgeD({ badge: "tournament-winner", version: 1, scope: "tournament", scopeId: tournament })
  const dS = badgeD({ badge: "first-180", version: 1, scope: "self" })
  const dC = badgeD({ badge: "season-winner", version: 1, scope: "club", scopeId: hex32("badge-club") })
  const award = (issuer: string, d: string, recipient: string, occasion: string, seconds: number, evidence = resultId) =>
    sign(issuer, badgeAwardTemplate({ issuer: pub(issuer), d, recipient: pub(recipient), evidence, occasion }, at(seconds)))
  const forged = sign("mallory", badgeAwardTemplate({ issuer: pub("organizer"), d: dT, recipient: pub("mallory"), evidence: resultId, occasion: tournament }, at(40)))
  const noRecipient = sign("organizer", { ...badgeAwardTemplate({ issuer: pub("organizer"), d: dT, recipient: pub("p1"), evidence: resultId, occasion: tournament }, at(41)), tags: [["a", `30009:${pub("organizer")}:${dT}`], ["e", resultId], ["occasion", tournament], ["L", "blueline"], ["l", "badge.award", "blueline"], ["v", "1"]] })
  const first = award("organizer", dT, "p1", tournament, 50)
  const resigned = award("organizer", dT, "p1", tournament, 60)
  const ctx = { mayIssue: [["tournament", tournament, pub("organizer")]], voided: [hex32("voided-result")] }
  const cases = [
    { name: "organizer-award", description: "The organizer awards the tournament win.", definition: defTournament, award: first, expect: { ok: true, self: false } },
    { name: "forged-issuer", description: "Mallory signs an award pointing at the organizer's badge: refused (nostr-core 1.0.4 would accept it).", definition: defTournament, award: forged, expect: { ok: false, reason: "issuer_mismatch" } },
    { name: "self-earned", description: "A player shows a milestone as 'Selbst erreicht', with the match result as evidence.", definition: defSelf, award: award("p1", dS, "p1", "once", 70), expect: { ok: true, self: true } },
    { name: "self-for-other", description: "A self-earned badge given to someone else.", definition: defSelf, award: award("p1", dS, "p2", "once", 71), expect: { ok: false, reason: "issuer_mismatch" } },
    { name: "club-not-issuer", description: "A club badge from someone the club state does not name as issuer.", definition: defClub, award: award("owner", dC, "p1", hex16("season-1"), 72), expect: { ok: false, reason: "not_authorized" } },
    { name: "no-recipient", description: "An award without recipient.", definition: defTournament, award: noRecipient, expect: { ok: false, reason: "recipient_missing" } },
    { name: "evidence-voided", description: "The result the award rests on was voided since.", definition: defTournament, award: award("organizer", dT, "p2", tournament, 80, hex32("voided-result")), expect: { ok: false, reason: "evidence_revoked" } },
    { name: "duplicate", description: "The same award re-signed later counts once: the first in replay order.", definition: defTournament, award: resigned, duplicateOf: first.id, expect: { ok: true, self: false } },
  ]
  return { context: ctx, cases }
}

// ---- Pairing and board join ------------------------------------------------------------------------

function pairingVectors() {
  const now = at(500)
  const sid = hex16("pair-session")
  const secret = hexToBytes("0123456789abcdef")
  const keys = pairingCodeKeys(secret)
  const newDev = "new-device"
  const oldDev = "old-device"
  const msg = (from: string, to: string, message: Parameters<typeof pairingPlaintext>[0], seconds: number) => {
    const plaintext = pairingPlaintext(message)
    return { event: sign(from, pairingTemplate({ message, created_at: at(seconds), recipient: pub(to), ciphertext: encryptTo(from, to, plaintext) })), plaintext }
  }
  const announce = { t: "announce" as const, sid, exp: now + 300, mac: announceMac(keys.auth, pub(newDev), sid, now + 300) }
  const steps = {
    announce: { event: sign(newDev, pairingTemplate({ message: announce, created_at: at(400), lookup: keys.lookup })), plaintext: pairingPlaintext(announce) },
    hello: msg(oldDev, newDev, { t: "hello", sid, device: "iPhone von Mia", mac: helloMac(keys.auth, pub(oldDev), pub(newDev), sid) }, 410),
    helloAttacker: msg("attacker", newDev, { t: "hello", sid, device: "iPhone von Mia" }, 411),
    accept: msg(newDev, oldDev, { t: "accept", sid, device: "iPad Wohnzimmer" }, 420),
    package: msg(oldDev, newDev, { t: "package", sid, data: { v: 1, profile: "lib/devices defines this", relays: ["wss://nos.lol"] } }, 430),
    ack: msg(newDev, oldDev, { t: "ack", sid, hash: bytesToHex(sha256(utf8ToBytes(JSON.stringify({ v: 1, profile: "lib/devices defines this", relays: ["wss://nos.lol"] })))) }, 440),
    boardJoin: {
      event: sign(newDev, boardTemplate({ recipient: pub(oldDev), ciphertext: encryptTo(newDev, oldDev, boardPlaintext({ t: "join", sid, seat: 0, confirm: true })), created_at: at(450) })),
      plaintext: boardPlaintext({ t: "join", sid, seat: 0, confirm: true }),
    },
  }
  return {
    now,
    sid,
    code: { secret: bytesToHex(secret), code: encodePairingCode(secret), lookup: keys.lookup, auth: keys.auth },
    checkCode: { newDevice: pub(newDev), existingDevice: pub(oldDev), sid, code: pairingCheckCode(pub(newDev), pub(oldDev), sid) },
    links: {
      pair: encodeLinkPayload({ type: "pair", pubkey: pub(newDev), sid, expires: now + 300, relays: ["wss://nos.lol", "wss://relay.primal.net"] }),
      board: encodeLinkPayload({ type: "board", pubkey: pub("board1"), sid, expires: now + 3000, relays: ["wss://nos.lol"] }),
      watch: encodeLinkPayload({ type: "watch", match: hex32("watch-match"), key: sec("matchkey"), relays: ["wss://nos.lol"] }),
      club: encodeLinkPayload({ type: "club", club: hex32("link-club"), invite: hex16("invite-1"), token: hex16("token-1"), secret: sec("club"), relays: ["ws://localhost:10547"] }),
    },
    steps,
  }
}

function boardVectors() {
  const now = at(600)
  const sid = hex16("board-session")
  const join = (from: string, message: Parameters<typeof boardPlaintext>[0] | Record<string, unknown>, seconds: number) => {
    const plaintext = JSON.stringify(message)
    return { event: sign(from, boardTemplate({ recipient: pub("board1"), ciphertext: encryptTo(from, "board1", plaintext), created_at: at(seconds) })), plaintext }
  }
  const seatPlain = boardPlaintext({ t: "seat", sid, seat: 0 })
  return {
    now,
    sid,
    expires: now + 1800,
    steps: {
      join: join("p1", { t: "join", sid, seat: 0, alias: "Mia", confirm: true }, 590),
      seat: { event: sign("board1", boardTemplate({ recipient: pub("p1"), ciphertext: encryptTo("board1", "p1", seatPlain), created_at: at(591) })), plaintext: seatPlain },
      joinTaken: join("p2", { t: "join", sid, seat: 0, confirm: false }, 592),
      smuggled: join("p2", { t: "join", sid, seat: 1, confirm: false, nsec: "nsec1…" }, 593),
      packageToBoard: join("p2", { t: "package", sid, data: { key: "…" } }, 594),
    },
  }
}

// ---- Private records, invites, chunks ---------------------------------------------------------------

function privateVectors() {
  const dataKey = hex32("data-key")
  const slot = recordSlot(dataKey, "match:7d1c0b6c2f0a4c4b")
  const nonce = nonceFor("private-nonce").slice(0, 24)
  const fakeCiphertext = nonceFor("private-ct")
  const content = encodeEnvelope(nonce, fakeCiphertext)
  return {
    dataKey,
    records: [
      { id: "match:7d1c0b6c2f0a4c4b", slot },
      { id: "players", slot: recordSlot(dataKey, "players") },
      { id: "players#1", slot: recordSlot(dataKey, "players#1") },
    ],
    dataKeySlot: { pubkey: pub("p1"), slot: dataKeySlot(pub("p1")) },
    envelope: { nonce: bytesToHex(nonce), ciphertext: bytesToHex(fakeCiphertext), content },
    events: {
      valid: sign("p1", privateTemplate(slot, content, at(700))),
      labelled: sign("p1", { ...privateTemplate(slot, content, at(701)), tags: [["d", slot], ["l", "match", "blueline"]] }),
    },
  }
}

const inviteVectors = () => [
  { token: hex16("token-1"), pubkey: pub("alice"), proof: proof(hex16("token-1"), pub("alice")) },
  { token: hex16("token-1"), pubkey: pub("bob"), proof: proof(hex16("token-1"), pub("bob")) },
  { token: hex16("token-2"), pubkey: pub("alice"), proof: proof(hex16("token-2"), pub("alice")) },
]

function chunkVectors() {
  const data = `1${"5".repeat(150)}.${"ä".repeat(20)}`
  const { chunks, head, bytes } = chunkData(data, 40)
  return { data, budget: 40, head, bytes, chunks }
}

// ---- Output ---------------------------------------------------------------------------------------

const header = (family: string, description: string) => ({
  family,
  description,
  generator: "tests/support/make-vectors.ts",
  format: "Events are signed (BIP-340, zero aux randomness) with keys derived as sha256('blueline-vector:' + name). Expected outcomes are written by hand from docs/protocol.",
})

function keyTable() {
  return Object.fromEntries([...usedKeys].sort().map((name) => [name, { secret: sec(name), pubkey: pub(name) }]))
}

// Each family is built on its own so its file lists exactly the keys it uses.
function family(name: string, description: string, build: () => Record<string, unknown>) {
  usedKeys.clear()
  const body = build()
  return { ...header(name, description), ...body, keys: keyTable() }
}

function throwVectors() {
  const c = config({ startScore: 301, legsToWin: 2 })
  const leg1 = [dart(20, 3), dart(20, 3), dart(20, 3), ...miss3(), dart(20, 3), dart(11, 3), dart(14, 2)]
  const corrected = play(c, [...leg1, dart(20), { kind: "noScore" }, { kind: "visit", total: 60, darts: 3, atDouble: 1 }, { kind: "turn", player: 0 }])
  corrected[1] = { kind: "dart", dart: { segment: 19, multiplier: 3 }, visit: corrected[1].visit, leg: corrected[1].leg, edited: true }
  corrected[8] = { ...corrected[8], closesLeg: true }
  const logs = [
    { description: "Recorded P0.01 game, 301", config: config({ startScore: 301 }), log: sampleLog() },
    { description: "Two legs with an edited dart, a kept leg result, no-score, a visit total and a turn", config: c, log: corrected },
    { description: "Log saved before throws were tagged", config: config(), log: [dart(20), dart(25, 2), dart(0)] },
  ]
  return { alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-", cases: logs.map((l) => ({ ...l, encoded: encodeThrows(l.log) })) }
}

export function buildVectors(): Record<string, unknown> {
  return {
    club: family("club", "Club founding and changes, replayed by reduceClub (lib/protocol/club-state.ts).", () => ({ cases: clubCases() })),
    tournament: family("tournament", "Tournament founding and changes, replayed by reduceTournament (lib/protocol/tournament-state.ts).", () => ({ cases: tournamentCases() })),
    match: family("match", "Match session authorization, live snapshots and results, replayed by reduceMatch (lib/protocol/match-state.ts).", () => ({ cases: matchCases() })),
    "payment-request": family("payment-request", "Unwrapped payment request rumors checked by checkPaymentRequest (lib/protocol/payment.ts).", () => ({ cases: paymentCases() })),
    badges: family("badges", "NIP-58 definitions and awards checked by checkBadgeAward (lib/protocol/badges.ts).", badgeCases),
    pairing: family("pairing", "Device pairing: code, check code, links and the message sequence (lib/protocol/pairing.ts).", pairingVectors),
    "board-join": family("board-join", "Joining a shared board (lib/protocol/board.ts).", boardVectors),
    "private-records": family("private-records", "Private record slots, data key slot and envelope (lib/protocol/private.ts).", privateVectors),
    invite: family("invite", "Invite proofs: HMAC-SHA256(token, 'blueline-invite-v1:' + pubkey).", () => ({ cases: inviteVectors() })),
    chunks: family("chunks", "Hash-chained pieces (lib/protocol/chunks.ts).", chunkVectors),
    throws: family("throws", "Compact throw logs (lib/protocol/throws.ts): engine log as stored and its encoding.", throwVectors),
  }
}

const FAMILY_OF: Record<string, string> = { club: "club", tournament: "tournament", match: "match", payment: "payment-request" }

export function buildSchemas(): Record<string, JsonSchema> {
  const families: Record<string, Record<string, JsonSchema>> = {}
  for (const [type, spec] of Object.entries(RECORD_TYPES)) {
    const family = FAMILY_OF[type.split(".")[0]]
    ;(families[family] ??= {})[type] = { description: spec.description, kind: spec.kind, ...spec.schema.json() }
  }
  const out: Record<string, JsonSchema> = {}
  const doc = (title: string, defs: Record<string, JsonSchema>) => ({ $schema: "https://json-schema.org/draft/2020-12/schema", title, $defs: defs })
  for (const [family, defs] of Object.entries(families)) out[family] = doc(`BlueLine ${family} record content`, defs)
  const messages = (m: Record<string, Schema<unknown>>) => Object.fromEntries(Object.entries(m).map(([k, s]) => [k, s.json()]))
  out.pairing = doc("BlueLine pairing messages (decrypted content of kind 21501)", messages(PAIRING_MESSAGES))
  out["board-join"] = doc("BlueLine board join messages (decrypted content of kind 21501)", messages(BOARD_MESSAGES))
  out["private-records"] = doc("BlueLine private record plaintexts (kind 30078)", { record: privateRecord.json(), part: recordPart.json(), dataKey: dataKeyRecord.json() })
  return out
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url))

// Indented JSON with short lists (tags, ids) on one line. Literal line breaks only ever come
// from the indentation: inside strings JSON escapes them.
export const serialize = (value: unknown) =>
  `${JSON.stringify(value, null, 2).replace(/\[\n\s+((?:"(?:[^"\\]|\\.)*"|-?[\d.e+]+|true|false|null)(?:,\n\s+(?:"(?:[^"\\]|\\.)*"|-?[\d.e+]+|true|false|null))*)\n\s+\]/g, (_, inner: string) => `[${inner.replace(/,\n\s+/g, ", ")}]`)}\n`

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(`${ROOT}docs/protocol/vectors`, { recursive: true })
  mkdirSync(`${ROOT}docs/protocol/schemas`, { recursive: true })
  for (const [name, file] of Object.entries(buildVectors())) writeFileSync(`${ROOT}docs/protocol/vectors/${name}.json`, serialize(file))
  for (const [name, schema] of Object.entries(buildSchemas())) writeFileSync(`${ROOT}docs/protocol/schemas/${name}.schema.json`, serialize(schema))
  console.log("vectors and schemas written")
}
