import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { createLocalSigner, verifySignedEvent } from "../nostr/signers.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { OWN, ownEvents, rememberOwn } from "../profile/own-events.ts"
import { getSession, importLocalKey, openLocalKey, SessionError, signOut, type Session, type SessionKind, type SessionOptions } from "../profile/session.ts"
import { HEX64, isSignedEventShape } from "../protocol/tags.ts"
import { isDataKeyEvent, keepDataKey, storedDataKey } from "../sync/data-key.ts"

// What takes a profile to another device (docs/decisions/0002 §7): the key the app keeps, or
// for a profile in a signer app only the word that it lives there; the data key of the private
// records, so the other device reads the history without a signer prompt; and the relay list
// and name as signed here, so the profile shows at once. The same package travels encrypted
// between two paired devices (lib/devices/pairing.ts) and sits encrypted in a backup
// (./backup-file.ts, ./passkey.ts). History follows over the normal sync afterwards.

export interface ProfilePackage {
  v: 1
  pubkey: string
  // "local": the key travels. Otherwise the profile lives in a signer outside the app, and the
  // device that takes the package connects its own.
  access: { kind: "local"; key: string } | { kind: Exclude<SessionKind, "local"> }
  dataKey?: { key: string; created: number; event: NostrEvent }
  // The profile's own replaceable events known here (relay list, metadata); the list
  // decides where the other device reads first.
  events: NostrEvent[]
}

export class PackageError extends Error {
  code: "malformed" | "mismatch"
  constructor(code: "malformed" | "mismatch", message: string) {
    super(message)
    this.name = "PackageError"
    this.code = code
  }
}

const KINDS: SessionKind[] = ["local", "nip07", "nip46", "nip55"]

// What the signed-in profile sends along. Throws without a session.
export async function buildProfilePackage(): Promise<ProfilePackage> {
  const session = getSession()
  if (!session) throw new Error("no profile is signed in on this device")
  const access: ProfilePackage["access"] = session.kind === "local" ? { kind: "local", key: bytesToHex(await openLocalKey()) } : { kind: session.kind }
  const dataKey = await storedDataKey(session.pubkey)
  const own = await ownEvents(session.pubkey)
  const events = [own.get(OWN.relayList), own.get(OWN.metadata)].filter((e): e is NostrEvent => e !== undefined)
  return { v: 1, pubkey: session.pubkey, access, ...(dataKey ? { dataKey: { key: bytesToHex(dataKey.key), created: dataKey.created, event: dataKey.event } } : {}), events }
}

// Checks the shape of a package that arrived from elsewhere; signatures are checked when it is
// applied.
export function parseProfilePackage(data: unknown): ProfilePackage {
  const bad = (detail: string) => new PackageError("malformed", detail)
  const p = data as Partial<ProfilePackage> | null
  if (!p || typeof p !== "object" || p.v !== 1) throw bad("not a profile package")
  if (typeof p.pubkey !== "string" || !HEX64.test(p.pubkey)) throw bad("pubkey")
  const access = p.access as { kind?: unknown; key?: unknown } | undefined
  if (!access || !KINDS.includes(access.kind as SessionKind)) throw bad("access")
  if (access.kind === "local" && (typeof access.key !== "string" || !HEX64.test(access.key))) throw bad("key")
  if (access.kind !== "local" && access.key !== undefined) throw bad("a signer profile carries no key")
  const dataKey = p.dataKey as Partial<NonNullable<ProfilePackage["dataKey"]>> | undefined
  if (dataKey !== undefined) {
    if (typeof dataKey.key !== "string" || !HEX64.test(dataKey.key) || !Number.isInteger(dataKey.created) || !isSignedEventShape(dataKey.event)) throw bad("data key")
    if (!isDataKeyEvent(dataKey.event, p.pubkey)) throw bad("the data key record is not this profile's")
  }
  if (!Array.isArray(p.events) || p.events.length > 8 || !p.events.every((e) => isSignedEventShape(e) && e.pubkey === p.pubkey)) throw bad("events")
  return {
    v: 1,
    pubkey: p.pubkey,
    access: access.kind === "local" ? { kind: "local", key: access.key as string } : { kind: access.kind as Exclude<SessionKind, "local"> },
    ...(dataKey ? { dataKey: { key: dataKey.key as string, created: dataKey.created as number, event: dataKey.event as NostrEvent } } : {}),
    events: p.events as NostrEvent[],
  }
}

// How a package was taken: the profile is signed in here ("local"), or everything but the key
// is kept and the signer app still has to be connected ("signer").
export type Applied = { access: "local"; session: Session } | { access: "signer"; pubkey: string; kind: Exclude<SessionKind, "local"> }

const asTemplate = ({ kind, content, tags, created_at }: NostrEvent) => ({ kind, content, tags, created_at })

// Keeps the data key and the events, each only with a valid signature by the profile.
async function keepExtras(pkg: ProfilePackage) {
  const signed = async (event: NostrEvent) => {
    try {
      await verifySignedEvent(event, asTemplate(event), pkg.pubkey)
      return true
    } catch {
      return false
    }
  }
  if (pkg.dataKey && (await signed(pkg.dataKey.event))) await keepDataKey(pkg.pubkey, { key: hexToBytes(pkg.dataKey.key), created: pkg.dataKey.created, event: pkg.dataKey.event })
  const events: NostrEvent[] = []
  for (const event of pkg.events) if (await signed(event)) events.push(event)
  await rememberOwn(pkg.pubkey, events)
}

// Takes a package on this device. A key that doesn't belong to the package's profile is refused
// before anything is kept. Another profile signed in here is refused without `replace`, as every
// sign-in is (lib/profile/session.ts): a local key through importLocalKey; a signer profile,
// which signs in only once its signer app is connected, here, before its data key and events
// take the places the signed-in profile uses. With `replace`, that profile signs out first.
export async function applyProfilePackage(pkg: ProfilePackage, options: SessionOptions = {}): Promise<Applied> {
  if (pkg.access.kind !== "local") {
    const signedIn = getSession()
    if (signedIn && signedIn.pubkey !== pkg.pubkey) {
      if (!options.replace) throw new SessionError("occupied", signedIn, "another profile is signed in on this device")
      await signOut({ keepLocalData: true })
    }
    await keepExtras(pkg)
    return { access: "signer", pubkey: pkg.pubkey, kind: pkg.access.kind }
  }
  const secret = hexToBytes(pkg.access.key)
  if ((await (await createLocalSigner(secret)).getPublicKey()) !== pkg.pubkey) throw new PackageError("mismatch", "the key is not this profile's")
  const session = await importLocalKey(secret, options)
  await keepExtras(pkg)
  return { access: "local", session }
}
