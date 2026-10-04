// NIP-46 remote signing: the parts nostr-core 1.0.4 lacks. To be upstreamed to nostr-core
// (gaps NC-04, NC-05 in docs/implementation/evidence/P0.03/CORE.md).
//
// - The client-initiated nostrconnect:// flow: the app shows a QR code, a signer app (Amber,
//   nsec.app, ...) scans it and answers with the secret; the app learns the signer's key from
//   that answer. nostr-core only knows bunker:// and misreads the nostrconnect:// host.
// - A Signer over kind 24133 with NIP-44 that listens on all relays, keeps a request pending
//   through an auth_url challenge, offers ping, switch_relays and logout, and resumes a stored
//   session after a reload without sending connect again (a connect secret is single-use).
//
// Signed events coming back are not verified here; wrap the signer in verifyingSigner()
// (../signers.ts). A request that gets no answer fails with code "timeout": the signer may still
// have done it, so callers must treat that as unknown, not as refused.
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js"
import { loadCore } from "../core.ts"
import { nowSeconds } from "../time.ts"
import type { EventTemplate, Filter, NostrEvent, Signer, VerifiedEvent } from "../types.ts"

export const NIP46_KIND = 24133

// What a stored session needs to come back after a reload. The client key never leaves the
// device; whoever holds it can ask the signer for signatures until the signer revokes it.
export interface Nip46Session {
  clientSecretKey: string
  remoteSignerPubkey: string
  userPubkey: string
  relays: string[]
}

// The relay access the signer needs; lib/nostr/client.ts provides it.
export interface Nip46Transport {
  // code "timeout": the relay didn't answer in time, so it may have passed the request on.
  publish(event: NostrEvent, relays: readonly string[]): Promise<{ ok: boolean; reason: string; code?: string }[]>
  subscribe(
    filters: Filter[],
    relays: readonly string[],
    handlers: { onevent: (event: NostrEvent) => void; oneose?: () => void },
  ): { close: () => void }
}

export type Nip46ErrorCode = "timeout" | "rejected" | "unreachable" | "closed" | "invalid"

export class Nip46RequestError extends Error {
  code: Nip46ErrorCode
  constructor(code: Nip46ErrorCode, message: string) {
    super(message)
    this.name = "Nip46RequestError"
    this.code = code
  }
}

export interface Nip46SignerOptions {
  transport: Nip46Transport
  // How long a request waits for its answer. Default 60 s.
  timeoutMs?: number
  // The signer wants the user to confirm on a web page first. The request stays pending (for
  // authTimeoutMs) and completes when the signer answers on the same id.
  onAuthUrl?: (url: string) => void
  authTimeoutMs?: number
  // The signer moved the connection to other relays (switch_relays); store the new session.
  onSessionChange?: (session: Nip46Session) => void
}

interface Pending {
  method: string
  resolve: (result: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const randomId = () => bytesToHex(randomBytes(16))
const isHexKey = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
// Signer answers are ephemeral; anything older than this is a leftover, not an answer.
const STALE_SECONDS = 120

// A remote signer reached over relays. Construct it from a session (resume) or through
// connect helpers; it never sends connect itself.
export class Nip46Signer implements Signer {
  session: Nip46Session
  #options: Nip46SignerOptions
  #clientKey: Uint8Array
  #conversationKey: Uint8Array | null = null
  #pending = new Map<string, Pending>()
  #subscription: { close: () => void } | null = null
  // Subscriptions on relays the signer moved away from; they stay open until the requests sent
  // there are answered, so no answer is lost in the switch.
  #retired: { close: () => void }[] = []
  #ready: Promise<void> | null = null
  #closed = false

  constructor(session: Nip46Session, options: Nip46SignerOptions) {
    if (!isHexKey(session.remoteSignerPubkey) || !/^[0-9a-f]{64}$/.test(session.clientSecretKey)) throw new Nip46RequestError("invalid", "invalid session")
    this.session = { ...session, relays: [...session.relays] }
    this.#options = options
    this.#clientKey = hexToBytes(session.clientSecretKey)
  }

  get clientPubkey(): Promise<string> {
    return loadCore().then((core) => core.getPublicKey(this.#clientKey))
  }

  async getPublicKey(): Promise<string> {
    if (isHexKey(this.session.userPubkey)) return this.session.userPubkey
    const pubkey = await this.request("get_public_key", [])
    if (!isHexKey(pubkey)) throw new Nip46RequestError("invalid", "signer returned no valid public key")
    this.session = { ...this.session, userPubkey: pubkey }
    this.#options.onSessionChange?.(this.session)
    return pubkey
  }

  async signEvent(template: EventTemplate): Promise<VerifiedEvent> {
    const { kind, content, tags, created_at } = template
    const result = await this.request("sign_event", [JSON.stringify({ kind, content, tags, created_at })])
    try {
      return JSON.parse(result) as VerifiedEvent
    } catch {
      throw new Nip46RequestError("invalid", "signer returned no event")
    }
  }

  nip44 = {
    encrypt: (pubkey: string, plaintext: string) => this.request("nip44_encrypt", [pubkey, plaintext]),
    decrypt: (pubkey: string, ciphertext: string) => this.request("nip44_decrypt", [pubkey, ciphertext]),
  }

  nip04 = {
    encrypt: (pubkey: string, plaintext: string) => this.request("nip04_encrypt", [pubkey, plaintext]),
    decrypt: (pubkey: string, ciphertext: string) => this.request("nip04_decrypt", [pubkey, ciphertext]),
  }

  // True when the signer answers "pong" in time.
  async ping(timeoutMs = 10_000): Promise<boolean> {
    try {
      return (await this.request("ping", [], timeoutMs)) === "pong"
    } catch {
      return false
    }
  }

  // Asks the signer which relays it wants; moves there when it names new ones. Returns the
  // relays now in use, or null when nothing changed or the signer doesn't support it.
  async switchRelays(timeoutMs = 10_000): Promise<string[] | null> {
    let result: string
    try {
      result = await this.request("switch_relays", [], timeoutMs)
    } catch {
      return null
    }
    let relays: unknown
    try {
      relays = JSON.parse(result)
    } catch {
      return null
    }
    if (!Array.isArray(relays) || relays.length === 0 || !relays.every((url) => typeof url === "string" && /^wss?:\/\//.test(url))) return null
    const next = relays as string[]
    if (this.#closed) return null
    if (next.length === this.session.relays.length && next.every((url) => this.session.relays.includes(url))) return null
    if (this.#subscription) this.#retired.push(this.#subscription)
    this.#subscription = null
    this.#ready = null
    this.#closeRetired()
    this.session = { ...this.session, relays: next }
    this.#options.onSessionChange?.(this.session)
    // Listen on the new relays right away: answers to requests still open may come from there.
    void this.#listen()
    return next
  }

  // Tells the signer the session is over (a courtesy; it may not answer), then closes.
  async logout(timeoutMs = 5000): Promise<void> {
    try {
      await this.request("logout", [], timeoutMs)
    } catch {
      // Not answering is allowed; the local session ends either way.
    }
    this.close()
  }

  close() {
    this.#closed = true
    this.#subscription?.close()
    this.#subscription = null
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(new Nip46RequestError("closed", `connection closed before ${pending.method} was answered`))
      this.#pending.delete(id)
    }
    this.#closeRetired()
  }

  #closeRetired() {
    if (this.#pending.size > 0) return
    for (const subscription of this.#retired) subscription.close()
    this.#retired = []
  }

  // Sends one request and waits for its answer.
  async request(method: string, params: string[], timeoutMs = this.#options.timeoutMs ?? 60_000): Promise<string> {
    if (this.#closed) throw new Nip46RequestError("closed", "connection closed")
    const core = await loadCore()
    await this.#listen()
    this.#conversationKey ??= core.nip44.getConversationKey(this.#clientKey, this.session.remoteSignerPubkey)
    const id = randomId()
    const event = core.finalizeEvent(
      {
        kind: NIP46_KIND,
        tags: [["p", this.session.remoteSignerPubkey]],
        content: core.nip44.encrypt(JSON.stringify({ id, method, params }), this.#conversationKey),
        created_at: nowSeconds(),
      },
      this.#clientKey,
    )
    const answer = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(id, new Nip46RequestError("timeout", `no answer to ${method}`)), timeoutMs)
      this.#pending.set(id, { method, resolve, reject, timer })
    })
    // The answer may fail while the publish is still under way; it is returned below either way.
    answer.catch(() => {})
    try {
      const results = await this.#options.transport.publish(event, this.session.relays)
      // Fail right away only when no relay can have passed the request on; otherwise wait, a
      // missing answer then ends as "timeout" (unknown).
      if (!results.some((result) => result.ok || result.code === "timeout")) {
        this.#fail(id, new Nip46RequestError("unreachable", results.map((result) => result.reason).join("; ") || "no relay"))
      }
    } catch (error) {
      this.#fail(id, new Nip46RequestError("unreachable", error instanceof Error ? error.message : String(error)))
    }
    return answer
  }

  #fail(id: string, error: Error) {
    const pending = this.#pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#pending.delete(id)
    pending.reject(error)
    this.#closeRetired()
  }

  // Subscribes on every session relay before the first request, so no answer slips past.
  #listen(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    if (this.#ready) return this.#ready
    this.#ready = (async () => {
      const core = await loadCore()
      if (this.#closed) return
      const clientPubkey = core.getPublicKey(this.#clientKey)
      await new Promise<void>((resolve) => {
        // EOSE from every relay is best; a silent relay mustn't hold up every request, and once
        // the REQ is sent first on a connection, answers that follow our request will match it.
        const timer = setTimeout(resolve, 1500)
        this.#subscription = this.#options.transport.subscribe(
          [{ kinds: [NIP46_KIND], authors: [this.session.remoteSignerPubkey], "#p": [clientPubkey], since: nowSeconds() - STALE_SECONDS }],
          this.session.relays,
          {
            onevent: (event) => this.#receive(event),
            oneose: () => {
              clearTimeout(timer)
              resolve()
            },
          },
        )
      })
    })()
    return this.#ready
  }

  async #receive(event: NostrEvent) {
    if (event.pubkey !== this.session.remoteSignerPubkey) return
    const core = await loadCore()
    let response: { id?: unknown; result?: unknown; error?: unknown }
    try {
      this.#conversationKey ??= core.nip44.getConversationKey(this.#clientKey, this.session.remoteSignerPubkey)
      response = JSON.parse(core.nip44.decrypt(event.content, this.#conversationKey))
    } catch {
      return
    }
    if (typeof response.id !== "string") return
    const pending = this.#pending.get(response.id)
    if (!pending) return
    if (response.result === "auth_url" && typeof response.error === "string") {
      // Keep waiting on the same id while the user confirms on the signer's page.
      clearTimeout(pending.timer)
      pending.timer = setTimeout(
        () => this.#fail(response.id as string, new Nip46RequestError("timeout", `no answer to ${pending.method} after confirmation page`)),
        this.#options.authTimeoutMs ?? 300_000,
      )
      this.#options.onAuthUrl?.(response.error)
      return
    }
    clearTimeout(pending.timer)
    this.#pending.delete(response.id)
    this.#closeRetired()
    if (typeof response.error === "string" && response.error) pending.reject(new Nip46RequestError("rejected", response.error))
    else pending.resolve(typeof response.result === "string" ? response.result : JSON.stringify(response.result ?? ""))
  }
}

// Continues a stored session: no connect, no new approval at the signer.
export function resume(session: Nip46Session, options: Nip46SignerOptions): Nip46Signer {
  return new Nip46Signer(session, options)
}

export interface ClientUriOptions {
  relays: string[]
  // Permissions to ask for, e.g. ["sign_event:1180", "nip44_encrypt", "nip44_decrypt"].
  perms?: string[]
  name?: string
  url?: string
  image?: string
  // Normally generated; pass one to reuse a stored client key.
  clientSecretKey?: Uint8Array
  secret?: string
}

export interface ClientUri {
  uri: string
  clientSecretKey: Uint8Array
  clientPubkey: string
  secret: string
  relays: string[]
}

// The nostrconnect:// link the app shows as QR code. The secret only proves the answer belongs
// to this link (anyone who sees the screen sees it too); it is not a password.
export async function createClientUri(options: ClientUriOptions): Promise<ClientUri> {
  const core = await loadCore()
  if (options.relays.length === 0) throw new Nip46RequestError("invalid", "at least one relay is needed")
  const clientSecretKey = options.clientSecretKey ?? core.generateSecretKey()
  const clientPubkey = core.getPublicKey(clientSecretKey)
  const secret = options.secret ?? bytesToHex(randomBytes(8))
  const params = new URLSearchParams()
  for (const relay of options.relays) params.append("relay", relay)
  params.set("secret", secret)
  if (options.perms?.length) params.set("perms", options.perms.join(","))
  if (options.name) params.set("name", options.name)
  if (options.url) params.set("url", options.url)
  if (options.image) params.set("image", options.image)
  return { uri: `nostrconnect://${clientPubkey}?${params.toString()}`, clientSecretKey, clientPubkey, secret, relays: [...options.relays] }
}

export interface WaitForSignerOptions extends Omit<Nip46SignerOptions, "transport"> {
  transport: Nip46Transport
  signal?: AbortSignal
  // How long to wait for a signer to scan the code. Default 10 minutes.
  waitMs?: number
}

// Waits until a signer answers the nostrconnect:// link with its secret, then asks for the
// user's public key. Answers with a wrong secret are ignored (someone else's, or spoofed).
export async function waitForSigner(link: ClientUri, options: WaitForSignerOptions): Promise<{ session: Nip46Session; signer: Nip46Signer }> {
  const core = await loadCore()
  const remoteSignerPubkey = await new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (error: Error | null, pubkey?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      subscription.close()
      if (error) reject(error)
      else resolve(pubkey as string)
    }
    const onAbort = () => finish(new Nip46RequestError("closed", "stopped waiting for the signer"))
    const timer = setTimeout(() => finish(new Nip46RequestError("timeout", "no signer answered")), options.waitMs ?? 600_000)
    options.signal?.addEventListener("abort", onAbort)
    const subscription = options.transport.subscribe(
      [{ kinds: [NIP46_KIND], "#p": [link.clientPubkey], since: nowSeconds() - STALE_SECONDS }],
      link.relays,
      {
        onevent: (event) => {
          if (!isHexKey(event.pubkey)) return
          try {
            const conversationKey = core.nip44.getConversationKey(link.clientSecretKey, event.pubkey)
            const response = JSON.parse(core.nip44.decrypt(event.content, conversationKey)) as { result?: unknown; error?: unknown }
            if (response.result === link.secret) finish(null, event.pubkey)
          } catch {
            // Not for us, or not readable: ignore.
          }
        },
      },
    )
    if (options.signal?.aborted) onAbort()
  })
  const session: Nip46Session = { clientSecretKey: bytesToHex(link.clientSecretKey), remoteSignerPubkey, userPubkey: "", relays: link.relays }
  const signer = new Nip46Signer(session, options)
  await signer.getPublicKey()
  // NIP-46 asks clients to offer switch_relays right after connecting; signers that don't know
  // it simply don't answer, which costs nothing here.
  void signer.switchRelays()
  return { session: signer.session, signer }
}
