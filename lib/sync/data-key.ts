import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js"
import { isSignerFailure } from "../nostr/ext/crypto.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { NostrEvent, Signer } from "../nostr/types.ts"
import { openSecret, sealSecret, type SealedSecret } from "../profile/vault.ts"
import { dataKeyRecord, dataKeySlot, parsePrivateEvent, privateTemplate } from "../protocol/private.ts"
import { dbGet, dbWrite, type Keyed } from "../storage/db.ts"
import { nextCreatedAt } from "./records.ts"

// The profile's data key (docs/decisions/0002 §4): 32 random bytes under which every private
// record is encrypted. It sits on relays once, NIP-44-encrypted to the profile itself, as the
// 30078 record at dataKeySlot(pubkey). Each device unwraps it once (one signer decryption, also
// for a signer app) and keeps it sealed like the profile key (lib/profile/vault.ts); it goes with
// the profile when it signs out (kv "profile.*", lib/profile/session.ts).
//
// Only a record the profile signed itself is ever opened: a relay that answered with someone
// else's record at the slot could otherwise hand the profile a key the attacker knows.
//
// Two devices that made a key each, unable to see the other's (one was offline before its key
// reached any relay), end up with the same one: the earlier made wins. The device holding it
// signs it again so relays keep it; the other takes it over and seals its records anew
// (lib/sync/engine.ts). Records under the dropped key stay unreadable garbage on relays.

const KEY_ID = "profile.data-key"

interface StoredDataKey extends Keyed {
  value: { pubkey: string; created: number; sealed: SealedSecret; event: NostrEvent }
}

export interface DataKey {
  key: Uint8Array
  // When it was made (seconds), as its record says.
  created: number
  // Its record as signed: sent again where it is missing.
  event: NostrEvent
}

// Why the data key can't be had or kept: the signer didn't answer or declined ("signer"), can't
// decrypt at all ("unsupported", e.g. the Android signer), the record doesn't open or isn't the
// profile's ("key", never a reason to make a new key over it), or this device's clock is too far
// behind to sign a version relays would keep ("clock").
export type DataKeyProblem = "signer" | "unsupported" | "key" | "clock"

export class DataKeyError extends Error {
  problem: DataKeyProblem
  constructor(problem: DataKeyProblem, message: string) {
    super(message)
    this.name = "DataKeyError"
    this.problem = problem
  }
}

export async function storedDataKey(pubkey: string): Promise<DataKey | null> {
  const stored = (await dbGet<StoredDataKey>("kv", KEY_ID))?.value
  if (!stored || stored.pubkey !== pubkey) return null
  return { key: await openSecret(stored.sealed, "data-key"), created: stored.created, event: stored.event }
}

export async function keepDataKey(pubkey: string, dataKey: DataKey) {
  const value = { pubkey, created: dataKey.created, sealed: await sealSecret(dataKey.key, "data-key"), event: dataKey.event }
  await dbWrite([{ store: "kv", put: { id: KEY_ID, value } as StoredDataKey }])
}

const nip44Of = (signer: Signer) => {
  if (!signer.nip44) throw new DataKeyError("unsupported", "this signer can't decrypt (NIP-44)")
  return signer.nip44
}

// Whether an event is the profile's data key record: its own, at its slot.
export const isDataKeyEvent = (event: NostrEvent, pubkey: string) => {
  const parsed = parsePrivateEvent(event, pubkey)
  return parsed.ok && parsed.slot === dataKeySlot(pubkey)
}

// Opens the profile's data key record with its signer.
export async function unwrapDataKey(event: NostrEvent, signer: Signer, pubkey: string): Promise<DataKey> {
  if (!isDataKeyEvent(event, pubkey)) throw new DataKeyError("key", "not this profile's data key record")
  const nip44 = nip44Of(signer)
  let plaintext: string
  try {
    plaintext = await nip44.decrypt(pubkey, event.content)
  } catch (error) {
    if (isSignerFailure(error)) throw new DataKeyError("signer", error instanceof Error ? error.message : String(error))
    throw new DataKeyError("key", "the data key record doesn't open with this profile's key")
  }
  try {
    const record = dataKeyRecord.check(JSON.parse(plaintext), "")
    return { key: hexToBytes(record.key), created: record.created, event }
  } catch {
    throw new DataKeyError("key", "the data key record holds no data key")
  }
}

// Signs the record of a data key, above the version relays hold now (`replaces`).
async function signDataKey(key: Uint8Array, created: number, signer: Signer, replaces = 0): Promise<DataKey> {
  const now = nowSeconds()
  const created_at = nextCreatedAt(now, replaces, now)
  if (created_at === null) throw new DataKeyError("clock", "this device's clock is behind the version on the relays")
  const pubkey = await signer.getPublicKey()
  const content = await nip44Of(signer).encrypt(pubkey, JSON.stringify({ v: 1, key: bytesToHex(key), created }))
  return { key, created, event: await signer.signEvent(privateTemplate(dataKeySlot(pubkey), content, created_at)) }
}

// A new data key, for a profile whose relays confirmed it has none.
export function createDataKey(signer: Signer): Promise<DataKey> {
  const created = nowSeconds()
  return signDataKey(randomBytes(32), created, signer)
}

// The same key signed anew, so relays keep it over another version at the slot.
export const resignDataKey = (dataKey: DataKey, signer: Signer, replaces: number) => signDataKey(dataKey.key, dataKey.created, signer, replaces)

// The outcome of finding a data key record on relays that isn't this device's: the same key
// ("same", maybe signed anew elsewhere), another one made earlier ("adopted": records must be
// sealed again under it), or another one made later ("kept": ours stays, and is signed again
// above the found one, resignDataKey, so relays keep it).
export type DataKeySettlement = { outcome: "same" | "adopted" | "kept"; dataKey: DataKey }

export async function settleDataKey(local: DataKey, found: NostrEvent, signer: () => Promise<Signer>, pubkey: string): Promise<DataKeySettlement> {
  // Our own record, or an older version relays will drop for ours: nothing to open.
  if (found.id === local.event.id || found.created_at < local.event.created_at) return { outcome: "same", dataKey: local }
  const remote = await unwrapDataKey(found, await signer(), pubkey)
  if (bytesToHex(remote.key) === bytesToHex(local.key)) return { outcome: "same", dataKey: { ...local, event: found } }
  const earlier = remote.created < local.created || (remote.created === local.created && bytesToHex(remote.key) < bytesToHex(local.key))
  return earlier ? { outcome: "adopted", dataKey: remote } : { outcome: "kept", dataKey: local }
}
