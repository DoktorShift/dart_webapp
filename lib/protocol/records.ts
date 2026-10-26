import { nowSeconds } from "../nostr/time.ts"
import type { EventTemplate } from "../nostr/types.ts"
import { BADGE_TYPES } from "./badges.ts"
import { CLUB_TYPES, MAX_SHARED_KEYS } from "./club.ts"
import type { RecordSpec } from "./common.ts"
import { FRIEND_TYPES } from "./friend.ts"
import type { InvitePreview } from "./invite.ts"
import { previewPlaintext } from "./invite.ts"
import { FORMAT_VERSION, KIND_RECORD, KIND_STATE, MAX_EVENT_BYTES, MAX_FUTURE_SKEW_SECONDS, MAX_OFFER_SECONDS, MAX_SEALED_PLAINTEXT_BYTES } from "./kinds.ts"
import { LIVE_TYPES } from "./live.ts"
import { MATCH_TYPES } from "./match.ts"
import { PAYMENT_TYPES } from "./payment.ts"
import { PROFILE_TYPES } from "./profile.ts"
import type { Reason } from "./reasons.ts"
import { ProtocolError } from "./reasons.ts"
import type { Infer } from "./schema.ts"
import { SchemaError, utf8Length } from "./schema.ts"
import { buildEnvelope, MAX_SEAL_READERS, parseEnvelope } from "./seal.ts"
import type { SignedEvent } from "./tags.ts"
import { encryptionOf, HEX64, isSignedEventShape, linkKeyTag, oversizedTag, readLabels, recordTags, SEAL_TAG, signedEventBytes, tagValue, tagValues } from "./tags.ts"
import { TOURNAMENT_TYPES } from "./tournament.ts"

// Every BlueLine record type (kinds 1180 and 31180), its content schema, and the two generic
// operations on them: build an unsigned template (never an invalid one) and parse a received
// event into a typed record (or say exactly why not). Signatures are checked by lib/nostr
// before parsing; authority is checked by the state reducers after it.

// Rumors that only ever travel inside a NIP-59 gift wrap to one person; signed and published as
// events they are refused.
export const GIFT_WRAPPED_ONLY: readonly string[] = ["payment.request", "club.invitation", ...Object.keys(FRIEND_TYPES)]

export const RECORD_TYPES = { ...CLUB_TYPES, ...TOURNAMENT_TYPES, ...MATCH_TYPES, ...LIVE_TYPES, ...PAYMENT_TYPES, ...PROFILE_TYPES, ...BADGE_TYPES, ...FRIEND_TYPES }
export type RecordType = keyof typeof RECORD_TYPES
export type ContentOf<T extends RecordType> = Infer<(typeof RECORD_TYPES)[T]["schema"]>

const specOf = (type: string): RecordSpec | undefined => (RECORD_TYPES as Record<string, RecordSpec>)[type]

export interface BlueLineRecord<T extends RecordType = RecordType> {
  type: T
  content: ContentOf<T>
  id: string
  pubkey: string
  created_at: number
  kind: number
  // The club, tournament or match this record belongs to; its own id for a founding.
  root: string
  d: string | null
  // How the content travelled: in the clear, sealed for its readers, or to a link key.
  encryption: "none" | "seal" | "link"
  linkKey: string | null
  event: SignedEvent
}

// A record narrowed by its type: `if (r.type === "club.join") r.content.invite …`
export type AnyRecord = { [T in RecordType]: BlueLineRecord<T> }[RecordType]

export type ParseResult =
  | { status: "ok"; record: AnyRecord }
  // A newer type, format or seal version: kept and shown, never executed (docs/protocol/kinds.md).
  | { status: "unknown"; event: SignedEvent; type: string; version: string }
  // Encrypted, and this reader has no plaintext for it (not wrapped for them, or no link key).
  | { status: "sealed"; event: SignedEvent; type: RecordType; form: "seal" | "link"; root: string }
  | { status: "invalid"; event: SignedEvent; reason: Reason; detail: string; type?: string }

const rootRule = (spec: RecordSpec, content: unknown): "self" | "required" => {
  if (spec.root !== "session") return spec.root
  return (content as { sv?: number }).sv === 1 ? "self" : "required"
}

// Cross-field rules a schema cannot see because they involve tags or encryption.
function envelopeProblem(type: string, content: unknown, form: "none" | "seal" | "link"): Reason | "private_in_clear" | null {
  if (type === "match.session") {
    const a = (content as { agreement?: { visibility: string; stake?: unknown } }).agreement
    if (a && a.stake !== undefined && (a.visibility !== "private" || form !== "link")) return "stake_requires_private"
    if (a && a.visibility === "private" && form !== "link") return "private_in_clear"
  }
  return null
}

// Rule Ü1 (docs/protocol/conflicts.md, "Übergaben"): a hand-over offer is open from its own
// date on, for at most MAX_OFFER_SECONDS.
function offerWindowProblem(type: string, content: unknown, createdAt: number): string | null {
  if (type !== "club.owner.offer" && type !== "tournament.handover.offer") return null
  const { expires } = content as { expires: number }
  return expires > createdAt && expires <= createdAt + MAX_OFFER_SECONDS ? null : `an offer expires after its date, at most ${MAX_OFFER_SECONDS / 86400} days later`
}

function checkContent(spec: RecordSpec, type: string, content: unknown): unknown {
  try {
    return spec.schema.check(content, "")
  } catch (e) {
    throw new ProtocolError("invalid_content", e instanceof SchemaError ? e.message : `${type}: ${String(e)}`)
  }
}

export function buildRecord<T extends RecordType>(
  type: T,
  content: ContentOf<T>,
  opts: { created_at: number; root?: string; d?: string; relay?: string },
): EventTemplate {
  const spec = specOf(type) as RecordSpec
  const checked = checkContent(spec, type, content)
  const rule = rootRule(spec, checked)
  if (rule === "self" && opts.root !== undefined) throw new ProtocolError("invalid_tags", `${type} founds its object and has no root`)
  if (rule === "required" && (opts.root === undefined || !HEX64.test(opts.root))) throw new ProtocolError("invalid_tags", `${type} needs its root id`)
  if (spec.d && opts.d === undefined) throw new ProtocolError("invalid_tags", `${type} needs a d tag`)
  if (type === "match.live" && opts.d !== opts.root) throw new ProtocolError("invalid_tags", "the live snapshot's d is its match id")
  if (type === "match.session") {
    const a = (checked as { agreement?: { visibility: string; stake?: unknown } }).agreement
    // Built in the clear first; a private agreement goes through encryptForLinkKey before signing.
    if (a?.stake !== undefined && a.visibility !== "private") throw new ProtocolError("stake_requires_private", "a stake is only written into a private match")
  }
  const offerWindow = offerWindowProblem(type, checked, opts.created_at)
  if (offerWindow) throw new ProtocolError("invalid_content", offerWindow)
  const template = {
    kind: spec.kind,
    created_at: opts.created_at,
    tags: recordTags(type, { root: opts.root, d: spec.d ? opts.d : undefined, relay: opts.relay }),
    content: JSON.stringify(checked),
  }
  const tag = oversizedTag(template.tags)
  if (tag) throw new ProtocolError("tag_too_long", `tag ${tag}`)
  if (signedEventBytes(template) > MAX_EVENT_BYTES) throw new ProtocolError("too_large", `${type} exceeds ${MAX_EVENT_BYTES} bytes`)
  return template
}

const specOfTemplate = (template: EventTemplate): { type: string; spec: RecordSpec } => {
  const labels = readLabels(template.tags)
  const spec = labels ? specOf(labels.type) : undefined
  if (!labels || !spec) throw new ProtocolError("not_blueline", "not a BlueLine record")
  if (encryptionOf(template.tags).form !== "none") throw new ProtocolError("invalid_tags", "already encrypted")
  return { type: labels.type, spec }
}

// Seals a plaintext template for its readers (closed clubs): encrypts the content under a fresh
// content key and carries the readers' NIP-44 wraps of that key (seal.ts). Only club.invite
// carries a preview, encrypted for whoever holds the invite link.
export function sealRecord(
  template: EventTemplate,
  seal: { key: Uint8Array; nonce: Uint8Array; wraps: readonly { reader: string; payload: string }[]; preview?: { key: Uint8Array; nonce: Uint8Array; content: InvitePreview } },
): EventTemplate {
  const { type, spec } = specOfTemplate(template)
  if (spec.encryption !== "seal") throw new ProtocolError("invalid_tags", `${type} is never sealed`)
  if ((seal.preview !== undefined) !== (type === "club.invite")) throw new ProtocolError("invalid_content", "an invite, and only an invite, carries a preview")
  if (utf8Length(template.content) > MAX_SEALED_PLAINTEXT_BYTES) throw new ProtocolError("too_large", "plaintext too large to seal")
  const content = buildEnvelope({
    type,
    plaintext: template.content,
    key: seal.key,
    nonce: seal.nonce,
    wraps: seal.wraps,
    ...(seal.preview ? { preview: { key: seal.preview.key, nonce: seal.preview.nonce, plaintext: previewPlaintext(seal.preview.content) } } : {}),
  })
  const sealed = { ...template, tags: [...template.tags, SEAL_TAG], content }
  if (signedEventBytes(sealed) > MAX_EVENT_BYTES) throw new ProtocolError("too_large", "sealed event exceeds the budget; wrap for fewer readers or split the content")
  return sealed
}

// How many content keys one club.keys record can share when it is sealed for `readers` readers:
// the readers' wraps (about 190 bytes each) and the keys (about 180 bytes each once encrypted)
// share one event budget: all 150 for up to 20 readers, 122 for 50, 68 for 100. Measured
// by sealing a record of that size, with room for a relay hint of up to 64 characters on the
// root tag; lib/clubs splits a larger share into several records.
export function maxSharedKeys(readers: number): number {
  if (!Number.isInteger(readers) || readers < 1 || readers > MAX_SEAL_READERS) throw new RangeError(`readers must be 1 to ${MAX_SEAL_READERS}`)
  // A NIP-44 v2 wrap of a 64-character content key is 176 base64 characters.
  const wraps = Array.from({ length: readers }, (_, i) => ({ reader: i.toString(16).padStart(64, "0"), payload: `${"A".repeat(175)}=` }))
  const root = "0".repeat(64)
  const fits = (n: number) => {
    const keys = Array.from({ length: n }, () => [root, root])
    const template = buildRecord("club.keys", { keys }, { created_at: 2 ** 31, root, relay: `wss://${"r".repeat(58)}` })
    try {
      sealRecord(template, { key: new Uint8Array(32), nonce: new Uint8Array(24), wraps })
      return true
    } catch (e) {
      if (e instanceof ProtocolError && e.reason === "too_large") return false
      throw e
    }
  }
  let low = 0
  let high = MAX_SHARED_KEYS
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (fits(mid)) low = mid
    else high = mid - 1
  }
  return low
}

// Replaces the plaintext content with its NIP-44 encryption to a link key (private match) and
// marks it. Encrypting is lib/nostr's job; this only checks the type and the size.
export function encryptForLinkKey(template: EventTemplate, linkPubkey: string, ciphertext: string): EventTemplate {
  const { type, spec } = specOfTemplate(template)
  if (spec.encryption !== "link") throw new ProtocolError("invalid_tags", `${type} is not encrypted to a link key`)
  if (!HEX64.test(linkPubkey)) throw new ProtocolError("invalid_tags", "link key is not a pubkey")
  if (utf8Length(template.content) > MAX_SEALED_PLAINTEXT_BYTES) throw new ProtocolError("too_large", "plaintext too large to encrypt")
  const encrypted = { ...template, tags: [...template.tags, linkKeyTag(linkPubkey)], content: ciphertext }
  if (signedEventBytes(encrypted) > MAX_EVENT_BYTES) throw new ProtocolError("too_large", "encrypted event exceeds the budget")
  return encrypted
}

// Parses a signed BlueLine record. `plaintext` is the decrypted content of an encrypted record,
// when the reader could open it (seal.ts openSealedEvents, or the link key). `now` defaults to the
// app's corrected clock (lib/nostr/time.ts), the one every created_at is signed with: a reader on
// the raw device clock would take a record of its own device for one from the future.
export function parseRecord(event: unknown, opts: { now?: number; plaintext?: string | null } = {}): ParseResult {
  if (!isSignedEventShape(event)) {
    return { status: "invalid", event: event as SignedEvent, reason: "invalid_event", detail: "not a signed event" }
  }
  const invalid = (reason: Reason, detail: string, type?: string): ParseResult => ({ status: "invalid", event, reason, detail, type })
  const now = opts.now ?? nowSeconds()

  if (event.kind !== KIND_RECORD && event.kind !== KIND_STATE) return invalid("wrong_kind", `kind ${event.kind}`)
  const labels = readLabels(event.tags)
  if (!labels) return invalid("not_blueline", "BlueLine labels missing or repeated")
  const { type, version } = labels
  if (signedEventBytes(event) > MAX_EVENT_BYTES) return invalid("too_large", `over ${MAX_EVENT_BYTES} bytes`, type)
  const longTag = oversizedTag(event.tags)
  if (longTag) return invalid("tag_too_long", `tag ${longTag}`, type)
  if (event.created_at > now + MAX_FUTURE_SKEW_SECONDS) return invalid("future_timestamp", `${event.created_at - now} s ahead`, type)

  const spec = specOf(type)
  if (!spec || version !== FORMAT_VERSION) return { status: "unknown", event, type, version }
  if (event.kind !== spec.kind) return invalid("wrong_kind", `${type} is kind ${spec.kind}`, type)
  if (GIFT_WRAPPED_ONLY.includes(type)) return invalid("wrong_kind", `${type} travels only gift-wrapped`, type)

  const roots = tagValues(event.tags, "e")
  if (roots.length > 1) return invalid("invalid_tags", "more than one root", type)
  if (roots.length === 1 && !HEX64.test(roots[0])) return invalid("invalid_tags", "root is not an event id", type)
  const ds = tagValues(event.tags, "d")
  if (spec.d && (ds.length !== 1 || !ds[0])) return invalid("invalid_tags", "d tag missing", type)

  const enc = encryptionOf(event.tags)
  if (enc.form === "malformed") return invalid("invalid_tags", "malformed enc tag", type)
  if (enc.form === "seal" && spec.encryption !== "seal") return invalid("invalid_tags", `${type} is never sealed`, type)
  if (enc.form === "link" && spec.encryption !== "link") return invalid("invalid_tags", `${type} is not encrypted to a link key`, type)
  if (enc.form === "none" && spec.encrypted) return invalid("sealing_required", `${type} is always sealed`, type)
  if (enc.form === "seal") {
    try {
      const envelope = parseEnvelope(event.content)
      if (envelope.preview && type !== "club.invite") return invalid("invalid_content", "only an invite carries a preview", type)
    } catch (e) {
      if (e instanceof ProtocolError && e.reason === "unknown_version") return { status: "unknown", event, type, version: `${version}/${e.detail}` }
      return invalid("invalid_content", e instanceof ProtocolError ? e.detail : "malformed seal", type)
    }
  }
  if (enc.form !== "none" && (opts.plaintext === undefined || opts.plaintext === null)) {
    if (spec.root === "self" && roots.length > 0) return invalid("invalid_tags", `${type} founds its object and has no root`, type)
    if (spec.root === "required" && roots.length !== 1) return invalid("invalid_tags", "root missing", type)
    // The root is readable without the key: a founding (no "e" tag) is its own root.
    return { status: "sealed", event, type: type as RecordType, form: enc.form, root: roots[0] ?? event.id }
  }

  let content: unknown
  try {
    content = spec.schema.check(JSON.parse(enc.form === "none" ? event.content : (opts.plaintext as string)), "")
  } catch (e) {
    return invalid("invalid_content", e instanceof SchemaError ? e.message : "content is not JSON", type)
  }

  const rule = rootRule(spec, content)
  if (rule === "self" && roots.length > 0) return invalid("invalid_tags", `${type} founds its object and has no root`, type)
  if (rule === "required" && roots.length !== 1) return invalid("invalid_tags", "root missing", type)
  const root = rule === "self" ? event.id : roots[0]
  const d = spec.d ? (tagValue(event.tags, "d") as string) : null
  if (type === "match.live" && d !== root) return invalid("invalid_tags", "d differs from the match id", type)
  const offerWindow = offerWindowProblem(type, content, event.created_at)
  if (offerWindow) return invalid("invalid_content", offerWindow, type)
  const problem = envelopeProblem(type, content, enc.form)
  if (problem === "private_in_clear") return invalid("sealing_required", "a private match is encrypted", type)
  if (problem) return invalid(problem, "a stake is only written into a private, encrypted match", type)

  const record = {
    type,
    content,
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    root,
    d,
    encryption: enc.form,
    linkKey: enc.form === "link" ? enc.key : null,
    event,
  }
  return { status: "ok", record: record as AnyRecord }
}
