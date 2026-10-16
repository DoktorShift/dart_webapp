import { dbGet, dbWrite, type Keyed, type WriteOp } from "../storage/db.ts"

// The session's secrets at rest (docs/decisions/0002 §4): a local profile key, a signer app
// connection's own key. They are stored only encrypted with AES-GCM under a key that WebCrypto
// keeps non-extractable: code on this device can use it, but can't read it out, so a copy of the
// database alone reveals no profile key. Code running on this very site could still use it;
// a web app promises no hardware isolation (decision 0002 §10, PLAN "Schutz privater Daten").

const VAULT_KEY_ID = "profile.vault-key"

// What a secret is for, bound into the encryption, so one secret can't stand in for another.
// "match-keys": the keys of one live match (lib/live), which belong to the match, not the profile.
// "board-key": the key of a board device in a tournament (lib/tournaments), which belongs to
// the tournament's board, not the profile.
export type SecretPurpose = "local-key" | "connection-key" | "match-keys" | "board-key"

export interface SealedSecret {
  iv: Uint8Array<ArrayBuffer>
  data: Uint8Array<ArrayBuffer>
}

const additionalData = (purpose: SecretPurpose) => new TextEncoder().encode(`blueline-vault-v1:${purpose}`)

const storedKey = async () => (await dbGet<{ id: string; value: CryptoKey }>("kv", VAULT_KEY_ID))?.value ?? null

async function keyForSealing(): Promise<CryptoKey> {
  const stored = await storedKey()
  if (stored) return stored
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  // Another tab may create one at the same moment: the first one stored wins, and both use it.
  await dbWrite([{ store: "kv", putNew: { id: VAULT_KEY_ID, value: key } as Keyed }])
  return (await storedKey()) ?? key
}

export async function sealSecret(secret: Uint8Array, purpose: SecretPurpose): Promise<SealedSecret> {
  const key = await keyForSealing()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(purpose) }, key, new Uint8Array(secret)))
  return { iv, data }
}

// Throws when the vault key is gone (data deleted) or the secret was sealed for another purpose.
export async function openSecret(sealed: SealedSecret, purpose: SecretPurpose): Promise<Uint8Array> {
  const key = await storedKey()
  if (!key) throw new Error("the key that protects this profile on the device is missing")
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv, additionalData: additionalData(purpose) }, key, sealed.data))
}

// Removes the vault key, in the same write as whatever else goes with it (signing out).
export const forgetVaultKey = (): WriteOp => ({ store: "kv", delete: VAULT_KEY_ID })
