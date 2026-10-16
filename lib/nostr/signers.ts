// Signer adapters (docs/decisions/0002, section 4). Every signer the app uses is wrapped by
// verifyingSigner(): each signature is checked (valid, by the session's key, for exactly the
// event that was asked for) before anything is stored or published. nostr-core passes through
// whatever an extension or remote signer returns (NC-22).
//
// Errors are SignerError with a code the interface can act on:
// - "rejected": the user or the signer said no.
// - "unknown": no answer in time. The signer may still have done it; never treat as refused.
// - "mismatch": the result is not what was asked for (other key, changed event, bad signature,
//   a party answering a QR code that can't prove the key it names), or two different signers
//   answered the same QR code (someone else saw it: show a new code, only to the user).
// - "unavailable": the signer can't be reached (no extension, no relay).
// - "unsupported": the signer lacks the capability (for example NIP-44 in an extension).
// - "failed": the signer tried and couldn't, for a reason in the data: a local key that can't
//   decrypt something (another key's, or damaged). Only the local signer can tell this apart;
//   extensions and remote signers report it like a refusal.
// - "invalid": unusable input (a malformed bunker link).
// A remote signer that wants a confirmation on its web page doesn't fail: onAuthUrl gets the
// page and the request stays pending.
import { bytesToHex } from "@noble/hashes/utils.js"
import { createRelayClient, type RelayClient } from "./client.ts"
import { loadCore } from "./core.ts"
import { connectToBunker, createClientUri, Nip46RequestError, resume, waitForSigner, type Nip46Account, type Nip46Session, type Nip46Signer, type Nip46Transport } from "./ext/nostrconnect.ts"
import { mergeRelays } from "./relays.ts"
import type { EventTemplate, NostrEvent, Signer, VerifiedEvent } from "./types.ts"

export type SignerErrorCode = "rejected" | "unknown" | "mismatch" | "unavailable" | "unsupported" | "failed" | "invalid"

export class SignerError extends Error {
  code: SignerErrorCode
  constructor(code: SignerErrorCode, message: string) {
    super(message)
    this.name = "SignerError"
    this.code = code
  }
}

const isHexKey = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)

// Translates what signers throw into SignerError codes.
function toSignerError(error: unknown): SignerError {
  if (error instanceof SignerError) return error
  if (error instanceof Nip46RequestError) {
    if (error.code === "timeout") return new SignerError("unknown", error.message)
    if (error.code === "rejected") return new SignerError("rejected", error.message)
    if (error.code === "invalid" || error.code === "mismatch") return new SignerError("mismatch", error.message)
    return new SignerError("unavailable", error.message)
  }
  const code = (error as { code?: unknown })?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === "NIP07_NIP44_UNSUPPORTED" || code === "NIP07_NIP04_UNSUPPORTED" || code === "NIP07_RELAYS_UNSUPPORTED") return new SignerError("unsupported", message)
  if (code === "NIP07_NOT_AVAILABLE") return new SignerError("unavailable", message)
  // Extensions throw when the user declines; there's no standard error to tell more.
  return new SignerError("rejected", message)
}

async function call<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    throw toSignerError(error)
  }
}

const sameTags = (a: unknown, b: string[][]) => JSON.stringify(a) === JSON.stringify(b)

// Checks that `event` is a valid signature by `pubkey` over exactly `template`, and returns a
// clean copy without extra fields. Throws SignerError("mismatch") otherwise.
export async function verifySignedEvent(event: unknown, template: EventTemplate, pubkey: string): Promise<VerifiedEvent> {
  const core = await loadCore()
  const e = event as Partial<NostrEvent> | null
  if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.sig !== "string") throw new SignerError("mismatch", "the signer returned no signed event")
  if (e.pubkey !== pubkey) throw new SignerError("mismatch", "the event was signed by a different key")
  if (e.kind !== template.kind || e.content !== template.content || e.created_at !== template.created_at || !sameTags(e.tags, template.tags)) {
    throw new SignerError("mismatch", "the signer changed the event")
  }
  const copy = { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags as string[][], content: e.content, sig: e.sig }
  if (!core.verifyEventSignature(copy)) throw new SignerError("mismatch", "the signature is not valid")
  return Object.assign(copy, { [core.verifiedSymbol]: true }) as VerifiedEvent
}

const copyTemplate = ({ kind, content, tags, created_at }: EventTemplate): EventTemplate => ({ kind, content, tags: tags.map((tag) => [...tag]), created_at })

export interface Capabilities {
  // false hides the method even if the signer object has it (NIP-07 extensions without NIP-44).
  nip44?: boolean
  nip04?: boolean
}

// Wraps a signer so every result is checked against the session's public key.
export function verifyingSigner(inner: Signer, expectedPubkey: string, capabilities: Capabilities = {}): Signer {
  const signer: Signer = {
    async getPublicKey() {
      const pubkey = await call(() => inner.getPublicKey())
      if (pubkey !== expectedPubkey) throw new SignerError("mismatch", "the signer now uses a different key")
      return pubkey
    },
    async signEvent(template) {
      // nostr-core's finalizeEvent writes id, pubkey and sig into the object it is given, and a
      // signer could change it too. The signer gets a copy; the check uses an untouched one.
      const asked = copyTemplate(template)
      const event = await call(() => inner.signEvent(copyTemplate(template)))
      return verifySignedEvent(event, asked, expectedPubkey)
    },
  }
  const nip44 = inner.nip44
  if (nip44 && capabilities.nip44 !== false) {
    signer.nip44 = {
      encrypt: (pubkey, plaintext) => call(() => nip44.encrypt(pubkey, plaintext)),
      decrypt: (pubkey, ciphertext) => call(() => nip44.decrypt(pubkey, ciphertext)),
    }
  }
  const nip04 = inner.nip04
  if (nip04 && capabilities.nip04 !== false) {
    signer.nip04 = {
      encrypt: (pubkey, plaintext) => call(() => nip04.encrypt(pubkey, plaintext)),
      decrypt: (pubkey, ciphertext) => call(() => nip04.decrypt(pubkey, ciphertext)),
    }
  }
  const getRelays = inner.getRelays?.bind(inner)
  if (getRelays) signer.getRelays = () => call(getRelays)
  return signer
}

// Nobody declines for a local key: when it can't encrypt or decrypt, the data (or the other
// key) is the problem, and callers must be able to tell that from a refusal.
function failedOnError(methods: Signer["nip44"]): Signer["nip44"] {
  if (!methods) return undefined
  const run = async (action: () => Promise<string>) => {
    try {
      return await action()
    } catch (error) {
      throw new SignerError("failed", error instanceof Error ? error.message : String(error))
    }
  }
  return {
    encrypt: (pubkey, plaintext) => run(() => methods.encrypt(pubkey, plaintext)),
    decrypt: (pubkey, ciphertext) => run(() => methods.decrypt(pubkey, ciphertext)),
  }
}

// A new key for a profile kept by the app itself, with its public key.
export async function createLocalKey(): Promise<{ secretKey: Uint8Array; pubkey: string }> {
  const core = await loadCore()
  const secretKey = core.generateSecretKey()
  return { secretKey, pubkey: core.getPublicKey(secretKey) }
}

// A key made on this device together with the signer that uses it: the one-time keys of a
// handshake (./channel.ts), a live match's own keys (lib/live).
export interface LocalKey {
  secret: Uint8Array
  pubkey: string
  signer: Signer
}

export async function newLocalKey(): Promise<LocalKey> {
  const { secretKey } = await createLocalKey()
  return localKeyOf(secretKey)
}

export async function localKeyOf(secret: Uint8Array): Promise<LocalKey> {
  const signer = await createLocalSigner(secret)
  return { secret, pubkey: await signer.getPublicKey(), signer }
}

// A signer for a key kept by the app itself (a local profile).
export async function createLocalSigner(secretKey: Uint8Array): Promise<Signer> {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) throw new SignerError("invalid", "a secret key has 32 bytes")
  const core = await loadCore()
  const inner = core.createSecretKeySigner(secretKey)
  const local: Signer = {
    getPublicKey: () => inner.getPublicKey(),
    signEvent: (template) => inner.signEvent(template),
    nip44: failedOnError(inner.nip44),
    nip04: failedOnError(inner.nip04),
  }
  return verifyingSigner(local, core.getPublicKey(secretKey))
}

// Round trip through the signer's NIP-44 (encrypt to self, decrypt). Needs approval in some
// signers, so call it only where encryption is about to be used anyway.
export async function probeNip44(signer: Signer, pubkey: string): Promise<boolean> {
  if (!signer.nip44) return false
  const probe = `blueline-probe-${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`
  try {
    return (await signer.nip44.decrypt(pubkey, await signer.nip44.encrypt(pubkey, probe))) === probe
  } catch {
    return false
  }
}

// --- NIP-07 (browser extension) ---------------------------------------------------------------

interface WindowNostr {
  getPublicKey?: unknown
  nip44?: { encrypt?: unknown; decrypt?: unknown }
  nip04?: { encrypt?: unknown; decrypt?: unknown }
}

const extension = (): WindowNostr | undefined =>
  typeof window === "undefined" ? undefined : ((window as unknown as { nostr?: WindowNostr }).nostr ?? undefined)

// Extensions inject window.nostr some time after the page loads; look a little while.
async function waitForExtension(timeoutMs: number, intervalMs: number): Promise<WindowNostr | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = extension()
    if (found && typeof found.getPublicKey === "function") return found
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export interface ExternalConnection {
  signer: Signer
  pubkey: string
}

// Connects the browser extension (NIP-07). nip44 tells whether the extension offers NIP-44;
// without it, private records can't be read or written with this profile.
export async function connectNip07(options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<ExternalConnection & { nip44: boolean }> {
  const found = await waitForExtension(options.timeoutMs ?? 3000, options.intervalMs ?? 100)
  if (!found) throw new SignerError("unavailable", "no browser extension found")
  const core = await loadCore()
  const inner = new core.Nip07Signer()
  const pubkey = await call(() => inner.getPublicKey())
  if (!isHexKey(pubkey)) throw new SignerError("mismatch", "the extension returned no valid public key")
  const nip44 = typeof found.nip44?.encrypt === "function" && typeof found.nip44?.decrypt === "function"
  const nip04 = typeof found.nip04?.encrypt === "function" && typeof found.nip04?.decrypt === "function"
  return { signer: verifyingSigner(inner, pubkey, { nip44, nip04 }), pubkey, nip44 }
}

// --- NIP-46 (remote signer: bunker:// and nostrconnect://) ------------------------------------

// Remote-signer traffic gets its own relay client without AUTH: answering a relay's challenge
// would need the very signer that is waiting behind that relay.
let nip46Client: RelayClient | null = null

function nip46Transport(): Nip46Transport {
  nip46Client ??= createRelayClient()
  return nip46Client
}

export interface Nip46Options {
  transport?: Nip46Transport
  // Per request; a timeout is "unknown". Default 60 s.
  timeoutMs?: number
  onAuthUrl?: (url: string) => void
  onSessionChange?: (session: Nip46Session) => void
}

export interface Nip46Connection extends ExternalConnection {
  session: Nip46Session
  // For ping and logout.
  remote: Nip46Signer
}

// Continues a stored remote-signer session after a reload, without a new connect.
export function resumeNip46(session: Nip46Session, options: Nip46Options = {}): Nip46Connection {
  if (!isHexKey(session.userPubkey)) throw new SignerError("invalid", "the session has no user key")
  const remote = resume(session, { ...options, transport: options.transport ?? nip46Transport() })
  return { signer: verifyingSigner(remote, session.userPubkey), pubkey: session.userPubkey, session: remote.session, remote }
}

// Connects a bunker:// link pasted by the user. The handshake runs on the resumable signer from
// ext/nostrconnect.ts, not on nostr-core's NostrConnect (NC-05): since 1.0.6 that one sends
// today's connect parameters and waits through auth_url, but it still tries one relay at a time
// on sockets of its own and can't continue a session without a new connect (the link's secret is
// single-use). Here the connect request goes to every relay at once, stays pending while the
// user confirms (onAuthUrl), and the session continues on the same client key.
export async function connectBunker(uri: string, options: Nip46Options & { perms?: string[]; clientSecretKey?: Uint8Array } = {}): Promise<Nip46Connection> {
  const core = await loadCore()
  if (!uri.trim().startsWith("bunker://")) throw new SignerError("invalid", "not a bunker:// link")
  let parsed: ReturnType<typeof core.parseConnectionURI>
  try {
    parsed = core.parseConnectionURI(uri.trim())
  } catch (error) {
    throw new SignerError("invalid", error instanceof Error ? error.message : "malformed link")
  }
  if (!isHexKey(parsed.remotePubkey)) throw new SignerError("invalid", "the link has no valid signer key")
  if (mergeRelays(parsed.relayUrls).length === 0) throw new SignerError("invalid", "the link names no usable relay")
  const target = { remoteSignerPubkey: parsed.remotePubkey, relays: parsed.relayUrls, secret: parsed.secret, perms: options.perms, clientSecretKey: options.clientSecretKey }
  const { session, signer: remote } = await call(() => connectToBunker(target, { ...options, transport: options.transport ?? nip46Transport() }))
  return { signer: verifyingSigner(remote, session.userPubkey), pubkey: session.userPubkey, session, remote }
}

export interface NostrConnectStart {
  // The link to show as QR code (and to open on the same phone).
  uri: string
  // Settles once a signer answered, proved the user's key and the user confirmed the account.
  // "mismatch" when a second signer answered the same code: show a new one.
  connection: Promise<Nip46Connection>
  cancel: () => void
}

// Starts the client-initiated flow: show `uri`, then await `connection`. The sign-in screen
// passes `confirm`: it gets the proven account, shows it (name and picture from the profile, a
// short key fingerprint under "Erweitert") and resolves once the user said yes or no. Nothing is
// stored and no data key is created before that; see waitForSigner in ext/nostrconnect.ts for
// why (someone who sees the code can answer first with an account of its own).
export async function startNostrConnect(
  options: Nip46Options & {
    relays: string[]
    perms?: string[]
    name?: string
    url?: string
    image?: string
    waitMs?: number
    graceMs?: number
    confirm?: (account: Nip46Account, signal: AbortSignal) => Promise<boolean>
  },
): Promise<NostrConnectStart> {
  const link = await createClientUri(options)
  const controller = new AbortController()
  const transport = options.transport ?? nip46Transport()
  const connection = waitForSigner(link, { ...options, transport, signal: controller.signal }).then(
    ({ session, signer }) => ({ signer: verifyingSigner(signer, session.userPubkey), pubkey: session.userPubkey, session, remote: signer }),
    (error: unknown) => {
      throw toSignerError(error)
    },
  )
  // Callers that cancel may never await; that's not an error worth reporting.
  connection.catch(() => {})
  return { uri: link.uri, connection, cancel: () => controller.abort() }
}
