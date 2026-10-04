import type { EventTemplate } from "../nostr/types.ts"
import { FORMAT_VERSION, KIND_EPHEMERAL, LABEL_NAMESPACE, MAX_EPHEMERAL_AGE_SECONDS, MAX_FUTURE_SKEW_SECONDS } from "./kinds.ts"
import type { Reason } from "./reasons.ts"
import type { Schema } from "./schema.ts"
import { SchemaError } from "./schema.ts"
import type { SignedEvent } from "./tags.ts"
import { HEX64, isSignedEventShape, oversizedTag, readLabels, tagValue, tagValues } from "./tags.ts"

// Ephemeral handshake messages (kind 21501) shared by device pairing and board join. The
// content is NIP-44 encrypted between the two parties (pubkey in the "p" tag); only a pairing
// announce, which has no recipient yet, is plaintext and carries the lookup tag "x". The
// message type sits inside the encrypted content; relays see kind, author, recipient and time.
// Relays do not store these events: senders repeat a message until it is answered.

export type HandshakeDomain = "pair" | "board"

export function handshakeTemplate(domain: HandshakeDomain, opts: { content: string; created_at: number; recipient?: string; lookup?: string }): EventTemplate {
  const tags: string[][] = [
    ["L", LABEL_NAMESPACE],
    ["l", domain, LABEL_NAMESPACE],
    ["v", FORMAT_VERSION],
  ]
  if (opts.recipient !== undefined) tags.push(["p", opts.recipient])
  if (opts.lookup !== undefined) tags.push(["x", opts.lookup])
  return { kind: KIND_EPHEMERAL, created_at: opts.created_at, tags, content: opts.content }
}

export type HandshakeParse<M> =
  | { ok: true; message: M; from: string; to: string | null; at: number; lookup: string | null }
  | { ok: false; reason: Reason; detail: string }

// Checks the envelope and the decrypted (or, for an announce, plain) message. A message from
// the other domain is "wrong_flow": a board never receives a key package and a pairing never
// takes a seat request.
export function parseHandshake<M>(
  domain: HandshakeDomain,
  event: unknown,
  schemas: Record<string, Schema<M>>,
  foreign: readonly string[],
  opts: { plaintext?: string | null; now: number },
): HandshakeParse<M> {
  const no = (reason: Reason, detail: string): HandshakeParse<M> => ({ ok: false, reason, detail })
  if (!isSignedEventShape(event)) return no("invalid_event", "not a signed event")
  const e: SignedEvent = event
  if (e.kind !== KIND_EPHEMERAL) return no("wrong_kind", `kind ${e.kind}`)
  const labels = readLabels(e.tags)
  if (!labels) return no("not_blueline", "BlueLine labels missing")
  if (labels.type !== domain) return no("wrong_flow", `a ${labels.type} message, not ${domain}`)
  if (labels.version !== FORMAT_VERSION) return no("unknown_version", `version ${labels.version}`)
  if (oversizedTag(e.tags)) return no("tag_too_long", "tag too long")
  if (e.created_at > opts.now + MAX_FUTURE_SKEW_SECONDS) return no("future_timestamp", "dated in the future")
  if (e.created_at < opts.now - MAX_EPHEMERAL_AGE_SECONDS) return no("expired_message", "too old")
  const recipients = tagValues(e.tags, "p")
  if (recipients.length > 1 || (recipients.length === 1 && !HEX64.test(recipients[0]))) return no("invalid_tags", "recipient")
  const lookup = tagValue(e.tags, "x") ?? null

  const text = recipients.length === 1 ? opts.plaintext : e.content
  if (text === undefined || text === null) return no("invalid_content", "message not decrypted")
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return no("invalid_content", "not JSON")
  }
  const t = (raw as { t?: unknown })?.t
  if (typeof t !== "string") return no("invalid_content", "message type missing")
  if (foreign.includes(t)) return no("wrong_flow", `"${t}" belongs to the other flow`)
  const schema = schemas[t]
  if (!schema) return no("invalid_content", `unknown message "${t}"`)
  let message: M
  try {
    message = schema.check(raw, "")
  } catch (err) {
    return no("invalid_content", err instanceof SchemaError ? err.message : "invalid")
  }
  return { ok: true, message, from: e.pubkey, to: recipients[0] ?? null, at: e.created_at, lookup }
}
