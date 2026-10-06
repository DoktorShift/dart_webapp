import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js"
import { isSignerFailure } from "../nostr/ext/crypto.ts"
import { createdAt } from "../nostr/time.ts"
import type { NostrEvent, Signer } from "../nostr/types.ts"
import { openSecret, sealSecret, type SealedSecret } from "../profile/vault.ts"
import { dataKeyRecord, dataKeySlot, privateTemplate } from "../protocol/private.ts"
import { dbGet, dbWrite, type Keyed } from "../storage/db.ts"

// The profile's data key (docs/decisions/0002 §4): 32 random bytes under which every private
// record is encrypted. It sits on relays once, NIP-44-encrypted to the profile itself, as the
// 30078 record at dataKeySlot(pubkey). Each device unwraps it once (one signer decryption, also
// for a signer app) and keeps it sealed like the profile key (lib/profile/vault.ts); it goes with
// the profile when it signs out (kv "profile.*", lib/profile/session.ts).
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

// Why the data key can't be had: the signer didn't answer or declined ("signer"), can't decrypt
// at all ("unsupported", e.g. the Android signer), or the record doesn't open ("unreadable",
// never a reason to make a new key over it).
export type DataKeyProblem = "signer" | "unsupported" | "unreadable"

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

// Opens a data key record with the profile's signer.
export async function unwrapDataKey(event: NostrEvent, signer: Signer): Promise<DataKey> {
  const nip44 = nip44Of(signer)
  let plaintext: string
  try {
    plaintext = await nip44.decrypt(event.pubkey, event.content)
  } catch (error) {
    if (isSignerFailure(error)) throw new DataKeyError("signer", error instanceof Error ? error.message : String(error))
    throw new DataKeyError("unreadable", "the data key record doesn't open with this profile's key")
  }
  try {
    const record = dataKeyRecord.check(JSON.parse(plaintext), "")
    return { key: hexToBytes(record.key), created: record.created, event }
  } catch {
    throw new DataKeyError("unreadable", "the data key record holds no data key")
  }
}

// Signs the record of a data key, newer than the version relays have now (`replaces`).
async function signDataKey(key: Uint8Array, created: number, signer: Signer, replaces?: number): Promise<DataKey> {
  const pubkey = await signer.getPublicKey()
  const content = await nip44Of(signer).encrypt(pubkey, JSON.stringify({ v: 1, key: bytesToHex(key), created }))
  return { key, created, event: await signer.signEvent(privateTemplate(dataKeySlot(pubkey), content, createdAt(replaces))) }
}

// A new data key, for a profile whose relays confirmed it has none.
export function createDataKey(signer: Signer): Promise<DataKey> {
  const created = createdAt()
  return signDataKey(randomBytes(32), created, signer)
}

// The outcome of finding a data key record on relays that isn't this device's: the same key
// ("same", maybe signed anew elsewhere), another one made earlier ("adopted": records must be
// sealed again under it), or another one made later ("kept": ours was signed again to replace it).
export type DataKeySettlement = { outcome: "same" | "adopted" | "kept"; dataKey: DataKey }

export async function settleDataKey(local: DataKey, found: NostrEvent, signer: () => Promise<Signer>): Promise<DataKeySettlement> {
  // Our own record, or an older version relays will drop for ours: nothing to open.
  if (found.id === local.event.id || found.created_at < local.event.created_at) return { outcome: "same", dataKey: local }
  const remote = await unwrapDataKey(found, await signer())
  if (bytesToHex(remote.key) === bytesToHex(local.key)) return { outcome: "same", dataKey: { ...local, event: found } }
  const earlier = remote.created < local.created || (remote.created === local.created && bytesToHex(remote.key) < bytesToHex(local.key))
  if (earlier) return { outcome: "adopted", dataKey: remote }
  return { outcome: "kept", dataKey: await signDataKey(local.key, local.created, await signer(), found.created_at) }
}
