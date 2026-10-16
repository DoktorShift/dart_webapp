import { useEffect, useSyncExternalStore } from "react"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import type { Nip46Connection } from "../nostr/signers.ts"
import type { Signer } from "../nostr/types.ts"
import { dbGet, dbKeys, dbWrite, onStorageChange, type Keyed, type WriteOp } from "../storage/db.ts"
import { isPubkey } from "../storage/players.ts"
import { CLUB_OBJECT_PREFIX, OWN_OBJECT_PREFIX, PROFILE_KV_PREFIX, SESSION_KEY, SIGNER_PENDING_PREFIX } from "./storage-keys.ts"
import { forgetVaultKey, openSecret, sealSecret, type SealedSecret } from "./vault.ts"

// The one current session of this device (docs/decisions/0002 §4): a guest (no session), a key
// kept by the app ("local"), a browser extension (NIP-07), a signer app (NIP-46) or an Android
// signer (NIP-55). Every signer comes wrapped by lib/nostr's verifyingSigner: a signature that
// isn't exactly what was asked for, by exactly this profile, never gets out.
//
// Only the public part (key, kind, date) lives in this module's memory and the React hook. The
// secrets (the local key, a signer app connection's own key) stay sealed in IndexedDB
// (./vault.ts) and are opened only when a signer is needed. Nothing here loads nostr-core: a
// guest opening the app reads one small record, and lib/nostr arrives only with getSigner().
//
// Per-profile data goes with the profile: kv entries named "profile.*", objects named "own:*" or
// "club:*" (the clubs as this profile reads them, lib/clubs/store.ts) and pending requests named
// "signer:*" are deleted when the profile signs out or another one signs in on this device.
// Other areas clean up theirs in onSessionEnd.
//
// Another profile signs in only with `replace`: otherwise the start is refused with SessionError
// "occupied", so the UI can say who is being signed out (and that a key kept only here is lost)
// before anything happens.

export type SessionKind = "local" | "nip07" | "nip46" | "nip55"

export interface Session {
  pubkey: string
  kind: SessionKind
  // When this device signed in (ms).
  createdAt: number
  // The key was made on this device just now (startLocalProfile): the profile has no past
  // anywhere else yet.
  madeHere?: true
}

interface StoredSession extends Session {
  // "local": the profile key. "nip46": the connection's own key (clientSecretKey).
  secret?: SealedSecret
  // "nip46": the signer app and where it listens.
  remote?: { signerPubkey: string; relays: string[] }
}

export type SessionErrorCode = "occupied"

export class SessionError extends Error {
  code: SessionErrorCode
  // The profile signed in on this device.
  session: Session
  constructor(code: SessionErrorCode, session: Session, message: string) {
    super(message)
    this.name = "SessionError"
    this.code = code
    this.session = session
  }
}

export interface SessionOptions {
  // Sign the profile on this device out first, if it is another one. Without it, a start while
  // another profile is signed in is refused with SessionError "occupied".
  replace?: boolean
}

// The storage names live in ./storage-keys.ts (no code), so the start page can look for a stored
// session without this module.
const PROFILE_OBJECT_PREFIXES = [OWN_OBJECT_PREFIX, CLUB_OBJECT_PREFIX]
// Device-wide, kept across profiles: the session itself and the vault key are handled apart.
const KEPT_ON_SWITCH = new Set([SESSION_KEY, "profile.vault-key"])

// ---- State -----------------------------------------------------------------------------------

// undefined until read; null for a guest.
let current: Session | null | undefined
let reading: Promise<Session | null> | null = null
let watching = false
const listeners = new Set<() => void>()

// The open signer of the current session, how to let go of it, and (signer apps) how to end the
// connection for good.
interface OpenSigner {
  signer: Signer
  close?: () => void
  logout?: () => Promise<void>
}
let open: Promise<OpenSigner> | null = null

const publicPart = ({ pubkey, kind, createdAt, madeHere }: StoredSession): Session => ({ pubkey, kind, createdAt, ...(madeHere ? { madeHere } : {}) })
const same = (a: Session | null | undefined, b: Session | null) => (a ?? null) === b || (!!a && !!b && a.pubkey === b.pubkey && a.kind === b.kind && a.createdAt === b.createdAt)

function setCurrent(next: Session | null) {
  if (same(current, next) && current !== undefined) return
  if (current?.pubkey !== next?.pubkey || current?.kind !== next?.kind) void closeSigner()
  current = next
  for (const listener of listeners) listener()
}

async function closeSigner() {
  const closing = open
  open = null
  try {
    ;(await closing)?.close?.()
  } catch {
    // A signer that failed to open has nothing to close.
  }
}

async function readStored(): Promise<StoredSession | null> {
  return (await dbGet<{ id: string; value: StoredSession }>("kv", SESSION_KEY))?.value ?? null
}

// Another tab signed in or out, or deleted everything.
function watch() {
  if (watching) return
  watching = true
  onStorageChange((message) => {
    if (message.type === "wipe") {
      reading = Promise.resolve(null)
      setCurrent(null)
    } else if (message.stores.includes("kv")) {
      reading = null
      void loadSession()
    }
  })
}

// Reads the session once (and again after another tab changed it). A database that can't be
// read counts as no session: nothing can be signed without it anyway.
export function loadSession(): Promise<Session | null> {
  watch()
  reading ??= readStored().then(
    (stored) => {
      const session = stored ? publicPart(stored) : null
      setCurrent(session)
      return session
    },
    () => {
      setCurrent(null)
      return null
    },
  )
  return reading
}

// The session as far as it is known: null for a guest, or while it hasn't been read yet.
export const getSession = (): Session | null => current ?? null

export function subscribeSession(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The session for React: undefined while it is being read (show nothing yet, not the guest
// view), null for a guest.
export function useSession(): Session | null | undefined {
  useEffect(() => {
    void loadSession()
  }, [])
  return useSyncExternalStore(
    subscribeSession,
    () => current,
    () => undefined,
  )
}

// ---- Signer ----------------------------------------------------------------------------------

// A signer app may ask the person to confirm on a web page first (NIP-46 auth_url); the request
// waits meanwhile. The page is offered here until it is opened or a minute has passed.
let confirmation: string | null = null
let confirmationTimer: ReturnType<typeof setTimeout> | undefined
const confirmationListeners = new Set<() => void>()

function setConfirmation(url: string | null) {
  confirmation = url
  clearTimeout(confirmationTimer)
  if (url) confirmationTimer = setTimeout(() => setConfirmation(null), 60_000)
  for (const listener of confirmationListeners) listener()
}

export const dismissSignerConfirmation = () => setConfirmation(null)

export function useSignerConfirmation(): string | null {
  return useSyncExternalStore(
    (listener) => {
      confirmationListeners.add(listener)
      return () => confirmationListeners.delete(listener)
    },
    () => confirmation,
    () => null,
  )
}

async function openStoredSigner(stored: StoredSession): Promise<OpenSigner> {
  const signers = await import("../nostr/signers.ts")
  switch (stored.kind) {
    case "local": {
      if (!stored.secret) throw new signers.SignerError("unavailable", "the profile key is missing")
      return { signer: await signers.createLocalSigner(await openSecret(stored.secret, "local-key")) }
    }
    case "nip07": {
      const { signer, pubkey } = await signers.connectNip07()
      // The extension switched to another account since: never sign as someone else.
      if (pubkey !== stored.pubkey) throw new signers.SignerError("mismatch", "the extension now uses a different profile")
      return { signer }
    }
    case "nip46": {
      if (!stored.secret || !stored.remote) throw new signers.SignerError("unavailable", "the signer app connection is missing")
      const session = {
        clientSecretKey: bytesToHex(await openSecret(stored.secret, "connection-key")),
        remoteSignerPubkey: stored.remote.signerPubkey,
        userPubkey: stored.pubkey,
        relays: stored.remote.relays,
      }
      const connection = signers.resumeNip46(session, {
        onAuthUrl: setConfirmation,
        // The signer app moved to other relays: remember them for the next start.
        onSessionChange: (next) => void writeRemote(stored.pubkey, { signerPubkey: next.remoteSignerPubkey, relays: next.relays }),
      })
      return { signer: connection.signer, close: () => connection.remote.close(), logout: () => connection.remote.logout(3000) }
    }
    case "nip55": {
      const { androidSigner } = await import("./android-signer.ts")
      return { signer: await androidSigner(stored.pubkey) }
    }
  }
}

async function writeRemote(pubkey: string, remote: StoredSession["remote"]) {
  const stored = await readStored()
  if (stored?.pubkey === pubkey && stored.kind === "nip46") await dbWrite([{ store: "kv", put: { id: SESSION_KEY, value: { ...stored, remote } } as Keyed }])
}

// The signer of the current session, opened on first use. Throws without a session, and with
// lib/nostr's SignerError when the signer can't be reached or now belongs to someone else.
export function getSigner(): Promise<Signer> {
  open ??= readStored().then((stored) => {
    if (!stored) throw new Error("no profile is signed in on this device")
    return openStoredSigner(stored)
  })
  const opening = open
  opening.catch(() => {
    // The next call tries again (extension installed meanwhile, signer app reachable again).
    if (open === opening) open = null
  })
  return opening.then(({ signer }) => signer)
}

// ---- Starting and ending ---------------------------------------------------------------------

const sessionEndHooks = new Set<() => void | Promise<void>>()

// Runs when the profile signs out, or another profile signs in on this device: the place for
// other areas to drop what belongs to the profile (a wallet connection, live subscriptions).
export function onSessionEnd(hook: () => void | Promise<void>) {
  sessionEndHooks.add(hook)
  return () => {
    sessionEndHooks.delete(hook)
  }
}

async function endSession() {
  await Promise.allSettled([...sessionEndHooks].map(async (hook) => hook()))
}

// Deletes the signer requests still waiting for an answer: they belong to the sign-in or the
// session that is over now.
async function pendingSignerOps(): Promise<WriteOp[]> {
  const pending = await dbKeys("pending")
  return pending.filter((id) => id.startsWith(SIGNER_PENDING_PREFIX)).map((id): WriteOp => ({ store: "pending", delete: id }))
}

// Deletes what belongs to the signed-in profile; `all` also the session and the vault key.
async function profileDataOps(all: boolean): Promise<WriteOp[]> {
  const [kv, objects] = await Promise.all([dbKeys("kv"), dbKeys("objects")])
  return [
    ...kv.filter((id) => id.startsWith(PROFILE_KV_PREFIX) && (all || !KEPT_ON_SWITCH.has(id))).map((id): WriteOp => ({ store: "kv", delete: id })),
    ...objects.filter((id) => PROFILE_OBJECT_PREFIXES.some((prefix) => id.startsWith(prefix))).map((id): WriteOp => ({ store: "objects", delete: id })),
    ...(await pendingSignerOps()),
  ]
}

async function begin(stored: StoredSession, options: SessionOptions, signer?: OpenSigner): Promise<Session> {
  const previous = await readStored()
  const ops: WriteOp[] = []
  if (previous && previous.pubkey !== stored.pubkey) {
    if (!options.replace) throw new SessionError("occupied", publicPart(previous), "another profile is signed in on this device")
    // Another profile on this device: nothing of the previous one stays.
    await endSession()
    ops.push(...(await profileDataOps(false)))
  } else {
    // A sign-in started earlier (an Android signer asked for the key) must not answer into
    // this session later.
    ops.push(...(await pendingSignerOps()))
  }
  ops.push({ store: "kv", put: { id: SESSION_KEY, value: stored } as Keyed })
  await dbWrite(ops)
  const session = publicPart(stored)
  reading = Promise.resolve(session)
  setCurrent(session)
  await closeSigner()
  if (signer) open = Promise.resolve(signer)
  return session
}

// A new profile with a key the app keeps (encrypted, see ./vault.ts).
export async function startLocalProfile(options: SessionOptions = {}): Promise<Session> {
  const { createLocalKey } = await import("../nostr/signers.ts")
  const { secretKey, pubkey } = await createLocalKey()
  return begin({ pubkey, kind: "local", createdAt: Date.now(), madeHere: true, secret: await sealSecret(secretKey, "local-key") }, options)
}

// The profile key of a local session, for taking the profile to another device or into a
// backup (lib/devices, lib/recovery): the only way it leaves the vault. Throws without a local
// session.
export async function openLocalKey(): Promise<Uint8Array> {
  const stored = await readStored()
  if (stored?.kind !== "local" || !stored.secret) throw new Error("no profile key is kept on this device")
  return openSecret(stored.secret, "local-key")
}

// A key brought from elsewhere: another device of the same person, or a backup.
export async function importLocalKey(secretKey: Uint8Array, options: SessionOptions = {}): Promise<Session> {
  const { createLocalSigner } = await import("../nostr/signers.ts")
  const pubkey = await (await createLocalSigner(secretKey)).getPublicKey()
  return begin({ pubkey, kind: "local", createdAt: Date.now(), secret: await sealSecret(secretKey, "local-key") }, options)
}

export interface ExternalParams {
  // A browser extension that answered with this key.
  nip07: { pubkey: string }
  // A signer app connection whose account the person confirmed.
  nip46: { connection: Nip46Connection }
  // The key an Android signer sent back.
  nip55: { pubkey: string }
}

// Signs in with a signer outside the app, once the person confirmed the account it named.
export async function connectExternal<K extends keyof ExternalParams>(kind: K, params: ExternalParams[K], options: SessionOptions = {}): Promise<Session> {
  if (kind === "nip46") {
    const { connection } = params as ExternalParams["nip46"]
    const { session } = connection
    return begin(
      {
        pubkey: session.userPubkey,
        kind,
        createdAt: Date.now(),
        secret: await sealSecret(hexToBytes(session.clientSecretKey), "connection-key"),
        remote: { signerPubkey: session.remoteSignerPubkey, relays: session.relays },
      },
      options,
      { signer: connection.signer, close: () => connection.remote.close(), logout: () => connection.remote.logout(3000) },
    )
  }
  const { pubkey } = params as ExternalParams["nip07"]
  if (!isPubkey(pubkey)) throw new Error("not a public key")
  return begin({ pubkey, kind, createdAt: Date.now() }, options)
}

// Ends the session on this device: the signer app hears that the connection ends, every key and
// connection of the profile is deleted, and the other areas drop theirs. With keepLocalData
// false, everything else on this device goes too (games, players, settings), for a shared device.
export async function signOut({ keepLocalData }: { keepLocalData: boolean }) {
  const stored = await readStored()
  await endSession()
  await logoutRemote(stored)
  await dbWrite([...(await profileDataOps(true)), { store: "kv", delete: SESSION_KEY }, forgetVaultKey()])
  reading = Promise.resolve(null)
  setCurrent(null)
  await closeSigner()
  if (!keepLocalData) {
    const { wipeAllData } = await import("../storage/data.ts")
    await wipeAllData()
  }
}

// Tells a signer app that the connection is over. It may not answer; the session ends either way.
async function logoutRemote(stored: StoredSession | null) {
  if (stored?.kind !== "nip46") return
  try {
    await (await (open ?? openStoredSigner(stored))).logout?.()
  } catch {
    // Unreachable or already gone: nothing more to tell it.
  }
}
