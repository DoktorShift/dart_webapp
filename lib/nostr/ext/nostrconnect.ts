// NIP-46 remote signing: the parts nostr-core 1.0.6 lacks. To be upstreamed to nostr-core
// (gaps NC-04, NC-05 in docs/implementation/evidence/P0.03/CORE.md; 1.0.6 took the connect
// parameters and the auth_url wait from here, PRs #77, #84, #86).
//
// - The client-initiated nostrconnect:// flow: the app shows a QR code, a signer app (Amber,
//   nsec.app, ...) scans it and answers with the secret; the app learns the signer's key from
//   that answer, and the signer proves it holds the user key it names by signing a challenge.
//   A second signer answering the same link means someone else saw the code ("mismatch").
//   nostr-core only knows bunker:// and reads a nostrconnect:// link's host (the client key)
//   as the signer's key.
// - The signer-initiated bunker:// handshake on every relay of the link at once, staying
//   pending through auth_url. nostr-core's NostrConnect now sends today's parameters and waits
//   through auth_url too, but tries one relay at a time on sockets of its own, passes any
//   auth_url string on, and can't continue a stored session (every use sends connect again,
//   and a connect secret is single-use), so the handshake runs on the signer below.
// - A Signer over kind 24133 with NIP-44 that listens on all relays through the app's relay
//   client, keeps a request pending through an auth_url challenge, offers ping, switch_relays
//   and logout, and resumes a stored session after a reload without sending connect again.
//
// Signed events coming back are not verified here; wrap the signer in verifyingSigner()
// (../signers.ts). A request that gets no answer fails with code "timeout": the signer may still
// have done it, so callers must treat that as unknown, not as refused.
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js"
import { loadCore } from "../core.ts"
import { mergeRelays } from "../relays.ts"
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

// "mismatch": two different signers answered the same nostrconnect:// link; someone else has
// seen the code, so a new one is needed.
export type Nip46ErrorCode = "timeout" | "rejected" | "unreachable" | "closed" | "invalid" | "mismatch"

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
  // authTimeoutMs) and completes when the signer answers on the same id. Only https:// pages
  // (http:// on this machine) get here; any other address fails the request as "invalid".
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
// A page the app may open for the user: https, or http on this machine (tests). Never
// javascript:, data: or anything else a remote party could slip in.
const isOpenablePage = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  } catch {
    return false
  }
}
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
  // relays now in use, or null when nothing changed, the signer doesn't support it or names no
  // relay this client can use (plain ws:// on the internet, malformed addresses).
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
    if (!Array.isArray(relays)) return null
    const next = mergeRelays(relays.filter((url): url is string => typeof url === "string"))
    if (next.length === 0 || this.#closed) return null
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
      if (!isOpenablePage(response.error)) {
        this.#fail(response.id, new Nip46RequestError("invalid", "the signer named a confirmation page that is no web page"))
        return
      }
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

// The challenge a nostrconnect:// signer signs to prove it holds the user key it names: a
// NIP-42 style event (kind 22242) with a random challenge, never sent to any relay.
export const KEY_PROOF_KIND = 22242

export interface ClientUriOptions {
  relays: string[]
  // Permissions to ask for, e.g. ["sign_event:1180", "nip44_encrypt", "nip44_decrypt"].
  // sign_event:22242 (the key proof) is added when a list is given.
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
  if (options.perms?.length) params.set("perms", [...new Set([...options.perms, `sign_event:${KEY_PROOF_KIND}`])].join(","))
  if (options.name) params.set("name", options.name)
  if (options.url) params.set("url", options.url)
  if (options.image) params.set("image", options.image)
  return { uri: `nostrconnect://${clientPubkey}?${params.toString()}`, clientSecretKey, clientPubkey, secret, relays: [...options.relays] }
}

// The account a nostrconnect:// signer proved, for the user to confirm.
export interface Nip46Account {
  userPubkey: string
  remoteSignerPubkey: string
}

export interface WaitForSignerOptions extends Omit<Nip46SignerOptions, "transport"> {
  transport: Nip46Transport
  signal?: AbortSignal
  // How long to wait for a signer to scan the code. Default 10 minutes.
  waitMs?: number
  // After the key proof, the link stays watched at least this long, and for as long as confirm
  // is open. Default 3 s.
  graceMs?: number
  // Shows the user the proven account and resolves true when they confirm it, false when they
  // don't (the wait then fails as "rejected"). `signal` fires when the wait ends meanwhile (a
  // second signer answered, abort): close the question then.
  confirm?: (account: Nip46Account, signal: AbortSignal) => Promise<boolean>
}

// Waits until a signer answers the nostrconnect:// link with its secret, asks for the user's
// public key and has the signer prove it holds that key (a signed challenge). Answers with a
// wrong secret are ignored.
//
// The secret alone proves nothing: anyone who sees the QR code (a club tablet, a shared screen)
// can answer with it. The proof stops a party from naming a key it can't sign for (the wait
// fails as "invalid"). It can't stop a party from answering first with its own key, the
// victim's copied name and picture on its profile: the app would sign in to that account, and
// the data key and every private record would be encrypted to it. So the link is meant for one
// signer: when a second, different signer answers with the secret, while the first is checked,
// during graceMs after its proof or while confirm is open, the wait fails as "mismatch"
// (someone else has seen the code: show a new one) and nothing is handed out. An answer after
// that window goes unnoticed, which is why the sign-in screen must pass confirm: show the
// account (name and picture from its profile; a short key fingerprint under "Erweitert") and
// let the user confirm it before any session is stored or data key created, so the real
// signer's answer still lands in the window while the question is open.
//
// Also fails when the signer refuses or stops answering, and on timeout or abort.
// onSessionChange hears only from a signer that passed and was confirmed; onAuthUrl can come
// from one still being checked, so show the page's address with it.
export async function waitForSigner(link: ClientUri, options: WaitForSignerOptions): Promise<{ session: Nip46Session; signer: Nip46Signer }> {
  const core = await loadCore()
  const signer = await new Promise<Nip46Signer>((resolve, reject) => {
    let settled = false
    // The one signer that answered with the secret.
    let candidate: Nip46Signer | null = null
    const confirming = new AbortController()
    let endGrace = () => {}
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (error: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(graceTimer)
      endGrace()
      options.signal?.removeEventListener("abort", onAbort)
      subscription.close()
      if (!error && candidate) return resolve(candidate)
      confirming.abort()
      candidate?.close()
      reject(error)
    }
    const check = async (current: Nip46Signer, accepted: () => void) => {
      try {
        await current.getPublicKey()
        await proveKey(current, link.relays[0])
        if (settled) return
        // Proven: the time limit for scanning no longer applies, the watch for a second signer
        // goes on.
        clearTimeout(timer)
        const graceOver = new Promise<void>((done) => {
          endGrace = done
          graceTimer = setTimeout(done, options.graceMs ?? 3000)
        })
        const account = { userPubkey: current.session.userPubkey, remoteSignerPubkey: current.session.remoteSignerPubkey }
        const [confirmed] = await Promise.all([options.confirm ? options.confirm(account, confirming.signal) : true, graceOver])
        if (settled) return
        if (confirmed !== true) return finish(new Nip46RequestError("rejected", "the account was not confirmed"))
        accepted()
        finish(null)
        options.onSessionChange?.(current.session)
      } catch (error) {
        finish(error instanceof Error ? error : new Nip46RequestError("invalid", String(error)))
      }
    }
    const onAbort = () => finish(new Nip46RequestError("closed", "stopped waiting for the signer"))
    const timer = setTimeout(() => finish(new Nip46RequestError("timeout", "no signer answered")), options.waitMs ?? 600_000)
    options.signal?.addEventListener("abort", onAbort)
    const subscription = options.transport.subscribe(
      [{ kinds: [NIP46_KIND], "#p": [link.clientPubkey], since: nowSeconds() - STALE_SECONDS }],
      link.relays,
      {
        onevent: (event) => {
          // The candidate's own events (repeats, answers to its requests) need no look.
          if (settled || !isHexKey(event.pubkey) || event.pubkey === candidate?.session.remoteSignerPubkey) return
          try {
            const conversationKey = core.nip44.getConversationKey(link.clientSecretKey, event.pubkey)
            const response = JSON.parse(core.nip44.decrypt(event.content, conversationKey)) as { result?: unknown; error?: unknown }
            if (response.result !== link.secret) return
          } catch {
            // Not for us, or not readable: ignore.
            return
          }
          if (candidate) return finish(new Nip46RequestError("mismatch", "a second signer answered the same code; someone else has seen it"))
          let won = false
          const session: Nip46Session = { clientSecretKey: bytesToHex(link.clientSecretKey), remoteSignerPubkey: event.pubkey, userPubkey: "", relays: link.relays }
          // Session changes before the signer is accepted must not reach the caller's storage.
          candidate = new Nip46Signer(session, { ...options, onSessionChange: (next) => won && options.onSessionChange?.(next) })
          void check(candidate, () => {
            won = true
          })
        },
      },
    )
    if (options.signal?.aborted) onAbort()
  })
  // NIP-46 asks clients to offer switch_relays right after connecting; signers that don't know
  // it simply don't answer, which costs nothing here.
  void signer.switchRelays()
  return { session: signer.session, signer }
}

// Has the signer sign a fresh challenge and checks that the user key it named made that
// signature. Fails with "invalid" when it doesn't; a refusal or silence fails as such.
async function proveKey(signer: Nip46Signer, relay: string): Promise<void> {
  const core = await loadCore()
  const template: EventTemplate = { kind: KEY_PROOF_KIND, content: "", tags: [["relay", relay], ["challenge", randomId()]], created_at: nowSeconds() }
  const event = (await signer.signEvent(template)) as Partial<NostrEvent> | null
  let valid = false
  try {
    valid =
      !!event &&
      event.pubkey === signer.session.userPubkey &&
      event.kind === template.kind &&
      event.content === template.content &&
      event.created_at === template.created_at &&
      JSON.stringify(event.tags) === JSON.stringify(template.tags) &&
      core.verifyEventSignature(event as NostrEvent)
  } catch {
    valid = false
  }
  if (!valid) throw new Nip46RequestError("invalid", "the signer couldn't prove it holds the key it named")
}

export interface BunkerTarget {
  remoteSignerPubkey: string
  relays: string[]
  // From the bunker:// link; single-use at most signers.
  secret?: string
  perms?: string[]
  // Normally generated; pass one to reuse a stored client key.
  clientSecretKey?: Uint8Array
}

// The signer-initiated flow (bunker://): sends connect with the parameters NIP-46 names
// ([remote-signer-pubkey, secret, perms]) over every relay of the link, waits through an
// auth_url (onAuthUrl; the same client key stays waiting, so the confirmation counts), then
// asks for the user's key. Answers come only from the key in the link, so no proof is needed.
export async function connectToBunker(target: BunkerTarget, options: Nip46SignerOptions): Promise<{ session: Nip46Session; signer: Nip46Signer }> {
  const core = await loadCore()
  const relays = mergeRelays(target.relays)
  if (!isHexKey(target.remoteSignerPubkey)) throw new Nip46RequestError("invalid", "no valid signer key")
  if (relays.length === 0) throw new Nip46RequestError("invalid", "no usable relay")
  const clientSecretKey = target.clientSecretKey ?? core.generateSecretKey()
  const session: Nip46Session = { clientSecretKey: bytesToHex(clientSecretKey), remoteSignerPubkey: target.remoteSignerPubkey, userPubkey: "", relays }
  const signer = new Nip46Signer(session, options)
  const params = [target.remoteSignerPubkey]
  if (target.secret || target.perms?.length) params.push(target.secret ?? "")
  if (target.perms?.length) params.push(target.perms.join(","))
  try {
    // Any answer that isn't an error is the acknowledgement ("ack", some signers echo the secret).
    await signer.request("connect", params)
    await signer.getPublicKey()
  } catch (error) {
    signer.close()
    throw error
  }
  void signer.switchRelays()
  return { session: signer.session, signer }
}
