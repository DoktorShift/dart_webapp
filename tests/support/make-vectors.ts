// Writes the BlueLine protocol test vectors (docs/protocol/vectors/*.json) and the JSON Schemas
// (docs/protocol/schemas/*.schema.json). Deterministic: fixed secret keys derived from names,
// fixed created_at, fixed content keys and nonces, NIP-44 with fixed nonces and BIP-340
// signatures with zero auxiliary randomness, so a re-run produces byte-identical files
// (tests/protocol-vectors.test.ts checks that).
//
//   node tests/support/make-vectors.ts
//
// Expected outcomes are written by hand per case from the rules in docs/protocol/, not computed
// by the reducers they test. Where a case needs a value the rules define (draw order, invite
// proof, tie-break by id), it is computed here with a separate few lines, not with lib/protocol.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { schnorr } from "@noble/curves/secp256k1"
import { hkdf } from "@noble/hashes/hkdf"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { getEventHash, nip44 } from "nostr-core"
import { correctDart, replay, visitBySeq } from "../../lib/game/engine.ts"
import type { Throw } from "../../lib/game/types.ts"
import { badgeAwardTemplate, badgeD, badgeDefinitionTemplate } from "../../lib/protocol/badges.ts"
import { BOARD_MESSAGES, boardPlaintext, boardTemplate, claimTemplate } from "../../lib/protocol/board.ts"
import { chunkData } from "../../lib/protocol/chunks.ts"
import type { InvitePreview } from "../../lib/protocol/invite.ts"
import { invitePreview, previewKey } from "../../lib/protocol/invite.ts"
import { HANDOFF_MESSAGES, handoffPlaintext, handoffTemplate } from "../../lib/protocol/handoff.ts"
import { encodeLinkPayload } from "../../lib/protocol/links.ts"
import { liveContent } from "../../lib/protocol/live.ts"
import { ENGINE_VERSION } from "../../lib/protocol/match.ts"
import { announceMac, encodePairingCode, helloMac, PAIRING_MESSAGES, pairingCheckCode, pairingCodeKeys, pairingPlaintext, pairingTemplate } from "../../lib/protocol/pairing.ts"
import { paymentRequestRumor } from "../../lib/protocol/payment.ts"
import { dataKeyRecord, dataKeySlot, encodeEnvelope, privateRecord, privateTemplate, recordPart, recordSlot } from "../../lib/protocol/private.ts"
import { buildRecord, encryptForLinkKey, RECORD_TYPES, sealRecord } from "../../lib/protocol/records.ts"
import type { ContentOf, RecordType } from "../../lib/protocol/records.ts"
import type { JsonSchema, Schema } from "../../lib/protocol/schema.ts"
import type { SignedEvent } from "../../lib/protocol/tags.ts"
import { encodeThrows } from "../../lib/protocol/throws.ts"
import { config, dart, miss3, play } from "../helpers.ts"

type EventTemplate = { kind: number; created_at: number; tags: string[][]; content: string }

export const T0 = 1760000000

// ---- Keys, signing, encryption ----------------------------------------------------------------

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

const fixed = (...parts: (string | number)[]) => sha256(utf8ToBytes(`blueline-vector-nonce:${parts.join(":")}`))

// NIP-44 from `author` to `recipient` (a link key, a one-time key, a reader) with a fixed nonce.
function nip44To(author: string, recipient: string, plaintext: string) {
  usedKeys.add(author)
  usedKeys.add(recipient)
  return nip44.encrypt(plaintext, nip44.getConversationKey(secretOf(author), pub(recipient)), fixed(author, recipient, plaintext))
}

const at = (seconds: number) => T0 + seconds
// Hand-over offers in the vectors are open for a day (rule Ü1 allows up to seven).
const OFFER_OPEN = 86400

// Independent helpers (deliberately not lib/protocol): the rules from docs/protocol. The invite
// key is HKDF(token, "blueline-invite-v1", "proof"); a proof is its BIP-340 signature over
// sha256("blueline-invite-v1:" + joiner), here with zero auxiliary randomness.
const inviteSecret = (token: string) => hkdf(sha256, hexToBytes(token), utf8ToBytes("blueline-invite-v1"), utf8ToBytes("proof"), 32)
const inviteKeyOf = (token: string) => bytesToHex(schnorr.getPublicKey(inviteSecret(token)))
const proof = (token: string, pubkey: string) => bytesToHex(schnorr.sign(sha256(utf8ToBytes(`blueline-invite-v1:${pubkey}`)), inviteSecret(token), new Uint8Array(32)))
const shaHex = (text: string) => bytesToHex(sha256(utf8ToBytes(text)))
const commit = (seed: string) => shaHex(`blueline-seed-v1\n${seed}`)
const order = (seed: string, field: string[]) =>
  field
    .map((id) => ({ id, k: shaHex(`blueline-draw-v1\n${seed}\n${id}`) }))
    .sort((a, b) => (a.k < b.k ? -1 : 1))
    .map((x) => x.id)

const hex16 = (label: string) => shaHex(`blueline-vector-id:${label}`).slice(0, 32)
const hex32 = (label: string) => shaHex(`blueline-vector-id:${label}`)

// ---- Records ------------------------------------------------------------------------------------

interface RecordOpts {
  at: number
  root?: string
  d?: string
  // Seal for these readers (closed clubs): fixed content key and nonce per record.
  seal?: string[]
  // With seal on a club.invite: the preview under the link token.
  preview?: { token: string; content: InvitePreview }
  // Encrypt to this link key (private matches).
  link?: string
  version?: string
}

function record<T extends RecordType>(author: string, type: T, content: ContentOf<T>, opts: RecordOpts): { event: SignedEvent; plaintext?: string } {
  let template: EventTemplate = buildRecord(type, content, { created_at: at(opts.at), root: opts.root, d: opts.d })
  if (opts.version) template = { ...template, tags: template.tags.map((t) => (t[0] === "v" ? ["v", opts.version as string] : t)) }
  const plaintext = template.content
  if (opts.seal) {
    const key = fixed("content-key", author, type, opts.at, plaintext)
    const nonce = fixed("seal-nonce", author, type, opts.at, plaintext).slice(0, 24)
    const wraps = opts.seal.map((reader) => ({ reader: pub(reader), payload: nip44To(author, reader, bytesToHex(key)) }))
    const preview = opts.preview ? { key: previewKey(opts.preview.token), nonce: fixed("preview-nonce", opts.preview.token).slice(0, 24), content: opts.preview.content } : undefined
    template = sealRecord(template, { key, nonce, wraps, ...(preview ? { preview } : {}) })
    return { event: sign(author, template), plaintext }
  }
  if (opts.link) {
    template = encryptForLinkKey(template, pub(opts.link), nip44To(author, opts.link, plaintext))
    return { event: sign(author, template), plaintext }
  }
  return { event: sign(author, template) }
}

// The content key a sealed vector record was made with (for key shares).
const contentKeyOf = (author: string, type: string, seconds: number, plaintext: string) => bytesToHex(fixed("content-key", author, type, seconds, plaintext))

// ---- Cases ------------------------------------------------------------------------------------

interface Expect {
  applied?: string[]
  rejected?: [string, string][]
  unapplied?: [string, "unknown" | "sealed" | "waiting"][]
  problem?: string
  state?: Record<string, unknown>
}

function newCase(name: string, description: string, opts: { now?: number; reader?: string; link?: string } = {}) {
  const events: SignedEvent[] = []
  const labels: Record<string, string> = {}
  const plaintexts: Record<string, string> = {}
  const sealedWith: Record<string, { author: string; type: string; at: number }> = {}
  let root = ""
  const c = {
    add(label: string, event: SignedEvent, plaintext?: string) {
      if (labels[label]) throw new Error(`label ${label} twice`)
      events.push(event)
      labels[label] = event.id
      if (plaintext !== undefined) plaintexts[event.id] = plaintext
      return event
    },
    put<T extends RecordType>(label: string, author: string, type: T, content: ContentOf<T>, o: RecordOpts) {
      const r = record(author, type, content, o)
      if (o.seal) sealedWith[label] = { author, type, at: o.at }
      return c.add(label, r.event, r.plaintext)
    },
    // The content key of a record this case sealed: what a club.keys record shares.
    keyOf(label: string): [string, string] {
      const s = sealedWith[label]
      if (!s) throw new Error(`${label} is not sealed`)
      return [c.id(label), contentKeyOf(s.author, s.type, s.at, plaintexts[c.id(label)])]
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
    root: () => root,
    done(expect: Expect, extra: Record<string, unknown> = {}) {
      const id = (label: string) => c.id(label)
      return {
        name,
        description,
        now: opts.now ?? at(100000),
        root,
        ...(opts.reader ? { reader: opts.reader } : {}),
        ...(opts.link ? { linkKey: opts.link } : {}),
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

// ---- Club ---------------------------------------------------------------------------------------

const closedClub = (extra: Partial<ContentOf<"club.found">> = {}): ContentOf<"club.found"> => ({ name: "Dartfreunde Nord", about: "Dienstags ab 19 Uhr im Vereinsheim.", visibility: "closed", ...extra })
const publicClub = (extra: Partial<ContentOf<"club.found">> = {}): ContentOf<"club.found"> => ({ name: "Dartfreunde Nord", visibility: "public", ...extra })

const SEASON_RULES: ContentOf<"club.season">["rules"] = { modes: ["501"], points: { win: 2, draw: 1, loss: 0 }, confirmations: "opponent", minGames: 5, tiebreak: ["wins", "legDifference"] }

function clubCases() {
  const cases = []
  const T = hex16("token-1")
  const T2 = hex16("token-2")
  const T3 = hex16("token-3")
  const preview = (kind: "group" | "personal", expires: number): InvitePreview => ({
    name: "Dartfreunde Nord",
    about: "Dienstags ab 19 Uhr im Vereinsheim.",
    host: pub("owner"),
    hostName: "Mia",
    kind,
    expires,
    next: { title: "Clubabend", starts: at(7200), place: "Vereinsheim" },
  })
  // An invite names the invite key of its token, never the token. A closed club seals it for
  // the members, with the preview for whoever holds the link (`readers`); a public club's
  // invite travels in the clear (readers null) and carries no label.
  const invite = (kind: "group" | "personal", token: string, seconds: number, readers: string[] | null, root: string, expires = at(86400), label?: string) => ({
    content: { kind, key: inviteKeyOf(token), expires, ...(label ? { label } : {}) } as ContentOf<"club.invite">,
    opts: readers ? { at: seconds, root, seal: readers, preview: { token, content: preview(kind, expires) } } : { at: seconds, root },
  })
  const join = (who: string, inviteId: string, token: string): ContentOf<"club.join"> => ({ invite: inviteId, proof: proof(token, pub(who)) })
  const season = (id = "season-1"): ContentOf<"club.season"> => ({ season: hex16(id), name: "Herbst 2025", starts: at(1000), rules: SEASON_RULES })

  {
    const c = newCase("group-link", "A closed club: founding, invite and season are sealed for the members. Two people join through the group link with their proof and are members at once.", { reader: "owner" })
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, ["owner"], root, at(86400), "Clubabend")
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 30, root })
    c.put("season", "owner", "club.season", season(), { at: 40, root, seal: ["owner", "alice", "bob"] })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "join-bob", "season"],
        rejected: [],
        state: { owner: "owner", members: { owner: "owner", alice: "member", bob: "member" }, via: { alice: "group", bob: "group" }, inviteUses: { invite: 2 } },
      }),
    )
  }
  {
    const c = newCase("replayed-proof", "Mallory copies Alice's proof into her own join: worthless for another key. Alice's join arrives twice and counts once; joining again is refused.", { reader: "owner" })
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.again("join-alice")
    c.put("join-mallory", "mallory", "club.join", { invite: c.id("invite"), proof: proof(T, pub("alice")) }, { at: 30, root })
    c.put("alice-again", "alice", "club.join", join("alice", c.id("invite"), T), { at: 40, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice"],
        rejected: [
          ["join-mallory", "invite_proof_invalid"],
          ["alice-again", "already_member"],
        ],
        state: { members: { owner: "owner", alice: "member" }, inviteUses: { invite: 1 } },
      }),
    )
  }
  {
    const c = newCase(
      "group-link-with-limit",
      "A club for three: the group link only files requests, and the owner decides who gets the places. Carol asked last but is accepted first; the third acceptance is refused because the club is full.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", closedClub({ capacity: 3 }), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 21, root })
    c.put("join-carol", "carol", "club.join", join("carol", c.id("invite"), T), { at: 22, root })
    c.put("accept-carol", "owner", "club.accept", { request: c.id("join-carol"), member: pub("carol") }, { at: 30, root, seal: ["owner", "carol"] })
    c.put("accept-alice", "owner", "club.accept", { request: c.id("join-alice"), member: pub("alice") }, { at: 31, root, seal: ["owner", "carol", "alice"] })
    c.put("accept-bob", "owner", "club.accept", { request: c.id("join-bob"), member: pub("bob") }, { at: 32, root, seal: ["owner", "carol", "alice", "bob"] })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "join-bob", "join-carol", "accept-carol", "accept-alice"],
        rejected: [["accept-bob", "club_full"]],
        state: { members: { owner: "owner", carol: "member", alice: "member" }, requests: { bob: "ok" }, inviteUses: { invite: 2 } },
      }),
    )
  }
  {
    const c = newCase(
      "personal-invite",
      "A personal invite for Tom. Tim got the forwarded link: his proof is valid for his own key, but the invite is used once, by the first acceptance. A later join with it is refused.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("personal", T, 10, ["owner"], root, at(86400), "Für Tom")
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-tom", "tom", "club.join", join("tom", c.id("invite"), T), { at: 20, root })
    c.put("join-tim", "tim", "club.join", join("tim", c.id("invite"), T), { at: 21, root })
    c.put("accept-tom", "owner", "club.accept", { request: c.id("join-tom"), member: pub("tom") }, { at: 30, root, seal: ["owner", "tom"] })
    c.put("accept-tim", "owner", "club.accept", { request: c.id("join-tim"), member: pub("tim") }, { at: 31, root, seal: ["owner", "tom", "tim"] })
    c.put("join-erin", "erin", "club.join", join("erin", c.id("invite"), T), { at: 40, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-tom", "join-tim", "accept-tom"],
        rejected: [
          ["accept-tim", "invite_exhausted"],
          ["join-erin", "invite_exhausted"],
        ],
        state: { members: { owner: "owner", tom: "member" }, via: { tom: "accepted" }, requests: { tim: "ok" }, inviteUses: { invite: 1 } },
      }),
    )
  }
  {
    const c = newCase(
      "expired-and-revoked",
      "A join after the group link expired, one after it was ended, a second end, a join after a personal invite expired, and an invite that expires before it is made.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const short = invite("group", T, 10, ["owner"], root, at(100))
    c.put("invite-short", "owner", "club.invite", short.content, short.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite-short"), T), { at: 200, root })
    const second = invite("group", T2, 300, ["owner"], root)
    c.put("invite-2", "owner", "club.invite", second.content, second.opts)
    c.put("revoke", "owner", "club.invite.revoke", { invite: c.id("invite-2") }, { at: 310, root, seal: ["owner"] })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite-2"), T2), { at: 320, root })
    c.put("revoke-again", "owner", "club.invite.revoke", { invite: c.id("invite-2") }, { at: 330, root, seal: ["owner"] })
    const personal = invite("personal", T3, 400, ["owner"], root, at(500))
    c.put("invite-3", "owner", "club.invite", personal.content, personal.opts)
    c.put("join-dave", "dave", "club.join", join("dave", c.id("invite-3"), T3), { at: 600, root })
    const bad = invite("group", hex16("token-4"), 800, ["owner"], root, at(700))
    c.put("invite-bad", "owner", "club.invite", bad.content, bad.opts)
    cases.push(
      c.done({
        applied: ["found", "invite-short", "invite-2", "revoke", "invite-3"],
        rejected: [
          ["join-alice", "invite_expired"],
          ["join-bob", "invite_revoked"],
          ["revoke-again", "invite_revoked"],
          ["join-dave", "invite_expired"],
          ["invite-bad", "invite_expired"],
        ],
        state: { members: { owner: "owner" } },
      }),
    )
  }
  {
    const c = newCase(
      "requests",
      "A public club. Asking without an invite waits for an owner or admin: Dave is accepted, Carol declined, Erin withdraws her request. Asking twice, accepting a gone request, an outsider accepting and withdrawing twice are refused.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("ask-dave", "dave", "club.join", {}, { at: 10, root })
    c.put("ask-carol", "carol", "club.join", {}, { at: 11, root })
    c.put("ask-carol-again", "carol", "club.join", {}, { at: 12, root })
    c.put("ask-erin", "erin", "club.join", {}, { at: 13, root })
    c.put("accept-dave", "owner", "club.accept", { request: c.id("ask-dave"), member: pub("dave") }, { at: 20, root })
    c.put("decline-carol", "owner", "club.decline", { request: c.id("ask-carol") }, { at: 30, root })
    c.put("accept-carol", "owner", "club.accept", { request: c.id("ask-carol"), member: pub("carol") }, { at: 40, root })
    c.put("ask-dave-again", "dave", "club.join", {}, { at: 50, root })
    c.put("outsider-accepts", "mallory", "club.accept", { request: c.id("ask-erin"), member: pub("erin") }, { at: 60, root })
    c.put("erin-withdraws", "erin", "club.leave", {}, { at: 70, root })
    c.put("erin-withdraws-again", "erin", "club.leave", {}, { at: 80, root })
    cases.push(
      c.done({
        applied: ["found", "ask-dave", "ask-carol", "ask-erin", "accept-dave", "decline-carol", "erin-withdraws"],
        rejected: [
          ["ask-carol-again", "duplicate"],
          ["accept-carol", "request_unknown"],
          ["ask-dave-again", "already_member"],
          ["outsider-accepts", "not_authorized"],
          ["erin-withdraws-again", "not_member"],
        ],
        state: { members: { owner: "owner", dave: "member" }, requests: {} },
      }),
    )
  }
  {
    const c = newCase(
      "roles",
      "Who may do what: the owner appoints an admin, the admin appoints a director and removes a member; a director may not invite, a member may not give roles, an admin may not appoint admins or remove the owner.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-admin", "admin", "club.join", join("admin", c.id("invite"), T), { at: 20, root })
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 21, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 22, root })
    c.put("make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 30, root })
    c.put("make-director", "admin", "club.role", { member: pub("alice"), role: "director", prev: c.id("join-alice") }, { at: 40, root })
    const own = invite("group", T2, 50, null, root)
    c.put("director-invites", "alice", "club.invite", own.content, own.opts)
    c.put("member-gives-role", "bob", "club.role", { member: pub("alice"), role: "member", prev: c.id("make-director") }, { at: 60, root })
    c.put("admin-appoints-admin", "admin", "club.role", { member: pub("bob"), role: "admin", prev: c.id("join-bob") }, { at: 70, root })
    c.put("admin-removes-owner", "admin", "club.remove", { member: pub("owner"), prev: root }, { at: 80, root })
    c.put("admin-removes-bob", "admin", "club.remove", { member: pub("bob"), prev: c.id("join-bob"), reason: "Auf eigenen Wunsch" }, { at: 90, root })
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
    const c = newCase("role-conflict", "Owner and admin change Alice's role from the same base. The later one is a visible conflict; the admin resolves it on the new base.", { reader: "owner" })
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-admin", "admin", "club.join", join("admin", c.id("invite"), T), { at: 20, root })
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 21, root })
    c.put("make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 30, root })
    c.put("owner-sets", "owner", "club.role", { member: pub("alice"), role: "director", prev: c.id("join-alice") }, { at: 50, root })
    c.put("admin-sets", "admin", "club.role", { member: pub("alice"), role: "member", prev: c.id("join-alice") }, { at: 51, root })
    c.put("admin-resolves", "admin", "club.role", { member: pub("alice"), role: "member", prev: c.id("owner-sets") }, { at: 60, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "join-alice", "make-admin", "owner-sets", "admin-resolves"],
        rejected: [["admin-sets", "stale_predecessor"]],
        state: { members: { owner: "owner", admin: "admin", alice: "member" } },
      }),
    )
  }
  {
    const c = newCase("owner-transfer", "Ownership changes only by offer and acceptance of the offered member. Afterwards the former owner is an admin and loses what only the owner may do; the club id stays.", {
      reader: "owner",
    })
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 21, root })
    c.put("offer", "owner", "club.owner.offer", { to: pub("alice"), prev: root, expires: at(30) + OFFER_OPEN, info: root, member: c.id("join-alice") }, { at: 30, root })
    c.put("bob-accepts", "bob", "club.owner.accept", { offer: c.id("offer"), info: root, member: c.id("join-bob") }, { at: 40, root })
    c.put("alice-accepts", "alice", "club.owner.accept", { offer: c.id("offer"), info: root, member: c.id("join-alice") }, { at: 50, root })
    c.put("old-owner-closes", "owner", "club.update", { prev: root, visibility: "closed" }, { at: 60, root })
    c.put("old-owner-offers", "owner", "club.owner.offer", { to: pub("bob"), prev: c.id("alice-accepts"), expires: at(70) + OFFER_OPEN, info: root, member: c.id("join-bob") }, { at: 70, root })
    c.put("new-owner-renames", "alice", "club.update", { prev: root, name: "Dartfreunde Nord e.V." }, { at: 80, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "join-bob", "offer", "alice-accepts", "new-owner-renames"],
        rejected: [
          ["bob-accepts", "not_authorized"],
          ["old-owner-closes", "not_authorized"],
          ["old-owner-offers", "not_authorized"],
        ],
        state: { owner: "alice", members: { owner: "admin", alice: "owner", bob: "member" }, name: "Dartfreunde Nord e.V." },
      }),
    )
  }
  {
    const c = newCase("leave-and-rejoin", "The owner cannot leave; a member leaves once. A removed member cannot come back with an invite made before the removal, but can with a new one.", { reader: "owner" })
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 21, root })
    c.put("owner-leaves", "owner", "club.leave", {}, { at: 30, root })
    c.put("bob-leaves", "bob", "club.leave", {}, { at: 31, root })
    c.put("bob-leaves-again", "bob", "club.leave", {}, { at: 32, root })
    c.put("remove-alice", "owner", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 40, root })
    c.put("alice-old-invite", "alice", "club.join", join("alice", c.id("invite"), T), { at: 50, root })
    const inv2 = invite("group", T2, 60, null, root)
    c.put("invite-2", "owner", "club.invite", inv2.content, inv2.opts)
    c.put("alice-new-invite", "alice", "club.join", join("alice", c.id("invite-2"), T2), { at: 70, root })
    c.put("bob-returns", "bob", "club.join", join("bob", c.id("invite-2"), T2), { at: 80, root })
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
    const c = newCase(
      "new-member-reads-history",
      "Read by Bob, who joined later: what was sealed before he joined opens through the owner's key share. A key share by a plain member is refused (the keys it carries still only open what they belong to).",
      { reader: "bob" },
    )
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("season", "owner", "club.season", season(), { at: 30, root, seal: ["owner", "alice"] })
    c.put("date", "owner", "club.date", { date: hex16("date-1"), title: "Clubabend", starts: at(7200), place: "Vereinsheim", prev: root }, { at: 31, root, seal: ["owner", "alice"] })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 40, root })
    c.put("share", "owner", "club.keys", { keys: [c.keyOf("found"), c.keyOf("invite"), c.keyOf("season"), c.keyOf("date")] }, { at: 50, root, seal: ["owner", "alice", "bob"] })
    c.put("alice-shares", "alice", "club.keys", { keys: [c.keyOf("found")] }, { at: 60, root, seal: ["owner", "alice", "bob"] })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "season", "date", "join-bob", "share"],
        rejected: [["alice-shares", "not_authorized"]],
        state: { members: { owner: "owner", alice: "member", bob: "member" }, seasons: { [hex16("season-1")]: { versions: 1, ended: false } }, shares: 1 },
      }),
    )
  }
  {
    const c = newCase("removed-member", "Read by Alice after her removal: she still reads what was shared with her and her removal, but nothing sealed afterwards is wrapped for her.", { reader: "alice" })
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 21, root })
    c.put("share", "owner", "club.keys", { keys: [c.keyOf("found"), c.keyOf("invite")] }, { at: 25, root, seal: ["owner", "alice", "bob"] })
    c.put("remove-alice", "owner", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 30, root, seal: ["owner", "bob", "alice"] })
    c.put("season", "owner", "club.season", season(), { at: 40, root, seal: ["owner", "bob"] })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "join-bob", "share", "remove-alice"],
        rejected: [],
        unapplied: [["season", "sealed"]],
        state: { members: { owner: "owner", bob: "member" }, former: { alice: "removed" } },
      }),
    )
  }
  {
    const c = newCase("closed-club-in-clear", "In a closed club only a join and a leave may travel in the clear; a season in the clear is refused.", { reader: "owner" })
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("season-in-clear", "owner", "club.season", season(), { at: 30, root })
    c.put("alice-leaves", "alice", "club.leave", {}, { at: 40, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "alice-leaves"],
        rejected: [["season-in-clear", "sealing_required"]],
        state: { members: { owner: "owner" }, former: { alice: "left" } },
      }),
    )
  }
  {
    const c = newCase("closed-founding-in-clear", "A closed club whose founding travels in the clear does not exist.", { reader: "owner" })
    c.put("found", "owner", "club.found", closedClub(), { at: 0 })
    c.setRoot("found")
    cases.push(c.done({ problem: "invalid" }))
  }
  {
    const S = hex16("season-1")
    const c = newCase("season-rules", "Season rules are versioned: free changes before the start, after it only with a visible reason, one version at a time, none after the end.", { reader: "owner" })
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 2, root })
    c.put("season", "owner", "club.season", season(), { at: 10, root })
    c.put("member-season", "alice", "club.season", season("season-2"), { at: 11, root })
    c.put("v2-before", "owner", "club.season.rules", { season: S, version: 2, rules: { ...SEASON_RULES, minGames: 3 } }, { at: 20, root })
    c.put("v3-silent", "owner", "club.season.rules", { season: S, version: 3, rules: { ...SEASON_RULES, minGames: 1 } }, { at: 1100, root })
    c.put("v3-reason", "owner", "club.season.rules", { season: S, version: 3, rules: { ...SEASON_RULES, minGames: 1 }, reason: "Beschluss Clubabend 14.10." }, { at: 1110, root })
    c.put("v5-skip", "owner", "club.season.rules", { season: S, version: 5, rules: SEASON_RULES, reason: "Sprung" }, { at: 1120, root })
    c.put("end", "owner", "club.season.end", { season: S }, { at: 1200, root })
    c.put("after-end", "owner", "club.season.rules", { season: S, version: 4, rules: SEASON_RULES, reason: "Zu spät" }, { at: 1300, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "season", "v2-before", "v3-reason", "end"],
        rejected: [
          ["member-season", "not_authorized"],
          ["v3-silent", "rules_change_needs_reason"],
          ["v5-skip", "season_version_mismatch"],
          ["after-end", "season_ended"],
        ],
        state: { seasons: { [S]: { versions: 3, ended: true } } },
      }),
    )
  }
  {
    const S = hex16("season-1")
    const M = hex32("club-match-1")
    const D = hex16("date-1")
    const c = newCase(
      "results-and-dates",
      "A director decides whether a match result counts for the season and plans dates; a member may do neither. Decisions and dates name their predecessor; nothing is decided after the season's end.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-director", "director", "club.join", join("director", c.id("invite"), T), { at: 2, root })
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 3, root })
    c.put("make-director", "owner", "club.role", { member: pub("director"), role: "director", prev: c.id("join-director") }, { at: 4, root })
    c.put("season", "owner", "club.season", season(), { at: 10, root })
    const decision = (count: boolean, prev: string, reason?: string): ContentOf<"club.result"> => ({ season: S, match: M, result: hex32("club-result-1"), count, prev, ...(reason ? { reason } : {}) })
    c.put("decide", "director", "club.result", decision(false, root, "Ergebnis nicht bestätigt"), { at: 20, root })
    c.put("member-decides", "alice", "club.result", decision(true, c.id("decide")), { at: 21, root })
    c.put("stale-decide", "owner", "club.result", decision(true, root), { at: 22, root })
    c.put("re-decide", "owner", "club.result", decision(true, c.id("decide"), "Nachträglich bestätigt"), { at: 23, root })
    const date = (starts: number, prev: string, extra: Partial<ContentOf<"club.date">> = {}): ContentOf<"club.date"> => ({ date: D, title: "Clubabend", starts, place: "Vereinsheim", prev, ...extra })
    c.put("date", "director", "club.date", date(at(7200), root), { at: 30, root })
    c.put("date-move", "owner", "club.date", date(at(10800), c.id("date")), { at: 31, root })
    c.put("member-date", "alice", "club.date", date(at(9000), c.id("date-move")), { at: 32, root })
    c.put("date-cancel", "director", "club.date", date(at(7200), c.id("date"), { cancelled: true }), { at: 33, root })
    c.put("end", "owner", "club.season.end", { season: S }, { at: 40, root })
    c.put("late-decide", "director", "club.result", decision(false, c.id("re-decide")), { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-director", "join-alice", "make-director", "season", "decide", "re-decide", "date", "date-move", "end"],
        rejected: [
          ["member-decides", "not_authorized"],
          ["stale-decide", "stale_predecessor"],
          ["member-date", "not_authorized"],
          ["date-cancel", "stale_predecessor"],
          ["late-decide", "season_ended"],
        ],
        state: { results: { [S]: { [M]: true } }, dates: { [D]: { starts: at(10800), cancelled: false } } },
      }),
    )
  }
  {
    const c = newCase(
      "unknown-version-and-time",
      "A change in a newer format version is kept, not executed. A record dated more than 15 minutes ahead of the reader's clock and one dated before the founding are refused.",
      { now: at(5000), reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 1000 })
    c.setRoot("found")
    const root = c.root()
    c.put("update-v2", "owner", "club.update", { prev: root, name: "Version 2" }, { at: 1010, root, version: "2" })
    c.put("update-v1", "owner", "club.update", { prev: root, name: "Dartfreunde Nord e.V." }, { at: 1020, root })
    c.put("future", "owner", "club.update", { prev: c.id("update-v1"), about: "Aus der Zukunft" }, { at: 5000 + 901, root })
    c.put("too-early", "owner", "club.update", { prev: root, about: "Vor der Gründung" }, { at: 900, root })
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
    const c = newCase("archived", "An archived club takes no requests and no new seasons; the owner can still change its details.", { reader: "owner" })
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("archive", "owner", "club.update", { prev: root, archived: true }, { at: 10, root })
    c.put("ask-dave", "dave", "club.join", {}, { at: 20, root })
    c.put("season", "owner", "club.season", season(), { at: 30, root })
    c.put("rename", "owner", "club.update", { prev: c.id("archive"), name: "Dartfreunde Nord (bis 2025)" }, { at: 40, root })
    cases.push(
      c.done({
        applied: ["found", "archive", "rename"],
        rejected: [
          ["ask-dave", "club_archived"],
          ["season", "club_archived"],
        ],
        state: { members: { owner: "owner" }, name: "Dartfreunde Nord (bis 2025)" },
      }),
    )
  }
  // The same public club read by its owner, an outsider and a member who joined later: invites
  // travel in the clear, so every reader checks Bob's group link proof, sees the owner make
  // him a director, and accepts the tournament he founds for the club.
  for (const reader of ["owner", "mallory", "carol"]) {
    const c = newCase(
      `public-club-read-by-${reader}`,
      "A public club: Bob joins through the group link and becomes a director, Carol asks and is accepted. Every reader, members or not, sees the same club, and Bob's club tournament counts.",
      { reader },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 20, root })
    c.put("make-director", "owner", "club.role", { member: pub("bob"), role: "director", prev: c.id("join-bob") }, { at: 30, root })
    c.put("ask-carol", "carol", "club.join", {}, { at: 40, root })
    c.put("accept-carol", "owner", "club.accept", { request: c.id("ask-carol"), member: pub("carol") }, { at: 50, root })
    const tournament = record("bob", "tournament.found", cup({ club: root }), { at: 60 }).event
    cases.push(
      c.done(
        {
          applied: ["found", "invite", "join-bob", "make-director", "ask-carol", "accept-carol"],
          rejected: [],
          state: { members: { owner: "owner", bob: "director", carol: "member" }, via: { bob: "group", carol: "accepted" }, inviteUses: { invite: 1 } },
        },
        { tournament: { root: tournament.id, events: [tournament], organizer: "bob" } },
      ),
    )
  }
  {
    const c = newCase(
      "closed-club-partial-reader",
      "Read by Carol, who joined a closed club later and was given the founding but not the group link: Bob's join stays an unverified request for her until the owner's role change names it, which accepts it for her. The end of the group link waits for the invite she cannot open, a rename waits for the earlier change it builds on that was not wrapped for her; Bob's club tournament counts for her too.",
      { reader: "carol" },
    )
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const group = invite("group", T, 10, ["owner"], root)
    c.put("invite-group", "owner", "club.invite", group.content, group.opts)
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite-group"), T), { at: 20, root })
    const personal = invite("personal", T2, 30, ["owner", "bob"], root, at(86400), "Für Carol")
    c.put("invite-carol", "owner", "club.invite", personal.content, personal.opts)
    c.put("join-carol", "carol", "club.join", join("carol", c.id("invite-carol"), T2), { at: 31, root })
    c.put("accept-carol", "owner", "club.accept", { request: c.id("join-carol"), member: pub("carol") }, { at: 40, root, seal: ["owner", "bob", "carol"] })
    c.put("share", "owner", "club.keys", { keys: [c.keyOf("found")] }, { at: 45, root, seal: ["owner", "bob", "carol"] })
    c.put("make-director", "owner", "club.role", { member: pub("bob"), role: "director", prev: c.id("join-bob") }, { at: 50, root, seal: ["owner", "bob", "carol"] })
    c.put("end-group-link", "owner", "club.invite.revoke", { invite: c.id("invite-group") }, { at: 60, root, seal: ["owner", "bob", "carol"] })
    c.put("about-for-two", "owner", "club.update", { prev: root, about: "Nur für Bob lesbar" }, { at: 61, root, seal: ["owner", "bob"] })
    c.put("rename", "owner", "club.update", { prev: c.id("about-for-two"), name: "Dartfreunde Nord e.V." }, { at: 62, root, seal: ["owner", "bob", "carol"] })
    const tournament = record("bob", "tournament.found", cup({ club: root }), { at: 70 }).event
    cases.push(
      c.done(
        {
          applied: ["found", "join-bob", "join-carol", "accept-carol", "share", "make-director"],
          rejected: [],
          unapplied: [
            ["invite-group", "sealed"],
            ["invite-carol", "sealed"],
            ["end-group-link", "waiting"],
            ["about-for-two", "sealed"],
            ["rename", "waiting"],
          ],
          state: { members: { owner: "owner", bob: "director", carol: "member" }, via: { bob: "accepted", carol: "accepted" }, requests: {} },
        },
        { tournament: { root: tournament.id, events: [tournament], organizer: "bob" } },
      ),
    )
  }
  {
    const c = newCase(
      "former-owner-backdates",
      "Alice accepts the ownership; her acceptance names the club details and her own membership as she saw them. Records the former owner dates back afterwards are superseded: withdrawing the accepted offer, offering it to Bob instead, removing Alice and closing the club.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 20, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 21, root })
    c.put("offer", "owner", "club.owner.offer", { to: pub("alice"), prev: root, expires: at(30) + OFFER_OPEN, info: root, member: c.id("join-alice") }, { at: 30, root })
    c.put("forged-cancel", "owner", "club.owner.cancel", { offer: c.id("offer") }, { at: 40, root })
    c.put("forged-offer-bob", "owner", "club.owner.offer", { to: pub("bob"), prev: c.id("offer"), expires: at(41) + OFFER_OPEN, info: root, member: c.id("join-bob") }, { at: 41, root })
    c.put("forged-remove-alice", "owner", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 45, root })
    c.put("forged-close", "owner", "club.update", { prev: root, visibility: "closed" }, { at: 46, root })
    c.put("accept", "alice", "club.owner.accept", { offer: c.id("offer"), info: root, member: c.id("join-alice") }, { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "join-bob", "offer", "accept"],
        rejected: [
          ["forged-cancel", "superseded"],
          ["forged-offer-bob", "superseded"],
          ["forged-remove-alice", "superseded"],
          ["forged-close", "superseded"],
        ],
        state: { owner: "alice", members: { owner: "admin", alice: "owner", bob: "member" } },
      }),
    )
  }
  {
    const c = newCase(
      "ex-admin-backdates",
      "The owner demotes an admin; the demotion names the last club change the owner saw. A rename the former admin dates back into their admin time afterwards is superseded; a demotion without that pin is refused. Removing a member is not pinned: the former admin's backdated removal still counts (documented limit, conflicts.md).",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 10, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-admin", "admin", "club.join", join("admin", c.id("invite"), T), { at: 20, root })
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 21, root })
    c.put("make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 30, root })
    c.put("rename", "admin", "club.update", { prev: root, name: "Dartfreunde Nord e.V." }, { at: 35, root })
    c.put("forged-rename", "admin", "club.update", { prev: c.id("rename"), name: "Gekapert" }, { at: 36, root })
    c.put("forged-remove-alice", "admin", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 37, root })
    c.put("demote-unpinned", "owner", "club.role", { member: pub("admin"), role: "member", prev: c.id("make-admin") }, { at: 39, root })
    c.put("demote", "owner", "club.role", { member: pub("admin"), role: "member", prev: c.id("make-admin"), info: c.id("rename") }, { at: 40, root })
    c.put("after-demotion", "admin", "club.update", { prev: c.id("rename"), about: "Neu" }, { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "join-alice", "make-admin", "rename", "forged-remove-alice", "demote"],
        rejected: [
          ["forged-rename", "superseded"],
          ["demote-unpinned", "invalid_content"],
          ["after-demotion", "not_authorized"],
        ],
        state: { members: { owner: "owner", admin: "member" }, former: { alice: "removed" }, name: "Dartfreunde Nord e.V." },
      }),
    )
  }
  {
    // Member names member-001 … member-100.
    const m = (i: number) => `member-${String(i).padStart(3, "0")}`
    const c = newCase(
      "member-limit",
      "A closed club without its own capacity holds at most 100 members (every sealed record is wrapped for each of them). The group link admits 99 people; the next join becomes a request, accepting it is refused while the club is full and works once a member has left.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    const joined = Array.from({ length: 99 }, (_, i) => m(i + 1))
    joined.forEach((who, i) => c.put(`join-${who}`, who, "club.join", join(who, c.id("invite"), T), { at: 10 + i, root }))
    c.put("join-late", m(100), "club.join", join(m(100), c.id("invite"), T), { at: 200, root })
    c.put("accept-full", "owner", "club.accept", { request: c.id("join-late"), member: pub(m(100)) }, { at: 210, root, seal: ["owner", ...joined] })
    c.put("leave", m(1), "club.leave", {}, { at: 220, root })
    c.put("accept", "owner", "club.accept", { request: c.id("join-late"), member: pub(m(100)) }, { at: 230, root, seal: ["owner", ...joined.slice(1), m(100)] })
    cases.push(
      c.done({
        applied: ["found", "invite", ...joined.map((who) => `join-${who}`), "join-late", "leave", "accept"],
        rejected: [["accept-full", "club_full"]],
        state: { memberCount: 100, via: { [m(2)]: "group", [m(100)]: "accepted" }, former: { [m(1)]: "left" }, requests: {} },
      }),
    )
  }
  {
    const c = newCase("backdated-join", "A join dated before the invite it names is refused: nobody can have held that link yet.", { reader: "owner" })
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 100, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 50, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 150, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-bob"],
        rejected: [["join-alice", "invite_unknown"]],
        state: { members: { owner: "owner", bob: "member" } },
      }),
    )
  }
  {
    const c = newCase(
      "owner-accept-names-older-info",
      "Rule Ü2 c: the owner closes the public club and then offers it to Alice, handing over the closed club. Alice accepts naming the founding instead, which would cut the closing and make the club public again: refused, the club stays closed and the owner keeps it.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 2, root })
    c.put("close", "owner", "club.update", { prev: root, visibility: "closed" }, { at: 10, root })
    const offer: ContentOf<"club.owner.offer"> = { to: pub("alice"), prev: root, expires: at(20) + OFFER_OPEN, info: c.id("close"), member: c.id("join-alice") }
    c.put("offer", "owner", "club.owner.offer", offer, { at: 20, root, seal: ["owner", "alice"] })
    c.put("accept-older", "alice", "club.owner.accept", { offer: c.id("offer"), info: root, member: c.id("join-alice") }, { at: 21, root, seal: ["owner", "alice"] })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "close", "offer"],
        rejected: [["accept-older", "invalid_content"]],
        state: { owner: "owner", visibility: "closed", members: { owner: "owner", alice: "member" } },
      }),
    )
  }
  {
    const c = newCase(
      "offer-recipient-left",
      "Rule Ü4: the owner offers the club to Carol, who leaves; the owner then offers it to Bob and renames the club. Carol's later acceptance does not hold (she is gone), so it ends nothing and cuts nothing: Bob's acceptance ends the owner's tenure, and the rename counts.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-carol", "carol", "club.join", join("carol", c.id("invite"), T), { at: 2, root })
    c.put("join-bob", "bob", "club.join", join("bob", c.id("invite"), T), { at: 3, root })
    c.put("offer-carol", "owner", "club.owner.offer", { to: pub("carol"), prev: root, expires: at(10) + OFFER_OPEN, info: root, member: c.id("join-carol") }, { at: 10, root })
    c.put("carol-leaves", "carol", "club.leave", {}, { at: 15, root })
    c.put("offer-bob", "owner", "club.owner.offer", { to: pub("bob"), prev: c.id("offer-carol"), expires: at(30) + OFFER_OPEN, info: root, member: c.id("join-bob") }, { at: 30, root })
    c.put("rename", "owner", "club.update", { prev: root, name: "Dartfreunde Nord e.V." }, { at: 31, root })
    c.put("carol-accepts", "carol", "club.owner.accept", { offer: c.id("offer-carol"), info: root, member: c.id("join-carol") }, { at: 40, root })
    c.put("bob-accepts", "bob", "club.owner.accept", { offer: c.id("offer-bob"), info: c.id("rename"), member: c.id("join-bob") }, { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-carol", "join-bob", "offer-carol", "carol-leaves", "offer-bob", "rename", "bob-accepts"],
        rejected: [["carol-accepts", "no_open_offer"]],
        state: { owner: "bob", members: { owner: "admin", bob: "owner" }, former: { carol: "left" }, name: "Dartfreunde Nord e.V." },
      }),
    )
  }
  {
    const c = newCase(
      "admin-backdates-around-handover",
      "Rule Ü5: up to the acceptance, the new owner's membership follows what the acceptance names, whoever writes about it. The owner's admin later dates removals of Alice back before the offer and between offer and acceptance, to give the club back to the owner: both branch off Alice's membership as the acceptance names it and are superseded. Alice's rename and her demotion of the admin stand.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-admin", "admin", "club.join", join("admin", c.id("invite"), T), { at: 2, root })
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 3, root })
    c.put("make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 4, root })
    c.put("offer", "owner", "club.owner.offer", { to: pub("alice"), prev: root, expires: at(20) + OFFER_OPEN, info: root, member: c.id("join-alice") }, { at: 20, root })
    c.put("accept", "alice", "club.owner.accept", { offer: c.id("offer"), info: root, member: c.id("join-alice") }, { at: 30, root })
    c.put("rename", "alice", "club.update", { prev: root, name: "Dartfreunde Nord e.V." }, { at: 40, root })
    c.put("demote-admin", "alice", "club.role", { member: pub("admin"), role: "member", prev: c.id("make-admin"), info: c.id("rename") }, { at: 50, root })
    c.put("forged-remove-early", "admin", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 15, root })
    c.put("forged-remove", "admin", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 25, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "join-alice", "make-admin", "offer", "accept", "rename", "demote-admin"],
        rejected: [
          ["forged-remove-early", "superseded"],
          ["forged-remove", "superseded"],
        ],
        state: { owner: "alice", members: { owner: "admin", alice: "owner", admin: "member" }, name: "Dartfreunde Nord e.V." },
      }),
    )
  }
  {
    const c = newCase(
      "owner-transfer-after-rejoin",
      "Rule Ü5 pins the new owner's membership as the acceptance names it, from their latest join on: the owner removed Alice once and she came back with a new invite; the hand-over to her holds and her earlier removal stays in the history.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-alice", "alice", "club.join", join("alice", c.id("invite"), T), { at: 2, root })
    c.put("remove-alice", "owner", "club.remove", { member: pub("alice"), prev: c.id("join-alice") }, { at: 5, root })
    const inv2 = invite("group", T2, 6, null, root)
    c.put("invite-2", "owner", "club.invite", inv2.content, inv2.opts)
    c.put("rejoin-alice", "alice", "club.join", join("alice", c.id("invite-2"), T2), { at: 8, root })
    c.put("offer", "owner", "club.owner.offer", { to: pub("alice"), prev: root, expires: at(20) + OFFER_OPEN, info: root, member: c.id("rejoin-alice") }, { at: 20, root })
    c.put("accept", "alice", "club.owner.accept", { offer: c.id("offer"), info: root, member: c.id("rejoin-alice") }, { at: 30, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-alice", "remove-alice", "invite-2", "rejoin-alice", "offer", "accept"],
        state: { owner: "alice", members: { owner: "admin", alice: "owner" } },
      }),
    )
  }
  {
    const c = newCase(
      "invite-ends-for-good",
      "An invite ends for good when its maker stops being owner or admin: the admin's group link admits nobody after the demotion, and not again after the owner makes them admin once more (a link that leaked was often the reason for the demotion).",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, null, root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-admin", "admin", "club.join", join("admin", c.id("invite"), T), { at: 2, root })
    c.put("make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 3, root })
    const link = invite("group", T2, 4, null, root)
    c.put("admin-link", "admin", "club.invite", link.content, link.opts)
    c.put("join-erin", "erin", "club.join", join("erin", c.id("admin-link"), T2), { at: 5, root })
    c.put("demote", "owner", "club.role", { member: pub("admin"), role: "member", prev: c.id("make-admin"), info: root }, { at: 10, root })
    c.put("join-dave", "dave", "club.join", join("dave", c.id("admin-link"), T2), { at: 20, root })
    c.put("make-admin-again", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("demote") }, { at: 30, root })
    c.put("join-frank", "frank", "club.join", join("frank", c.id("admin-link"), T2), { at: 40, root })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "make-admin", "admin-link", "join-erin", "demote", "make-admin-again"],
        rejected: [
          ["join-dave", "invite_revoked"],
          ["join-frank", "invite_revoked"],
        ],
        state: { members: { owner: "owner", admin: "admin", erin: "member" } },
      }),
    )
  }
  // A public club's invite travels in the clear; one its maker sealed admits nobody, whoever
  // reads it.
  for (const reader of ["owner", "mallory"]) {
    const c = newCase(
      `public-club-sealed-invite-read-by-${reader}`,
      "A public club's records travel in the clear (only key shares are sealed), so that every reader checks the same joins. The owner seals a labelled group link anyway: the owner, who can open it, refuses it and the join through it; an outsider cannot open it and sees a waiting request. Nobody becomes a member through it.",
      { reader },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("sealed-invite", "owner", "club.invite", { kind: "group", key: inviteKeyOf(T), expires: at(86400), label: "Stammtisch" }, { at: 1, root, seal: ["owner"], preview: { token: T, content: preview("group", at(86400)) } })
    c.put("join-alice", "alice", "club.join", join("alice", c.id("sealed-invite"), T), { at: 2, root })
    cases.push(
      c.done(
        reader === "owner"
          ? { applied: ["found"], rejected: [["sealed-invite", "invalid_tags"], ["join-alice", "invite_unknown"]], state: { members: { owner: "owner" }, requests: {} } }
          : { applied: ["found", "join-alice"], unapplied: [["sealed-invite", "sealed"]], state: { members: { owner: "owner" }, requests: { alice: "unverified" } } },
      ),
    )
  }
  {
    const c = newCase(
      "invite-ends-with-role",
      "An invite ends with its maker's role as owner or admin: other managers of a closed club may not even see it to end it. The admin's group link admits Erin while the admin manages the club; after the owner removes the admin, a fresh key cannot join through it any more, and Dave's request through the admin's personal invite can no longer be accepted.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    c.put("join-admin", "admin", "club.join", join("admin", c.id("invite"), T), { at: 2, root })
    c.put("make-admin", "owner", "club.role", { member: pub("admin"), role: "admin", prev: c.id("join-admin") }, { at: 3, root, seal: ["owner", "admin"] })
    const link = invite("group", T2, 4, ["owner", "admin"], root)
    c.put("admin-link", "admin", "club.invite", link.content, link.opts)
    const personal = invite("personal", T3, 5, ["owner", "admin"], root, at(86400), "Für Dave")
    c.put("admin-invites-dave", "admin", "club.invite", personal.content, personal.opts)
    c.put("dave-asks", "dave", "club.join", join("dave", c.id("admin-invites-dave"), T3), { at: 6, root })
    c.put("join-erin", "erin", "club.join", join("erin", c.id("admin-link"), T2), { at: 8, root })
    c.put("remove-admin", "owner", "club.remove", { member: pub("admin"), prev: c.id("make-admin"), info: root, reason: "Missbrauch" }, { at: 10, root, seal: ["owner", "admin", "erin"] })
    c.put("sock-joins", "sock", "club.join", join("sock", c.id("admin-link"), T2), { at: 20, root })
    c.put("accept-dave", "owner", "club.accept", { request: c.id("dave-asks"), member: pub("dave") }, { at: 25, root, seal: ["owner", "erin", "dave"] })
    cases.push(
      c.done({
        applied: ["found", "invite", "join-admin", "make-admin", "admin-link", "admin-invites-dave", "dave-asks", "join-erin", "remove-admin"],
        rejected: [
          ["sock-joins", "invite_revoked"],
          ["accept-dave", "invite_revoked"],
        ],
        state: { members: { owner: "owner", erin: "member" }, former: { admin: "removed" }, requests: { dave: "ok" } },
      }),
    )
  }
  {
    // Member names member-001 … member-100; joins ten seconds apart.
    const m = (i: number) => `member-${String(i).padStart(3, "0")}`
    const c = newCase(
      "member-limit-displacement",
      "Known limit (open user decision, ADR 0002 §6): at the 100-member limit of a closed club without its own capacity, the joiners' own created_at decides. Someone who gets the link late and dates the join five seconds before member 99's takes the last place, and member 99, who joined earlier in real time, waits as a request. lib/clubs sets a capacity of 100 at about 90 members so an admin decides instead (club.md).",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", closedClub(), { at: 0, seal: ["owner"] })
    c.setRoot("found")
    const root = c.root()
    const inv = invite("group", T, 1, ["owner"], root)
    c.put("invite", "owner", "club.invite", inv.content, inv.opts)
    const joined = Array.from({ length: 99 }, (_, i) => m(i + 1))
    joined.forEach((who, i) => c.put(`join-${who}`, who, "club.join", join(who, c.id("invite"), T), { at: 10 + 10 * i, root }))
    c.put("join-late", "late", "club.join", join("late", c.id("invite"), T), { at: 10 + 10 * 98 - 5, root })
    cases.push(
      c.done({
        applied: ["found", "invite", ...joined.slice(0, 98).map((who) => `join-${who}`), "join-late", `join-${m(99)}`],
        state: { memberCount: 100, via: { late: "group" }, requests: { [m(99)]: "ok" } },
      }),
    )
  }
  {
    const c = newCase(
      "missing-predecessor",
      "A change whose base this reader has not loaded waits for it (relays keep nothing for sure), also when that base is the join of the member it names; a change on a base that is known but no longer current is a visible conflict.",
      { reader: "owner" },
    )
    c.put("found", "owner", "club.found", publicClub(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    // The first rename and Bob's join never reached this reader.
    const lost = record("owner", "club.update", { prev: root, name: "Dartfreunde Nord e.V." }, { at: 10, root }).event
    const lostJoin = record("bob", "club.join", {}, { at: 11, root }).event
    c.put("about", "owner", "club.update", { prev: lost.id, about: "Dienstags ab 19 Uhr." }, { at: 20, root })
    c.put("rename", "owner", "club.update", { prev: root, name: "DF Nord" }, { at: 30, root })
    c.put("stale", "owner", "club.update", { prev: root, about: "Mittwochs" }, { at: 40, root })
    c.put("bob-director", "owner", "club.role", { member: pub("bob"), role: "director", prev: lostJoin.id }, { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "rename"],
        rejected: [["stale", "stale_predecessor"]],
        unapplied: [
          ["about", "waiting"],
          ["bob-director", "waiting"],
        ],
        state: { name: "DF Nord" },
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
const SEED = hex16("seed-1")
const cup = (extra: Partial<ContentOf<"tournament.found">> = {}): ContentOf<"tournament.found"> => ({
  name: "Herbstcup",
  engine: 1,
  format: "single",
  rules: rules501,
  capacity: 4,
  admission: "manual",
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
  const G2 = hex16("guest-2")
  const G3 = hex16("guest-3")
  {
    const c = newCase(
      "registration-and-admission",
      "Registrations wait for the organizer, whatever their created_at: P4 dated hers before everyone and still waits. The organizer admits two, the third admission is refused (full), puts two on the waiting list and later admits P4 from it, not P3. A late registration during check-in waits, marked late.",
    )
    c.put("found", "organizer", "tournament.found", cup({ capacity: 2, registrationCloses: at(55) }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("p1", "p1", "tournament.register", { alias: "Mia" }, { at: 10, root })
    c.put("p2", "p2", "tournament.register", {}, { at: 20, root })
    c.put("p3", "p3", "tournament.register", {}, { at: 30, root })
    c.put("p4", "p4", "tournament.register", {}, { at: 5, root })
    c.put("p1-admits-self", "p1", "tournament.admit", { participant: pub("p1"), prev: c.id("p1") }, { at: 35, root })
    c.put("admit-p2", "organizer", "tournament.admit", { participant: pub("p2"), prev: c.id("p2") }, { at: 40, root })
    c.put("admit-p1", "organizer", "tournament.admit", { participant: pub("p1"), prev: c.id("p1") }, { at: 41, root })
    c.put("admit-p3", "organizer", "tournament.admit", { participant: pub("p3"), prev: c.id("p3") }, { at: 42, root })
    c.put("wait-p3", "organizer", "tournament.waitlist", { participant: pub("p3"), prev: c.id("p3") }, { at: 43, root })
    c.put("wait-p4", "organizer", "tournament.waitlist", { participant: pub("p4"), prev: c.id("p4") }, { at: 44, root })
    c.put("p1-withdraws", "p1", "tournament.withdraw", { reason: "krank" }, { at: 45, root })
    c.put("p2-again", "p2", "tournament.register", {}, { at: 46, root })
    c.put("admit-p4", "organizer", "tournament.admit", { participant: pub("p4"), prev: c.id("wait-p4") }, { at: 50, root })
    c.put("checkin", "organizer", "tournament.phase", { phase: "checkin", prev: root }, { at: 60, root })
    c.put("p5", "p5", "tournament.register", {}, { at: 70, root })
    cases.push(
      c.done({
        applied: ["found", "p4", "p1", "p2", "p3", "admit-p2", "admit-p1", "wait-p3", "wait-p4", "p1-withdraws", "admit-p4", "checkin", "p5"],
        rejected: [
          ["p1-admits-self", "not_authorized"],
          ["admit-p3", "tournament_full"],
          ["p2-again", "already_registered"],
        ],
        state: { phase: "checkin", participants: { p1: "withdrawn", p2: "registered", p3: "waitlist", p4: "registered", p5: "pending" }, late: ["p5"], waitlist: ["p3"] },
      }),
    )
  }
  {
    const c = newCase("capacity", "Three places: a fourth guest and an admission beyond capacity are refused, a tournament without a waiting list has none, and the capacity cannot shrink below the admitted field.")
    c.put("found", "organizer", "tournament.found", cup({ capacity: 3, waitlist: false, checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("guest-1", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 10, root })
    c.put("guest-2", "organizer", "tournament.guest", { guest: G2, alias: "Gast 2" }, { at: 11, root })
    c.put("guest-3", "organizer", "tournament.guest", { guest: G3, alias: "Gast 3" }, { at: 12, root })
    c.put("guest-4", "organizer", "tournament.guest", { guest: hex16("guest-4"), alias: "Gast 4" }, { at: 13, root })
    c.put("p1", "p1", "tournament.register", {}, { at: 20, root })
    c.put("admit-p1", "organizer", "tournament.admit", { participant: pub("p1"), prev: c.id("p1") }, { at: 21, root })
    c.put("wait-p1", "organizer", "tournament.waitlist", { participant: pub("p1"), prev: c.id("p1") }, { at: 22, root })
    c.put("shrink", "organizer", "tournament.update", { prev: root, capacity: 2 }, { at: 23, root })
    cases.push(
      c.done({
        applied: ["found", "guest-1", "guest-2", "guest-3", "p1"],
        rejected: [
          ["guest-4", "tournament_full"],
          ["admit-p1", "tournament_full"],
          ["wait-p1", "invalid_content"],
          ["shrink", "tournament_full"],
        ],
        state: { participants: { [G]: "registered", [G2]: "registered", [G3]: "registered", p1: "pending" } },
      }),
    )
  }
  {
    const c = newCase(
      "guests-and-claims",
      "The organizer adds guests: one under a neutral alias, one who agreed to be shown by name. A guest place is linked to a player only after that player claimed it; only the organizer adds guests.",
    )
    c.put("found", "organizer", "tournament.found", cup(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("guest", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 10, root })
    c.put("guest-named", "organizer", "tournament.guest", { guest: G2, alias: "Jonas K.", named: true }, { at: 11, root })
    c.put("link-unclaimed", "organizer", "tournament.link", { guest: G, player: pub("p1"), prev: c.id("guest") }, { at: 20, root })
    c.put("claim", "p1", "tournament.claim", { guest: G }, { at: 30, root })
    c.put("link", "organizer", "tournament.link", { guest: G, player: pub("p1"), prev: c.id("guest") }, { at: 40, root })
    c.put("mallory-guest", "mallory", "tournament.guest", { guest: G3, alias: "Gast 3" }, { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "guest", "guest-named", "claim", "link"],
        rejected: [
          ["link-unclaimed", "not_authorized"],
          ["mallory-guest", "not_authorized"],
        ],
        state: { participants: { [G]: "registered", [G2]: "registered" }, linked: { [G]: "p1" }, named: [G2] },
      }),
    )
  }
  {
    const c = newCase(
      "checkin-and-draw",
      "Check-in, then the draw opens the seed committed at the founding and fixes the field. A wrong seed, a field with someone who never registered or whom the organizer took out, and a second draw without a new commitment are refused.",
    )
    c.put("found", "organizer", "tournament.found", cup(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("p1", "p1", "tournament.register", {}, { at: 10, root })
    c.put("p2", "p2", "tournament.register", {}, { at: 11, root })
    c.put("p3", "p3", "tournament.register", {}, { at: 12, root })
    c.put("admit-p1", "organizer", "tournament.admit", { participant: pub("p1"), prev: c.id("p1") }, { at: 13, root })
    c.put("admit-p2", "organizer", "tournament.admit", { participant: pub("p2"), prev: c.id("p2") }, { at: 14, root })
    c.put("admit-p3", "organizer", "tournament.admit", { participant: pub("p3"), prev: c.id("p3") }, { at: 15, root })
    c.put("guest", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 16, root })
    c.put("checkin", "organizer", "tournament.phase", { phase: "checkin", prev: root }, { at: 20, root })
    c.put("in-p1", "p1", "tournament.checkin", {}, { at: 30, root })
    c.put("in-p2", "p2", "tournament.checkin", {}, { at: 31, root })
    c.put("in-guest", "organizer", "tournament.checkin", { participant: G, prev: c.id("guest") }, { at: 32, root })
    c.put("in-mallory", "mallory", "tournament.checkin", {}, { at: 33, root })
    c.put("remove-p3", "organizer", "tournament.remove", { participant: pub("p3"), prev: c.id("admit-p3"), reason: "Nicht erschienen" }, { at: 34, root })
    const field = [pub("p1"), pub("p2"), G]
    const other = hex16("other-seed")
    c.put("draw-wrong-seed", "organizer", "tournament.draw", { seed: other, seeded: [], order: order(other, field), prev: c.id("checkin") }, { at: 40, root })
    c.put("draw-stranger", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [...field, pub("mallory")]), prev: c.id("checkin") }, { at: 41, root })
    c.put("draw-removed", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [...field, pub("p3")]), prev: c.id("checkin") }, { at: 42, root })
    c.put("draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, field), prev: c.id("checkin") }, { at: 43, root })
    c.put("redraw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, field), prev: c.id("draw") }, { at: 50, root })
    cases.push(
      c.done(
        {
          applied: ["found", "p1", "p2", "p3", "admit-p1", "admit-p2", "admit-p3", "guest", "checkin", "in-p1", "in-p2", "in-guest", "remove-p3", "draw"],
          rejected: [
            ["in-mallory", "not_registered"],
            ["draw-wrong-seed", "seed_mismatch"],
            ["draw-stranger", "draw_mismatch"],
            ["draw-removed", "draw_mismatch"],
            ["redraw", "seed_not_committed"],
          ],
          state: { phase: "drawn", order: order(SEED, field), checkedIn: [pub("p1"), pub("p2"), G] },
        },
        { seed: SEED, field },
      ),
    )
  }
  {
    const c = newCase(
      "draw-holds-against-backdated-player-records",
      "Players date their own records. P2 dates a withdrawal before the organizer admitted her and P3 one just before the draw: the admission of P2 is refused, but the organizer's draw, which includes both, still stands; both are withdrawn (walkovers for the engine).",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("p1", "p1", "tournament.register", {}, { at: 10, root })
    c.put("p2", "p2", "tournament.register", {}, { at: 11, root })
    c.put("p3", "p3", "tournament.register", {}, { at: 12, root })
    c.put("p2-withdraws", "p2", "tournament.withdraw", {}, { at: 19, root })
    c.put("admit-p1", "organizer", "tournament.admit", { participant: pub("p1"), prev: c.id("p1") }, { at: 20, root })
    c.put("admit-p2", "organizer", "tournament.admit", { participant: pub("p2"), prev: c.id("p2") }, { at: 21, root })
    c.put("admit-p3", "organizer", "tournament.admit", { participant: pub("p3"), prev: c.id("p3") }, { at: 22, root })
    c.put("p3-withdraws", "p3", "tournament.withdraw", {}, { at: 29, root })
    const field = [pub("p1"), pub("p2"), pub("p3")]
    c.put("draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, field), prev: root }, { at: 30, root })
    cases.push(
      c.done(
        {
          applied: ["found", "p1", "p2", "p3", "p2-withdraws", "admit-p1", "admit-p3", "p3-withdraws", "draw"],
          rejected: [["admit-p2", "not_registered"]],
          state: { phase: "drawn", order: order(SEED, field), participants: { p1: "registered", p2: "withdrawn", p3: "withdrawn" } },
        },
        { seed: SEED, field },
      ),
    )
  }
  {
    const c = newCase(
      "boards-and-results",
      "Boards submit results only for slots assigned to them; the organizer approves and corrects. A walkover is a result too. A correction marks the next match built on it as affected.",
    )
    c.put("found", "organizer", "tournament.found", cup({ capacity: 4, checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    for (const p of ["p1", "p2", "p3", "p4"]) c.put(p, p, "tournament.register", {}, { at: 10, root })
    for (const [i, p] of ["p1", "p2", "p3", "p4"].entries()) c.put(`admit-${p}`, "organizer", "tournament.admit", { participant: pub(p), prev: c.id(p) }, { at: 11 + i, root })
    const field = [pub("p1"), pub("p2"), pub("p3"), pub("p4")]
    c.put("draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, field), prev: root }, { at: 20, root })
    const B1 = hex16("board-1")
    const B2 = hex16("board-2")
    c.put("board-1", "organizer", "tournament.board", { board: B1, name: "Board 1", key: pub("board1"), prev: root }, { at: 30, root })
    c.put("board-2", "organizer", "tournament.board", { board: B2, name: "Board 2", key: pub("board2"), prev: root }, { at: 31, root })
    c.put("assign", "organizer", "tournament.assign", { slot: "R1-1", board: B1, prev: root }, { at: 40, root })
    c.put("assign-2", "organizer", "tournament.assign", { slot: "R1-2", board: B2, prev: root }, { at: 41, root })
    c.put("assign-next", "organizer", "tournament.assign", { slot: "R2-1", board: B1, prev: root }, { at: 42, root })
    c.put("early-result", "board1", "tournament.result", { slot: "R1-1", winner: pub("p1"), score: [2, 1] }, { at: 45, root })
    c.put("start", "organizer", "tournament.phase", { phase: "running", prev: c.id("draw") }, { at: 50, root })
    c.put("wrong-board", "board2", "tournament.result", { slot: "R1-1", winner: pub("p2"), score: [0, 2] }, { at: 60, root })
    c.put("stranger", "mallory", "tournament.result", { slot: "R1-1", winner: pub("p2"), score: [0, 2] }, { at: 61, root })
    c.put("result", "board1", "tournament.result", { slot: "R1-1", winner: pub("p1"), score: [2, 1] }, { at: 70, root })
    c.put("approve", "organizer", "tournament.approve", { slot: "R1-1", submission: c.id("result"), prev: c.id("assign") }, { at: 80, root })
    c.put("result-again", "board1", "tournament.result", { slot: "R1-1", winner: pub("p2"), score: [1, 2] }, { at: 90, root })
    c.put("walkover", "board2", "tournament.result", { slot: "R1-2", winner: pub("p3"), score: [0, 0], walkover: "noShow" }, { at: 91, root })
    c.put("approve-2", "organizer", "tournament.approve", { slot: "R1-2", submission: c.id("walkover"), prev: c.id("assign-2") }, { at: 92, root })
    c.put("correct", "organizer", "tournament.correct", { slot: "R1-1", winner: pub("p2"), score: [1, 2], reason: "Leg 2 falsch eingetragen", prev: c.id("approve") }, { at: 100, root })
    cases.push(
      c.done(
        {
          applied: [
            "found",
            ...["p1", "p2", "p3", "p4"].sort((a, b) => (c.id(a) < c.id(b) ? -1 : 1)),
            "admit-p1",
            "admit-p2",
            "admit-p3",
            "admit-p4",
            "draw",
            "board-1",
            "board-2",
            "assign",
            "assign-2",
            "assign-next",
            "start",
            "result",
            "approve",
            "walkover",
            "approve-2",
            "correct",
          ],
          rejected: [
            ["early-result", "phase_invalid"],
            ["wrong-board", "board_not_assigned"],
            ["stranger", "not_authorized"],
            ["result-again", "already_approved"],
          ],
          state: { phase: "running", slots: { "R1-1": { winner: pub("p2"), corrected: true }, "R1-2": { winner: pub("p3"), walkover: "noShow" }, "R2-1": { affected: true } } },
        },
        { dependents: { "R1-1": ["R2-1"], "R1-2": ["R2-1"] } },
      ),
    )
  }
  {
    const c = newCase("organizer-handover", "The organization changes only by offer and acceptance. Afterwards the former organizer's decisions are refused.")
    c.put("found", "organizer", "tournament.found", cup(), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("offer", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(10) + OFFER_OPEN, core: root }, { at: 10, root })
    c.put("mallory-accepts", "mallory", "tournament.handover.accept", { offer: c.id("offer"), core: root }, { at: 20, root })
    c.put("accept", "organizer2", "tournament.handover.accept", { offer: c.id("offer"), core: root }, { at: 30, root })
    c.put("old-organizer", "organizer", "tournament.phase", { phase: "checkin", prev: root }, { at: 40, root })
    c.put("new-organizer", "organizer2", "tournament.phase", { phase: "checkin", prev: root }, { at: 50, root })
    c.put("player-admits", "p1", "tournament.admit", { participant: pub("p1"), prev: root }, { at: 60, root })
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
    const c = newCase(
      "former-organizer-backdates",
      "The new organizer's acceptance names the core state they took over. The former organizer later dates a cancellation and a withdrawal of the accepted offer back into their tenure: both are superseded, and the new organizer's draw and start stand. Places are not pinned: a guest the former organizer dates back still counts (documented limit, conflicts.md).",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("guest-1", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 10, root })
    c.put("guest-2", "organizer", "tournament.guest", { guest: G2, alias: "Gast 2" }, { at: 11, root })
    c.put("forged-cancel", "organizer", "tournament.phase", { phase: "cancelled", prev: root }, { at: 15, root })
    c.put("forged-guest", "organizer", "tournament.guest", { guest: hex16("guest-forged"), alias: "Gast 3" }, { at: 16, root })
    c.put("offer", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(20) + OFFER_OPEN, core: root }, { at: 20, root })
    c.put("forged-withdraw-offer", "organizer", "tournament.handover.cancel", { offer: c.id("offer") }, { at: 25, root })
    c.put("accept", "organizer2", "tournament.handover.accept", { offer: c.id("offer"), core: root }, { at: 30, root })
    c.put("draw", "organizer2", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [G, G2]), prev: root }, { at: 40, root })
    c.put("running", "organizer2", "tournament.phase", { phase: "running", prev: c.id("draw") }, { at: 50, root })
    cases.push(
      c.done({
        applied: ["found", "guest-1", "guest-2", "forged-guest", "offer", "accept", "draw", "running"],
        rejected: [
          ["forged-cancel", "superseded"],
          ["forged-withdraw-offer", "superseded"],
        ],
        state: { organizer: "organizer2", phase: "running", participants: { [G]: "registered", [G2]: "registered", [hex16("guest-forged")]: "registered" } },
      }),
    )
  }
  {
    const c = newCase(
      "handover-cancel-then-expired-accept",
      "Rule Ü2 b: the organizer withdraws the offer and keeps running the tournament. Organizer 2 accepts after the offer expired: no hand-over, and nothing of the organizer's is cut.",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("offer", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(10) + 3600, core: root }, { at: 10, root })
    c.put("cancel", "organizer", "tournament.handover.cancel", { offer: c.id("offer") }, { at: 11, root })
    c.put("rename", "organizer", "tournament.update", { prev: root, name: "Herbstcup 2025" }, { at: 20, root })
    c.put("guest-1", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 21, root })
    c.put("guest-2", "organizer", "tournament.guest", { guest: G2, alias: "Gast 2" }, { at: 22, root })
    c.put("draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [G, G2]), prev: c.id("rename") }, { at: 30, root })
    c.put("running", "organizer", "tournament.phase", { phase: "running", prev: c.id("draw") }, { at: 40, root })
    c.put("late-accept", "organizer2", "tournament.handover.accept", { offer: c.id("offer"), core: root }, { at: 10 + 3600 + 1, root })
    cases.push(
      c.done({
        applied: ["found", "offer", "cancel", "rename", "guest-1", "guest-2", "draw", "running"],
        rejected: [["late-accept", "no_open_offer"]],
        state: { organizer: "organizer", phase: "running", name: "Herbstcup 2025" },
      }),
    )
  }
  {
    const c = newCase(
      "handover-completed-then-old-offer-accepted",
      "Rules Ü3 and Ü4: the organizer withdraws the offer to organizer 2 and hands over to organizer 3, who accepts first. Organizer 2's later acceptance of the withdrawn offer (still inside its time) answers an offer of someone who no longer organizes: organizer 3 stays.",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("offer-2", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(10) + OFFER_OPEN, core: root }, { at: 10, root })
    c.put("cancel", "organizer", "tournament.handover.cancel", { offer: c.id("offer-2") }, { at: 11, root })
    c.put("offer-3", "organizer", "tournament.handover.offer", { to: pub("organizer3"), prev: c.id("cancel"), expires: at(100) + OFFER_OPEN, core: root }, { at: 100, root })
    c.put("accept-3", "organizer3", "tournament.handover.accept", { offer: c.id("offer-3"), core: root }, { at: 101, root })
    c.put("rename-3", "organizer3", "tournament.update", { prev: root, name: "Herbstcup 2025" }, { at: 110, root })
    c.put("accept-2", "organizer2", "tournament.handover.accept", { offer: c.id("offer-2"), core: root }, { at: 200, root })
    cases.push(
      c.done({
        applied: ["found", "offer-2", "cancel", "offer-3", "accept-3", "rename-3"],
        rejected: [["accept-2", "no_open_offer"]],
        state: { organizer: "organizer3", name: "Herbstcup 2025" },
      }),
    )
  }
  {
    const c = newCase(
      "handover-accept-names-older-core",
      "Rule Ü2 c: the offer hands over the running tournament (core = the start). Organizer 2 accepts naming the founding instead, to cut the draw, the start and the result: refused. A second, correct acceptance is not an answer any more (Ü3), so organizer 2's new seed and draw are refused and the draw stands.",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("guest-1", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 1, root })
    c.put("guest-2", "organizer", "tournament.guest", { guest: G2, alias: "Gast 2" }, { at: 2, root })
    c.put("draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [G, G2]), prev: root }, { at: 20, root })
    c.put("running", "organizer", "tournament.phase", { phase: "running", prev: c.id("draw") }, { at: 30, root })
    c.put("result", "organizer", "tournament.result", { slot: "R1-1", winner: G, score: [2, 0] }, { at: 35, root })
    c.put("offer", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(40) + OFFER_OPEN, core: c.id("running") }, { at: 40, root })
    c.put("accept-older", "organizer2", "tournament.handover.accept", { offer: c.id("offer"), core: root }, { at: 41, root })
    c.put("accept-again", "organizer2", "tournament.handover.accept", { offer: c.id("offer"), core: c.id("running") }, { at: 42, root })
    const SEED2 = hex16("seed-2")
    c.put("new-seed", "organizer2", "tournament.seed", { commit: commit(SEED2), prev: root }, { at: 50, root })
    c.put("new-draw", "organizer2", "tournament.draw", { seed: SEED2, seeded: [], order: order(SEED2, [G, G2]), prev: c.id("new-seed") }, { at: 51, root })
    cases.push(
      c.done({
        applied: ["found", "guest-1", "guest-2", "draw", "running", "result", "offer"],
        rejected: [
          ["accept-older", "invalid_content"],
          ["accept-again", "no_open_offer"],
          ["new-seed", "not_authorized"],
          ["new-draw", "not_authorized"],
        ],
        state: { organizer: "organizer", phase: "running", order: order(SEED, [G, G2]), slots: { "R1-1": { winner: G } } },
      }),
    )
  }
  {
    const c = newCase(
      "handover-lagging-offer",
      "Known limit (rule Ü6 b): what the acceptance names is what counts. An organizer device that has not synced the draw and the start offers the founding as core, and organizer 2's device, just as far behind, accepts it: the draw and the start are cut. Without trusted time this is the same set of events as the organizer dating them back after a completed hand-over, which the rule must stop. lib/tournaments therefore offers and accepts only on a synced device and shows the core handed over.",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("guest-1", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 2, root })
    c.put("guest-2", "organizer", "tournament.guest", { guest: G2, alias: "Gast 2" }, { at: 3, root })
    c.put("draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [G, G2]), prev: root }, { at: 20, root })
    c.put("running", "organizer", "tournament.phase", { phase: "running", prev: c.id("draw") }, { at: 30, root })
    c.put("lagging-offer", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(40) + OFFER_OPEN, core: root }, { at: 40, root })
    c.put("lagging-accept", "organizer2", "tournament.handover.accept", { offer: c.id("lagging-offer"), core: root }, { at: 41, root })
    cases.push(
      c.done({
        applied: ["found", "guest-1", "guest-2", "lagging-offer", "lagging-accept"],
        rejected: [
          ["draw", "superseded"],
          ["running", "stale_predecessor"],
        ],
        state: { organizer: "organizer2", phase: "registration" },
      }),
    )
  }
  {
    const c = newCase(
      "handover-crossing-cancel",
      "Rules Ü5 and Ü6 a (known limit): the offer hands over the renamed tournament. The organizer withdraws it and renames again; organizer 2 accepts inside the offer's time without having seen either. The acceptance ends the tenure: the withdrawal and the second rename are cut, the first rename (handed over) stays.",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("rename", "organizer", "tournament.update", { prev: root, name: "Herbstcup 2025" }, { at: 5, root })
    c.put("offer", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(10) + OFFER_OPEN, core: c.id("rename") }, { at: 10, root })
    c.put("cancel", "organizer", "tournament.handover.cancel", { offer: c.id("offer") }, { at: 20, root })
    c.put("rename-again", "organizer", "tournament.update", { prev: c.id("rename"), name: "Wintercup" }, { at: 25, root })
    c.put("accept", "organizer2", "tournament.handover.accept", { offer: c.id("offer"), core: c.id("rename") }, { at: 30, root })
    cases.push(
      c.done({
        applied: ["found", "rename", "offer", "accept"],
        rejected: [
          ["cancel", "superseded"],
          ["rename-again", "superseded"],
        ],
        state: { organizer: "organizer2", name: "Herbstcup 2025" },
      }),
    )
  }
  {
    const c = newCase(
      "later-offer-on-stale-base",
      "Rules Ü4 and Ü5: organizer 2 takes over, then offers the organization on an outdated base (the first offer instead of their own acceptance). That offer is a visible conflict and its acceptance does not hold; since an end only reaches back to the start of the outgoing tenure, it cannot cut the acceptance that began it: organizer 2 stays.",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("offer-1", "organizer", "tournament.handover.offer", { to: pub("organizer2"), prev: root, expires: at(10) + OFFER_OPEN, core: root }, { at: 10, root })
    c.put("accept-1", "organizer2", "tournament.handover.accept", { offer: c.id("offer-1"), core: root }, { at: 20, root })
    c.put("offer-2", "organizer2", "tournament.handover.offer", { to: pub("organizer3"), prev: c.id("offer-1"), expires: at(30) + OFFER_OPEN, core: root }, { at: 30, root })
    c.put("accept-2", "organizer3", "tournament.handover.accept", { offer: c.id("offer-2"), core: root }, { at: 40, root })
    cases.push(
      c.done({
        applied: ["found", "offer-1", "accept-1"],
        rejected: [
          ["offer-2", "stale_predecessor"],
          ["accept-2", "no_open_offer"],
        ],
        state: { organizer: "organizer2" },
      }),
    )
  }
  {
    const c = newCase(
      "missing-registration",
      "A decision on a place whose registration this reader has not loaded waits for it, like any change on a missing base; it is not refused as 'not registered'.",
    )
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    // p1's registration never reached this reader.
    const lost = record("p1", "tournament.register", {}, { at: 10, root }).event
    c.put("p2", "p2", "tournament.register", {}, { at: 11, root })
    c.put("admit-p1", "organizer", "tournament.admit", { participant: pub("p1"), prev: lost.id }, { at: 20, root })
    c.put("admit-p2", "organizer", "tournament.admit", { participant: pub("p2"), prev: c.id("p2") }, { at: 21, root })
    cases.push(
      c.done({
        applied: ["found", "p2", "admit-p2"],
        unapplied: [["admit-p1", "waiting"]],
        state: { participants: { p2: "registered" } },
      }),
    )
  }
  {
    const c = newCase("rules-locked-and-unknown", "Rules cannot change once drawn, details can. A registration in a newer format version is kept, not executed.")
    c.put("found", "organizer", "tournament.found", cup({ checkIn: false }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("guest-1", "organizer", "tournament.guest", { guest: G, alias: "Gast 1" }, { at: 10, root })
    c.put("guest-2", "organizer", "tournament.guest", { guest: G2, alias: "Gast 2" }, { at: 11, root })
    c.put("p3-v2", "p3", "tournament.register", {}, { at: 12, root, version: "2" })
    c.put("draw", "organizer", "tournament.draw", { seed: SEED, seeded: [], order: order(SEED, [G, G2]), prev: root }, { at: 20, root })
    c.put("rules", "organizer", "tournament.update", { prev: c.id("draw"), rules: { ...rules501, legsToWin: 3 } }, { at: 30, root })
    c.put("place", "organizer", "tournament.update", { prev: c.id("draw"), place: "Vereinsheim, Saal 2" }, { at: 31, root })
    cases.push(
      c.done({
        applied: ["found", "guest-1", "guest-2", "draw", "place"],
        rejected: [["rules", "rules_locked"]],
        unapplied: [["p3-v2", "unknown"]],
        state: { phase: "drawn", place: "Vereinsheim, Saal 2" },
      }),
    )
  }
  const CLUB = hex32("tournament-club")
  {
    const c = newCase(
      "club-tournament",
      "A club's tournament: founded by a director of the club, so it counts for the club. Nothing after the founding depends on the club's roles, which its owner and admins can date back: the hand-over to a plain member holds (lib/tournaments offers the organization only to the club's owner, admins and directors).",
    )
    c.put("found", "director", "tournament.found", cup({ club: CLUB }), { at: 0 })
    c.setRoot("found")
    const root = c.root()
    c.put("offer", "director", "tournament.handover.offer", { to: pub("member"), prev: root, expires: at(10) + OFFER_OPEN, core: root }, { at: 10, root })
    c.put("accept", "member", "tournament.handover.accept", { offer: c.id("offer"), core: root }, { at: 20, root })
    cases.push(
      c.done({ applied: ["found", "offer", "accept"], state: { organizer: "member", club: { id: CLUB, verified: true } } }, { clubRoles: { director: "director", member: "member" } }),
    )
  }
  {
    const c = newCase("club-tournament-by-member", "A plain member founds a tournament naming the club: it is a tournament, but not one of the club's.")
    c.put("found", "member", "tournament.found", cup({ club: CLUB }), { at: 0 })
    c.setRoot("found")
    cases.push(c.done({ applied: ["found"], state: { organizer: "member", club: { id: CLUB, verified: false } } }, { clubRoles: { director: "director", member: "member" } }))
  }
  {
    const c = newCase("newer-engine", "A tournament built with newer bracket rules is kept, never run with today's rules.")
    c.put("found", "organizer", "tournament.found", cup({ engine: 2 }), { at: 0 })
    c.setRoot("found")
    cases.push(c.done({ problem: "unknown_version" }))
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

function snapshot(author: string, root: string, auth: SignedEvent, sv: number, n: number, atSeconds: number, extra: { version?: string; link?: string } = {}) {
  const log = sampleLog().slice(0, Math.min(9, 3 * n))
  const content = liveContent({ state: replay(gameConfig(), log), throws: log, sv, n, status: "playing", auth })
  return record(author, "match.live", content, { at: atSeconds, root, d: root, ...extra })
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
    const c = newCase(
      "session-handover",
      "The match moves to another device: session 2 replaces session 1. Session 1's snapshots and results after the handover are refused, and so is a result session 1 dated before the handover: a handed-over session key is worthless for results.",
    )
    const found = c.put("found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    c.add("live-1", snapshot("session1", root, found, 1, 1, 100).event)
    c.add("result-backdated", result("session1", root, 1, 190, { auth: found }).event)
    const hand = c.put("handover", "host", "match.session", session(2, "session2", 200, root), { at: 200, root })
    c.add("live-2", snapshot("session2", root, hand, 2, 2, 210).event)
    c.add("live-old", snapshot("session1", root, found, 1, 3, 220).event)
    c.add("result-old", result("session1", root, 1, 230, { auth: found }).event)
    c.add("result", result("session2", root, 2, 240, { auth: hand }).event)
    cases.push(
      c.done({
        applied: ["found", "live-1", "handover", "live-2", "result"],
        rejected: [
          ["result-backdated", "session_superseded"],
          ["live-old", "session_superseded"],
          ["result-old", "session_superseded"],
        ],
        state: { sv: 2, writer: "session2", live: "live-2", result: "result" },
      }),
    )
  }
  {
    const c = newCase(
      "forged-handover",
      "Only the match authority hands over, always to the next session on top of the current one; strangers cannot write. A handover on a session this reader has not loaded waits for it.",
    )
    const found = c.put("found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    c.put("by-session", "session1", "match.session", session(2, "session2", 100, root), { at: 100, root })
    c.put("skip", "host", "match.session", session(3, "session2", 110, root), { at: 110, root })
    c.put("wrong-prev", "host", "match.session", session(2, "session2", 120, c.id("by-session")), { at: 120, root })
    c.put("unknown-prev", "host", "match.session", session(3, "session2", 125, hex32("not-loaded-session")), { at: 125, root })
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
        unapplied: [["unknown-prev", "waiting"]],
        state: { sv: 1, writer: "session1" },
      }),
    )
  }
  {
    const c = newCase("session-window", "A session writes only inside its window, and a snapshot must carry its own session's authorization.")
    const found = c.put("found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    const hand = c.put("handover", "host", "match.session", session(2, "session2", 100, root), { at: 100, root })
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
    const c = newCase(
      "confirm-and-correct",
      "Players confirm or dispute one exact result. A correction replaces it and its verdicts no longer count; only seated players give verdicts; a second result must name the one it replaces, and one naming a result this reader has not loaded waits for it.",
    )
    const found = c.put("found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    c.add("result-1", result("session1", root, 1, 100, { auth: found }).event)
    c.put("p1-confirms", "p1", "match.confirm", { result: c.id("result-1"), verdict: "confirm", seat: 0 }, { at: 110, root })
    c.put("p2-disputes", "p2", "match.confirm", { result: c.id("result-1"), verdict: "dispute", seat: 1, reason: "Letzte Aufnahme war 45" }, { at: 111, root })
    c.put("mallory-confirms", "mallory", "match.confirm", { result: c.id("result-1"), verdict: "confirm", seat: 0 }, { at: 112, root })
    c.add("unlinked", result("host", root, 1, 115).event)
    c.add("replaces-unloaded", result("host", root, 1, 116, { replaces: hex32("result-not-loaded"), reason: "Korrektur" }).event)
    c.add("result-2", result("host", root, 1, 120, { replaces: c.id("result-1"), reason: "Aufnahme korrigiert", legs: [0, 1], winner: 1 }).event)
    c.put("p2-confirms", "p2", "match.confirm", { result: c.id("result-2"), verdict: "confirm", seat: 1 }, { at: 130, root })
    cases.push(
      c.done({
        applied: ["found", "result-1", "p1-confirms", "p2-disputes", "result-2", "p2-confirms"],
        rejected: [
          ["mallory-confirms", "not_a_player"],
          ["unlinked", "stale_predecessor"],
        ],
        unapplied: [["replaces-unloaded", "waiting"]],
        state: { result: "result-2", confirmations: { 1: "confirm" }, stale: 2 },
      }),
    )
  }
  {
    const c = newCase(
      "late-seat",
      "Players connect their phones after the founding: the authority gives each its seat with match.seat, and from then on that key gives the seat's verdict. A verdict before the seat, a seat given by the session key or for a seat that doesn't exist, and a verdict after the seat was freed don't count.",
    )
    const seats = [{ alias: "Mia" }, { alias: "Jonas" }]
    const found = c.put("found", "host", "match.session", session(1, "session1", 0, undefined, { agreement: agreement({ seats }) }), { at: 0 })
    c.setRoot("found")
    const root = found.id
    c.add("result", result("session1", root, 1, 100, { auth: found }).event)
    c.put("p1-too-early", "p1", "match.confirm", { result: c.id("result"), verdict: "confirm", seat: 0 }, { at: 110, root })
    c.put("seat-p1", "host", "match.seat", { seat: 0, player: { pubkey: pub("p1"), profile: true } }, { at: 120, root })
    c.put("seat-by-session", "session1", "match.seat", { seat: 1, player: { pubkey: pub("mallory"), profile: true } }, { at: 121, root })
    c.put("seat-missing", "host", "match.seat", { seat: 5, player: { pubkey: pub("mallory"), profile: false } }, { at: 122, root })
    c.put("p1-confirms", "p1", "match.confirm", { result: c.id("result"), verdict: "confirm", seat: 0 }, { at: 130, root })
    c.put("seat-guest", "host", "match.seat", { seat: 1, player: { pubkey: pub("guest1"), profile: false } }, { at: 140, root })
    c.put("guest-disputes", "guest1", "match.confirm", { result: c.id("result"), verdict: "dispute", seat: 1 }, { at: 150, root })
    c.put("seat-freed", "host", "match.seat", { seat: 1, player: null }, { at: 160, root })
    c.put("guest-confirms", "guest1", "match.confirm", { result: c.id("result"), verdict: "confirm", seat: 1 }, { at: 170, root })
    cases.push(
      c.done({
        applied: ["found", "result", "seat-p1", "p1-confirms", "seat-guest", "guest-disputes", "seat-freed"],
        rejected: [
          ["p1-too-early", "not_a_player"],
          ["seat-by-session", "not_authorized"],
          ["seat-missing", "invalid_content"],
          ["guest-confirms", "not_a_player"],
        ],
        state: { result: "result", confirmations: { 0: "confirm", 1: "dispute" }, seats: [{ key: "p1", profile: true }, null] },
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
    const c = newCase("private-match", "A private match: founding and snapshots are encrypted to the match key from the link; the agreed stake is inside. A snapshot in the clear is refused.", { link: "matchkey" })
    const found = c.put("found", "host", "match.session", session(1, "session1", 0, undefined, { agreement: agreement({ visibility: "private", stake: { msat: 500000, note: "Verlierer zahlt" } }) }), {
      at: 0,
      link: "matchkey",
    })
    c.setRoot("found")
    const live = snapshot("session1", found.id, found, 1, 1, 100, { link: "matchkey" })
    c.add("live", live.event, live.plaintext)
    // A careless writer publishes the next snapshot in the clear: refused, it would leak the game.
    c.add("live-in-clear", snapshot("session1", found.id, found, 1, 2, 110).event)
    cases.push(c.done({ applied: ["found", "live"], rejected: [["live-in-clear", "sealing_required"]], state: { stake: 500000, live: "live" } }))
  }
  {
    const c = newCase("chunked-log", "A long throw log travels in hash-chained pieces; the result names the chain's head, piece count and size.")
    const found = c.put("found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    const root = found.id
    const legs: Throw[] = []
    for (let i = 0; i < 40; i++) legs.push(dart(1), dart(1), dart(1))
    const log = play(config({ startScore: 501, legsToWin: 1 }), [...legs.slice(0, 120), ...miss3()])
    const text = encodeThrows(log)
    const { chunks, head, bytes } = chunkData(text, 64)
    chunks.forEach((piece, i) => c.put(`log-${i}`, "session1", "match.log", piece, { at: 100 + i, root }))
    c.add("result", result("session1", root, 1, 200, { auth: found, throws: undefined, log: { head, total: chunks.length, bytes }, status: "finished", winner: null, legs: [0, 0] }).event)
    cases.push(c.done({ applied: ["found", ...chunks.map((_, i) => `log-${i}`), "result"], rejected: [], state: { result: "result", log: { head, pieces: chunks.length, text } } }))
  }
  {
    const c = newCase("unknown-version", "A snapshot in a newer format version is kept, not executed.")
    const found = c.put("found", "host", "match.session", session(1, "session1", 0), { at: 0 })
    c.setRoot("found")
    c.add("live-v2", snapshot("session1", found.id, found, 1, 1, 100, { version: "2" }).event)
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
  const noRecipient = sign("organizer", {
    ...badgeAwardTemplate({ issuer: pub("organizer"), d: dT, recipient: pub("p1"), evidence: resultId, occasion: tournament }, at(41)),
    tags: [["a", `30009:${pub("organizer")}:${dT}`], ["e", resultId], ["occasion", tournament], ["L", "blueline"], ["l", "badge.award", "blueline"], ["v", "1"]],
  })
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
    return { event: sign(from, pairingTemplate({ message, created_at: at(seconds), recipient: pub(to), ciphertext: nip44To(from, to, plaintext) })), plaintext }
  }
  const announce = { t: "announce" as const, sid, exp: now + 300, mac: announceMac(keys.auth, pub(newDev), sid, now + 300) }
  const packageData = { v: 1, profile: "lib/devices defines this", relays: ["wss://nos.lol"] }
  const steps = {
    announce: { event: sign(newDev, pairingTemplate({ message: announce, created_at: at(400), lookup: keys.lookup })), plaintext: pairingPlaintext(announce) },
    hello: msg(oldDev, newDev, { t: "hello", sid, device: "iPhone von Mia", mac: helloMac(keys.auth, pub(oldDev), pub(newDev), sid) }, 410),
    helloAttacker: msg("attacker", newDev, { t: "hello", sid, device: "iPhone von Mia" }, 411),
    accept: msg(newDev, oldDev, { t: "accept", sid, device: "iPad Wohnzimmer" }, 420),
    package: msg(oldDev, newDev, { t: "package", sid, data: packageData }, 430),
    ack: msg(newDev, oldDev, { t: "ack", sid, hash: shaHex(JSON.stringify(packageData)) }, 440),
    boardJoin: {
      event: sign(newDev, boardTemplate({ recipient: pub(oldDev), ciphertext: nip44To(newDev, oldDev, boardPlaintext({ t: "join", sid, seat: 0, confirm: true })), created_at: at(450) })),
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
      club: encodeLinkPayload({ type: "club", club: hex32("link-club"), invite: hex32("link-invite"), token: hex16("token-1"), relays: ["ws://localhost:10547"] }),
    },
    steps,
  }
}

function boardVectors() {
  const now = at(600)
  const sid = hex16("board-session")
  const join = (from: string, message: Parameters<typeof boardPlaintext>[0] | Record<string, unknown>, seconds: number) => {
    const plaintext = JSON.stringify(message)
    return { event: sign(from, boardTemplate({ recipient: pub("board1"), ciphertext: nip44To(from, "board1", plaintext), created_at: at(seconds) })), plaintext }
  }
  const reply = (to: string, message: Parameters<typeof boardPlaintext>[0], seconds: number) => {
    const plaintext = boardPlaintext(message)
    return { event: sign("board1", boardTemplate({ recipient: pub(to), ciphertext: nip44To("board1", to, plaintext), created_at: at(seconds) })), plaintext }
  }
  // The profile p2 claims the phone key phone2 at this board; the claim travels inside the join.
  const claim = sign("p2", claimTemplate({ board: pub("board1"), sid, key: pub("phone2"), created_at: at(585) }))
  const handoff = (from: string, to: string, message: Parameters<typeof handoffPlaintext>[0] | Record<string, unknown>, seconds: number) => {
    const plaintext = JSON.stringify(message)
    return { event: sign(from, handoffTemplate({ recipient: pub(to), ciphertext: nip44To(from, to, plaintext), created_at: at(seconds) })), plaintext }
  }
  const handoffSid = hex16("handoff-session")
  const game = { match: hex32("handoff-match"), note: "lib/live defines the package" }
  return {
    now,
    sid,
    expires: now + 1800,
    steps: {
      look: join("phone2", { t: "look", sid }, 580),
      table: reply("phone2", { t: "table", sid, match: hex32("board-match"), rules: { ...rules501, legsToWin: 1 }, seats: [{ alias: "Mia", taken: true }, { alias: "Jonas", taken: false }] }, 581),
      join: join("p1", { t: "join", sid, seat: 0, alias: "Mia", confirm: true }, 590),
      seat: reply("p1", { t: "seat", sid, seat: 0 }, 591),
      joinTaken: join("p2", { t: "join", sid, seat: 0, confirm: false }, 592),
      smuggled: join("p2", { t: "join", sid, seat: 1, confirm: false, nsec: "nsec1…" }, 593),
      packageToBoard: join("p2", { t: "package", sid, data: { key: "…" } }, 594),
      claimJoin: join("phone2", { t: "join", sid, seat: 1, confirm: true, profile: claim }, 595),
      claimForOtherPhone: join("phone3", { t: "join", sid, seat: 1, confirm: true, profile: claim }, 596),
      seatWithKey: reply("phone2", { t: "seat", sid, seat: 1, match: hex32("board-match"), key: sec("matchkey") }, 597),
      handoffGameToBoard: join("board2", { t: "game", sid, data: game }, 598),
      leaveWithClaim: join("phone2", { t: "leave", sid, profile: claim }, 599),
    },
    handoff: {
      sid: handoffSid,
      link: encodeLinkPayload({ type: "handoff", pubkey: pub("board1"), sid: handoffSid, expires: now + 300, relays: ["wss://nos.lol"] }),
      checkCode: pairingCheckCode(pub("board2"), pub("board1"), handoffSid),
      take: handoff("board2", "board1", { t: "take", sid: handoffSid }, 610),
      game: handoff("board1", "board2", { t: "game", sid: handoffSid, data: game }, 611),
      done: handoff("board2", "board1", { t: "done", sid: handoffSid, hash: shaHex(JSON.stringify(game)) }, 612),
      joinAsHandoff: handoff("board2", "board1", { t: "join", sid: handoffSid, seat: 0, confirm: true }, 613),
    },
  }
}

// ---- Private records, invites, seal, chunks ---------------------------------------------------------

function privateVectors() {
  const dataKey = hex32("data-key")
  const slot = recordSlot(dataKey, "match:7d1c0b6c2f0a4c4b")
  const nonce = fixed("private-nonce").slice(0, 24)
  const fakeCiphertext = fixed("private-ct")
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

const inviteVectors = () =>
  [
    [hex16("token-1"), "alice"],
    [hex16("token-1"), "bob"],
    [hex16("token-2"), "alice"],
  ].map(([token, who]) => ({ token, inviteKey: inviteKeyOf(token), pubkey: pub(who), proof: proof(token, pub(who)), previewKey: bytesToHex(previewKey(token)) }))

// One sealed record with every intermediate value, for an independent implementation.
function sealVectors() {
  const root = hex32("seal-club")
  const content: ContentOf<"club.season.end"> = { season: hex16("season-1") }
  const type = "club.season.end"
  const plaintext = JSON.stringify(content)
  const key = fixed("content-key", "owner", type, 10, plaintext)
  const nonce = fixed("seal-nonce", "owner", type, 10, plaintext).slice(0, 24)
  const { event } = record("owner", type, content, { at: 10, root, seal: ["owner", "alice", "bob"] })
  const envelope = JSON.parse(event.content)
  const hint = (reader: string) => bytesToHex(sha256(new Uint8Array([...utf8ToBytes("blueline-seal-hint-v1"), ...nonce, ...hexToBytes(pub(reader))])).slice(0, 4))
  const token = hex16("token-1")
  const invitePreviewContent: InvitePreview = { name: "Dartfreunde Nord", host: pub("owner"), kind: "group", expires: at(86400) }
  const invite = record("owner", "club.invite", { kind: "group", key: inviteKeyOf(token), expires: at(86400) }, { at: 20, root, seal: ["owner"], preview: { token, content: invitePreviewContent } })
  return {
    sealed: {
      type,
      aad: `blueline-seal-v1:${type}`,
      plaintext,
      contentKey: bytesToHex(key),
      nonce: bytesToHex(nonce),
      readers: ["owner", "alice", "bob"].map((r) => ({ name: r, pubkey: pub(r), hint: hint(r) })),
      envelope,
      event,
    },
    invite: { token, previewKey: bytesToHex(previewKey(token)), previewAad: "blueline-preview-v1", preview: invitePreviewContent, event: invite.event, plaintext: invite.plaintext },
  }
}

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
  format:
    "Events are signed (BIP-340, zero aux randomness) with keys derived as sha256('blueline-vector:' + name). Content keys, nonces and NIP-44 nonces are fixed. Expected outcomes are written by hand from docs/protocol.",
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
  const storage = JSON.parse(readFileSync(`${ROOT}docs/implementation/evidence/P0.01/storage-finished.json`, "utf8"))
  const recorded = JSON.parse(storage["dart-scorer.current-match.v1"]) as { config: ReturnType<typeof config>; throws: Throw[] }
  // Played in the production build with a correction through the app's own correction flow
  // (docs/implementation/evidence/P0.05/scripts/capture-corrected-log.mjs).
  const correctedStorage = JSON.parse(readFileSync(`${ROOT}docs/implementation/evidence/P0.05/storage-corrected.json`, "utf8"))
  const correctedInApp = JSON.parse(correctedStorage["dart-scorer.current-match.v1"]) as { config: ReturnType<typeof config>; throws: Throw[] }
  const c = config({ startScore: 301, legsToWin: 2 })
  const leg1 = [dart(20, 3), dart(20, 3), dart(20, 3), ...miss3(), dart(20, 3), dart(11, 3), dart(14, 2)]
  const leg2 = [dart(20), { kind: "noScore" } as Throw, { kind: "visit", total: 60, darts: 3, atDouble: 1 } as Throw, { kind: "turn", player: 0 } as Throw]
  const played = play(c, [...leg1, ...leg2])
  // Corrected the way the app corrects: the first dart of the first visit was a T19, and the
  // finished first leg keeps its result (lib/game/engine.ts correctDart).
  const plan = correctDart(c, played, visitBySeq(replay(c, played), 0)!, 0, { segment: 19, multiplier: 3 })
  const corrected = plan.keepResult ? plan.keepResult.throws : plan.rescored
  const logs = [
    { description: "Recorded P0.01 game (Anna vs Ben, 301), as stored by the app", config: recorded.config, log: recorded.throws },
    { description: "Recorded P0.05 game with a correction in the app (Ben's second dart 19 corrected to 5), as stored", config: correctedInApp.config, log: correctedInApp.throws },
    { description: "Two legs, the first dart corrected (edited, leg result kept), no-score, a visit total and a turn", config: c, log: JSON.parse(JSON.stringify(corrected)) as Throw[] },
    { description: "Log saved before throws were tagged", config: config(), log: [dart(20), dart(25, 2), dart(0)] },
  ]
  return { alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-", cases: logs.map((l) => ({ ...l, encoded: encodeThrows(l.log) })) }
}

export function buildVectors(): Record<string, unknown> {
  return {
    club: family("club", "Club founding and changes, replayed by reduceClub (lib/protocol/club-state.ts) as read by `reader`.", () => ({ cases: clubCases() })),
    tournament: family("tournament", "Tournament founding and changes, replayed by reduceTournament (lib/protocol/tournament-state.ts).", () => ({ cases: tournamentCases() })),
    match: family("match", "Match session authorization, live snapshots and results, replayed by reduceMatch (lib/protocol/match-state.ts).", () => ({ cases: matchCases() })),
    "payment-request": family("payment-request", "Unwrapped payment request rumors checked by checkPaymentRequest (lib/protocol/payment.ts).", () => ({ cases: paymentCases() })),
    badges: family("badges", "NIP-58 definitions and awards checked by checkBadgeAward (lib/protocol/badges.ts).", badgeCases),
    pairing: family("pairing", "Device pairing: code, check code, links and the message sequence (lib/protocol/pairing.ts).", pairingVectors),
    "board-join": family("board-join", "Joining a shared board (lib/protocol/board.ts) and handing a match to another device (lib/protocol/handoff.ts).", boardVectors),
    "private-records": family("private-records", "Private record slots, data key slot and envelope (lib/protocol/private.ts).", privateVectors),
    invite: family(
      "invite",
      "Invite keys HKDF-SHA256(token, 'blueline-invite-v1', 'proof') with their x-only public keys, join proofs as BIP-340 signatures of that key over sha256('blueline-invite-v1:' + joiner pubkey) (zero aux randomness here; any aux gives a valid proof), and preview keys HKDF-SHA256(token, 'blueline-invite-v1', 'preview').",
      () => ({
        cases: inviteVectors(),
      }),
    ),
    seal: family("seal", "A sealed record of a closed club and an invite with its preview, with every intermediate value (lib/protocol/seal.ts).", sealVectors),
    chunks: family("chunks", "Hash-chained pieces (lib/protocol/chunks.ts).", chunkVectors),
    throws: family("throws", "Compact throw logs (lib/protocol/throws.ts): engine log as stored and its encoding.", throwVectors),
  }
}

const FAMILY_OF: Record<string, string> = { club: "club", tournament: "tournament", match: "match", payment: "payment-request", profile: "profile" }

export function buildSchemas(): Record<string, JsonSchema> {
  const families: Record<string, Record<string, JsonSchema>> = {}
  for (const [type, spec] of Object.entries(RECORD_TYPES)) {
    const family = FAMILY_OF[type.split(".")[0]]
    ;(families[family] ??= {})[type] = { description: spec.description, kind: spec.kind, encryption: spec.encryption, ...("encrypted" in spec ? { encrypted: true } : {}), ...spec.schema.json() }
  }
  families.club["club.invite#preview"] = { description: "Preview in the invite's envelope, opened with the link token (invite.ts)", ...invitePreview.json() }
  const out: Record<string, JsonSchema> = {}
  const doc = (title: string, defs: Record<string, JsonSchema>) => ({ $schema: "https://json-schema.org/draft/2020-12/schema", title, $defs: defs })
  for (const [family, defs] of Object.entries(families)) out[family] = doc(`BlueLine ${family} record content`, defs)
  const messages = (m: Record<string, Schema<unknown>>) => Object.fromEntries(Object.entries(m).map(([k, s]) => [k, s.json()]))
  out.pairing = doc("BlueLine pairing messages (decrypted content of kind 21180)", messages(PAIRING_MESSAGES))
  out["board-join"] = doc("BlueLine board join and handoff messages (decrypted content of kind 21180, labels board and handoff)", {
    ...messages(BOARD_MESSAGES),
    ...Object.fromEntries(Object.entries(messages(HANDOFF_MESSAGES)).map(([k, v]) => [`handoff.${k}`, v])),
  })
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
