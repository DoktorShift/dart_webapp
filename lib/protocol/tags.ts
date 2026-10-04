import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils"
import { FORMAT_VERSION, LABEL_NAMESPACE, MAX_TAG_VALUE_BYTES } from "./kinds.ts"
import { utf8Length } from "./schema.ts"

// Tags shared by every BlueLine record (docs/protocol/kinds.md, "Pflicht-Tags"):
//   ["L","blueline"]            NIP-32 namespace
//   ["l","<type>","blueline"]   record type, e.g. "club.join"
//   ["v","1"]                   content format version
//   ["e","<root id>"]           the club, tournament or match the record belongs to
//   ["d","<id>"]                only on 31501
//   ["enc","nip44","<pubkey>"]  only when the content is encrypted to a group key
//   ["alt","BlueLine Darts …"]  NIP-31 summary for other clients

// The shape of a signed event as it arrives from a relay. Signature and id are checked by
// lib/nostr before anything here sees the event.
export interface SignedEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export const HEX64 = /^[0-9a-f]{64}$/
export const HEX32 = /^[0-9a-f]{32}$/
const HEX128 = /^[0-9a-f]{128}$/

export const tagValue = (tags: string[][], name: string): string | undefined => tags.find((t) => t[0] === name)?.[1]
export const tagValues = (tags: string[][], name: string): string[] => tags.filter((t) => t[0] === name).map((t) => t[1])

export function recordTags(type: string, opts: { root?: string; d?: string; relay?: string } = {}): string[][] {
  const tags: string[][] = [
    ["L", LABEL_NAMESPACE],
    ["l", type, LABEL_NAMESPACE],
    ["v", FORMAT_VERSION],
  ]
  if (opts.d !== undefined) tags.push(["d", opts.d])
  if (opts.root !== undefined) tags.push(opts.relay ? ["e", opts.root, opts.relay] : ["e", opts.root])
  tags.push(["alt", `BlueLine Darts ${type}`])
  return tags
}

export const sealTag = (groupPubkey: string) => ["enc", "nip44", groupPubkey]

// The BlueLine labels of an event: type and version, or null when it is not a BlueLine record.
export function readLabels(tags: string[][]): { type: string; version: string } | null {
  if (!tags.some((t) => t[0] === "L" && t[1] === LABEL_NAMESPACE)) return null
  const labels = tags.filter((t) => t[0] === "l" && t[2] === LABEL_NAMESPACE)
  if (labels.length !== 1 || !labels[0][1]) return null
  const versions = tagValues(tags, "v")
  if (versions.length !== 1 || !versions[0]) return null
  return { type: labels[0][1], version: versions[0] }
}

// The group key a sealed event is encrypted to, or null for plaintext content.
export function sealedTo(tags: string[][]): string | null {
  const t = tags.find((x) => x[0] === "enc")
  return t && t[1] === "nip44" && HEX64.test(t[2] ?? "") ? t[2] : null
}

export const hasMalformedSeal = (tags: string[][]) => tags.some((t) => t[0] === "enc") && sealedTo(tags) === null

export function oversizedTag(tags: string[][]): string | null {
  for (const t of tags) for (const v of t) if (utf8Length(v) > MAX_TAG_VALUE_BYTES) return t[0]
  return null
}

export function isSignedEventShape(e: unknown): e is SignedEvent {
  if (typeof e !== "object" || e === null) return false
  const x = e as Record<string, unknown>
  return (
    typeof x.id === "string" &&
    HEX64.test(x.id) &&
    typeof x.pubkey === "string" &&
    HEX64.test(x.pubkey) &&
    typeof x.sig === "string" &&
    HEX128.test(x.sig) &&
    typeof x.kind === "number" &&
    Number.isInteger(x.kind) &&
    x.kind >= 0 &&
    x.kind <= 65535 &&
    typeof x.created_at === "number" &&
    Number.isInteger(x.created_at) &&
    x.created_at >= 0 &&
    typeof x.content === "string" &&
    Array.isArray(x.tags) &&
    x.tags.every((t) => Array.isArray(t) && t.length > 0 && t.every((v) => typeof v === "string"))
  )
}

// Size of the event as a relay receives it. For an unsigned template, id, pubkey and sig are
// counted at their fixed lengths.
export function signedEventBytes(e: { kind: number; tags: string[][]; content: string; created_at: number }) {
  const full = { id: "0".repeat(64), pubkey: "0".repeat(64), created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: "0".repeat(128) }
  return utf8Length(JSON.stringify(full))
}

// NIP-01 event id. Used where an id arrives without a signature to vouch for it: the rumor
// inside a gift wrap (nostr-core's unwrap does not recompute it, research PR-06).
export function eventHash(e: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))))
}

// Replay order of all BlueLine state: created_at, then id (docs/protocol/conflicts.md).
export const byReplayOrder = (a: { created_at: number; id: string }, b: { created_at: number; id: string }) =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
