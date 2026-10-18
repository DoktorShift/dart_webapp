// NIP-55 for web pages: asking an Android signer app (Amber and others) through a nostrsigner:
// link. To be upstreamed to nostr-core (gap NC-07).
//
// The answer comes back as a navigation to the callback URL with the result appended: a new
// page load, maybe a new tab. A request therefore can't be awaited like a Signer call. Store the
// request (createGetPublicKeyRequest / createSignEventRequest) before leaving the page, then on
// return parse the URL (parseCallback), find the stored request (matchPending) and complete it.
//
// The callback URL must end in a fragment name (#signer-return), so results never reach a server
// or its logs. The request's id goes into the callback in front of the result, as
// "#<name>=<id>." with the result right after the dot: Amber (IntentUtils.kt) URL-decodes the
// callback once and splits it at "?" and "&", so neither may appear in it, and the dot survives
// the signer's own URL-encoding of what it appends.
// Decryption is deliberately not offered: plaintext would land in the browser history.
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { loadCore } from "../core.ts"
import type { EventTemplate, VerifiedEvent } from "../types.ts"

export type Nip55Type = "get_public_key" | "sign_event"

export interface Nip55Request {
  id: string
  type: Nip55Type
  createdAt: number
  template?: EventTemplate
  pubkey?: string
}

export interface Nip55Permission {
  type: string
  kind?: number
}

export interface SignerUrlOptions {
  // Where the signer sends the answer, with a fragment, e.g. "https://app.example/#signer-return".
  callbackUrl: string
  // "signature" returns only the signature (short); "event" the signed event.
  returnType?: "signature" | "event"
  // "gzip" makes the signer answer "Signer1" + base64(gzip(...)), for long events.
  compressionType?: "none" | "gzip"
  // Pre-approvals to ask for with get_public_key.
  permissions?: Nip55Permission[]
}

export type Nip55ErrorCode = "rejected" | "mismatch" | "malformed" | "expired" | "unknown-request"

export class Nip55Error extends Error {
  code: Nip55ErrorCode
  constructor(code: Nip55ErrorCode, message: string) {
    super(message)
    this.name = "Nip55Error"
    this.code = code
  }
}

const isHexKey = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)

export function createGetPublicKeyRequest(now = Date.now()): Nip55Request {
  return { id: bytesToHex(randomBytes(16)), type: "get_public_key", createdAt: now }
}

export function createSignEventRequest(template: EventTemplate, pubkey: string, now = Date.now()): Nip55Request {
  if (!isHexKey(pubkey)) throw new Nip55Error("malformed", "the signer's public key is needed to sign")
  const { kind, content, tags, created_at } = template
  return { id: bytesToHex(randomBytes(16)), type: "sign_event", createdAt: now, template: { kind, content, tags, created_at }, pubkey }
}

// The nostrsigner: link to open (as a link the user taps; browsers block scripted navigation
// to app schemes without a user gesture).
export function buildSignerUrl(request: Nip55Request, options: SignerUrlOptions): string {
  const hash = options.callbackUrl.indexOf("#")
  if (hash < 0 || hash === options.callbackUrl.length - 1) throw new Nip55Error("malformed", "the callback URL must end in a fragment name (#signer-return)")
  const callback = `${options.callbackUrl}=${request.id}.`
  const params = new URLSearchParams()
  params.set("type", request.type)
  params.set("returnType", options.returnType ?? "signature")
  params.set("compressionType", options.compressionType ?? "none")
  let payload = ""
  if (request.type === "sign_event") {
    if (!request.template || !request.pubkey) throw new Nip55Error("malformed", "sign_event needs an event and a public key")
    params.set("current_user", request.pubkey)
    payload = encodeURIComponent(JSON.stringify({ ...request.template, pubkey: request.pubkey }))
  } else if (options.permissions?.length) {
    params.set("permissions", JSON.stringify(options.permissions))
  }
  // Encoded, so the callback's own "#" stays part of the parameter instead of ending the link.
  params.set("callbackUrl", callback)
  return `nostrsigner:${payload}?${params.toString()}`
}

export interface Nip55Callback {
  id: string
  // As the signer sent it ("" when it sent nothing, which is how a refusal looks).
  result: string
}

// Reads a signer's answer ("#<marker>=<id>.<result>") from the page URL, or null when the URL is
// not an answer. `marker` is the fragment name the callback URL ended with.
export function parseCallback(url: string, marker = "signer-return"): Nip55Callback | null {
  const hash = url.indexOf("#")
  if (hash < 0) return null
  const fragment = url.slice(hash + 1)
  if (!fragment.startsWith(`${marker}=`)) return null
  const match = /^([0-9a-f]{32})\.([\s\S]*)$/.exec(fragment.slice(marker.length + 1))
  if (!match) return null
  // Signers append the result raw or URL-encoded; base64 "+" must survive either way.
  let result = match[2]
  if (result.includes("%")) {
    try {
      result = decodeURIComponent(result)
    } catch {
      throw new Nip55Error("malformed", "unreadable answer")
    }
  }
  return { id: match[1], result }
}

// The stored request an answer belongs to. Old requests don't count: a link from the history
// must not complete a new action.
export function matchPending(pending: readonly Nip55Request[], callback: Nip55Callback, options: { now?: number; maxAgeMs?: number } = {}): Nip55Request {
  const request = pending.find((candidate) => candidate.id === callback.id)
  if (!request) throw new Nip55Error("unknown-request", "no request is waiting for this answer")
  if ((options.now ?? Date.now()) - request.createdAt > (options.maxAgeMs ?? 15 * 60 * 1000)) throw new Nip55Error("expired", "the request is too old")
  return request
}

// Undoes "Signer1" + base64(gzip(...)); other results pass through.
export async function decodeResult(result: string): Promise<string> {
  if (!result.startsWith("Signer1")) return result
  try {
    const base64 = result.slice("Signer1".length).replace(/-/g, "+").replace(/_/g, "/")
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
    return await new Response(stream).text()
  } catch {
    throw new Nip55Error("malformed", "unreadable compressed answer")
  }
}

// The user's public key from a get_public_key answer (hex or npub).
export async function completeGetPublicKey(request: Nip55Request, callback: Nip55Callback): Promise<string> {
  if (request.type !== "get_public_key" || callback.id !== request.id) throw new Nip55Error("unknown-request", "answer for another request")
  const result = (await decodeResult(callback.result)).trim()
  if (!result) throw new Nip55Error("rejected", "the signer sent no key")
  if (isHexKey(result)) return result
  try {
    const core = await loadCore()
    const decoded = core.nip19.decode(result)
    if (decoded.type === "npub" && isHexKey(decoded.data)) return decoded.data
  } catch {
    // fall through
  }
  throw new Nip55Error("malformed", "the signer sent no valid public key")
}

// The signed event from a sign_event answer (a signature, or the event itself), checked against
// what was asked for: same key, same content, valid signature.
export async function completeSignEvent(request: Nip55Request, callback: Nip55Callback): Promise<VerifiedEvent> {
  if (request.type !== "sign_event" || callback.id !== request.id || !request.template || !request.pubkey) throw new Nip55Error("unknown-request", "answer for another request")
  const result = (await decodeResult(callback.result)).trim()
  if (!result) throw new Nip55Error("rejected", "the signer sent no signature")
  const core = await loadCore()
  const { template, pubkey } = request
  let event: { id?: unknown; pubkey?: unknown; sig?: unknown; kind?: unknown; content?: unknown; tags?: unknown; created_at?: unknown }
  if (/^[0-9a-f]{128}$/.test(result)) {
    event = { ...template, pubkey, id: core.getEventHash({ ...template, pubkey }), sig: result }
  } else {
    try {
      event = JSON.parse(result)
    } catch {
      throw new Nip55Error("malformed", "the signer sent neither a signature nor an event")
    }
  }
  const same =
    event.pubkey === pubkey &&
    event.kind === template.kind &&
    event.content === template.content &&
    event.created_at === template.created_at &&
    JSON.stringify(event.tags) === JSON.stringify(template.tags) &&
    typeof event.id === "string" &&
    typeof event.sig === "string"
  if (!same) throw new Nip55Error("mismatch", "the signer signed something else")
  const signed = { id: event.id as string, pubkey, created_at: template.created_at, kind: template.kind, tags: template.tags, content: template.content, sig: event.sig as string }
  if (!core.verifyEventSignature(signed)) throw new Nip55Error("mismatch", "the signature is not valid")
  return Object.assign(signed, { [core.verifiedSymbol]: true }) as VerifiedEvent
}
