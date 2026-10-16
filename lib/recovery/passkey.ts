import { hkdf } from "@noble/hashes/hkdf"
import { sha256 } from "@noble/hashes/sha2"
import { utf8ToBytes } from "@noble/hashes/utils"
import { base64urlnopad } from "@scure/base"
import { decryptWithDataKey, encryptWithDataKey } from "../nostr/ext/crypto.ts"
import { createLocalSigner } from "../nostr/signers.ts"
import type { NostrEvent } from "../nostr/types.ts"
import { KIND_PRIVATE } from "../protocol/kinds.ts"
import { parseProfilePackage, type ProfilePackage } from "./package.ts"

// A passkey as a backup (decision 0002 §7, research DR-04 to DR-06, DR-20): WebAuthn's PRF
// extension gives a secret that only this passkey yields. From it, by HKDF, a locator key
// (a Nostr key that signs the backup, so a new device finds it by that key alone) and an
// encryption key for the profile package. Nothing here proves anything to a server: there is
// none; the passkey is a key store, not a login.
//
// PRF works only where platform, browser and passkey provider all support it, and not always
// at creation (research DR-05). So a passkey counts only when the value came at creation (or
// on the get() right after) AND an immediate second get() gives the same value. A passkey is
// never the only method called a backup (./backup.ts): losing it loses what only it opens.
//
// The browser's part comes in as `PasskeyEnv`, so the unit tests stand in for it with a
// simulated authenticator; real passkeys are verified only on real devices.

export const PRF_SALT = utf8ToBytes("blueline-passkey-v1")
export const PASSKEY_BACKUP_D = "blueline-backup-v1"
const CHALLENGE_BYTES = 32

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

export interface PasskeyEnv {
  create: (options: CredentialCreationOptions) => Promise<Credential | null>
  get: (options: CredentialRequestOptions) => Promise<Credential | null>
  // PublicKeyCredential.getClientCapabilities, where the browser has it.
  capabilities?: () => Promise<Record<string, boolean>>
  secure: boolean
  userAgent: string
}

// The browser's passkeys, or null where there are none.
export function browserPasskeys(): PasskeyEnv | null {
  if (typeof navigator === "undefined" || !navigator.credentials || typeof PublicKeyCredential === "undefined") return null
  const capabilities = (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities
  return {
    create: (options) => navigator.credentials.create(options),
    get: (options) => navigator.credentials.get(options),
    ...(capabilities ? { capabilities: () => capabilities.call(PublicKeyCredential) } : {}),
    secure: window.isSecureContext,
    userAgent: navigator.userAgent,
  }
}

// "unsupported": no PRF here. "cancelled": the person closed the passkey dialog. "mismatch":
// PRF came, but not the same twice. "not-found": no backup under this passkey on the relays
// asked ("offline": no relay answered). "damaged": the backup doesn't open.
export type PasskeyErrorCode = "unsupported" | "cancelled" | "mismatch" | "not-found" | "offline" | "damaged"

export class PasskeyError extends Error {
  code: PasskeyErrorCode
  constructor(code: PasskeyErrorCode, message: string) {
    super(message)
    this.name = "PasskeyError"
    this.code = code
  }
}

// Where PRF is known not to work, or to be unreliable (research DR-05): in-app browsers and
// WebViews, and iOS before 18.4.
export function passkeyPlatformOk(userAgent: string): boolean {
  if (/\bwv\b|WebView|FBAN|FBAV|Instagram|Line\//i.test(userAgent)) return false
  const ios = /iPhone|iPad|iPod/.test(userAgent) && /OS (\d+)_(\d+)/.exec(userAgent)
  if (ios) {
    const [major, minor] = [Number(ios[1]), Number(ios[2])]
    if (major < 18 || (major === 18 && minor < 4)) return false
  }
  return true
}

// Whether a passkey may work here. "possible" is a hint only; the round trip in enrollPasskey
// proves it.
export async function passkeySupport(env: PasskeyEnv | null = browserPasskeys()): Promise<"unsupported" | "possible"> {
  if (!env || !env.secure || !env.capabilities || !passkeyPlatformOk(env.userAgent)) return "unsupported"
  try {
    return (await env.capabilities()).prf === false ? "unsupported" : "possible"
  } catch {
    return "unsupported"
  }
}

export interface PasskeyKeys {
  // A Nostr secret key: it signs the backup event, so its public key finds the backup.
  locator: Uint8Array
  // Encrypts the package.
  aead: Uint8Array
  credentialId: string
}

const derive = (prf: Uint8Array, id: Uint8Array): PasskeyKeys => ({
  locator: hkdf(sha256, prf, PRF_SALT, utf8ToBytes("locator"), 32),
  aead: hkdf(sha256, prf, PRF_SALT, utf8ToBytes("aead"), 32),
  credentialId: base64urlnopad.encode(id),
})

const prfExtension = { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs

function prfResult(credential: Credential | null): { id: Uint8Array<ArrayBuffer>; prf: Uint8Array | null } {
  const c = credential as PublicKeyCredential | null
  if (!c || typeof c.getClientExtensionResults !== "function") throw new PasskeyError("unsupported", "no passkey was made")
  const results = (c.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } } }).prf?.results?.first
  const prf = results ? new Uint8Array(results instanceof ArrayBuffer ? results : results.buffer.slice(results.byteOffset, results.byteOffset + results.byteLength)) : null
  return { id: new Uint8Array(c.rawId), prf: prf && prf.length === 32 ? prf : null }
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === "NotAllowedError" || name === "AbortError") throw new PasskeyError("cancelled", "the passkey dialog was closed")
    throw new PasskeyError("unsupported", error instanceof Error ? error.message : String(error))
  }
}

// One assertion with the PRF: of the given passkey, or any of this site's the person picks.
async function assertion(env: PasskeyEnv, id?: Uint8Array<ArrayBuffer>) {
  return prfResult(
    await call(() =>
      env.get({
        publicKey: {
          challenge: random(CHALLENGE_BYTES),
          userVerification: "required",
          ...(id ? { allowCredentials: [{ type: "public-key", id }] } : {}),
          extensions: prfExtension,
        },
      }),
    ),
  )
}

// Makes a passkey and proves its PRF. The user handle is random: no name, no key of the
// profile (research DR-06).
export async function enrollPasskey(env: PasskeyEnv, options: { rpName: string; userName: string }): Promise<PasskeyKeys> {
  const created = prfResult(
    await call(() =>
      env.create({
        publicKey: {
          rp: { name: options.rpName },
          user: { id: random(32), name: options.userName, displayName: options.userName },
          challenge: random(CHALLENGE_BYTES),
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          extensions: prfExtension,
        },
      }),
    ),
  )
  // Some providers give no PRF at creation but do on a get() (Samsung Pass, research DR-05).
  const first = created.prf ?? (await assertion(env, created.id)).prf
  if (!first) throw new PasskeyError("unsupported", "this passkey gives no PRF value")
  const second = (await assertion(env, created.id)).prf
  if (!second || differ(first, second)) throw new PasskeyError("mismatch", "the PRF value didn't come back the same")
  return derive(first, created.id)
}

const differ = (a: Uint8Array, b: Uint8Array) => a.length !== b.length || a.some((byte, i) => byte !== b[i])

// Restoring on a new device: the passkey the person picks, and its keys.
export async function unlockPasskey(env: PasskeyEnv): Promise<PasskeyKeys> {
  const { id, prf } = await assertion(env)
  if (!prf) throw new PasskeyError("unsupported", "this passkey gives no PRF value")
  return derive(prf, id)
}

// ---- The backup on relays ----------------------------------------------------------------------

export const locatorPubkey = async (keys: PasskeyKeys) => (await createLocalSigner(keys.locator)).getPublicKey()

// The package, encrypted under the passkey's key, as a NIP-78 record the locator signs. Only the
// passkey holder can find it (by the locator's public key), open it, or write over it.
export async function passkeyBackupEvent(keys: PasskeyKeys, pkg: ProfilePackage, created_at: number): Promise<NostrEvent> {
  const signer = await createLocalSigner(keys.locator)
  const content = encryptWithDataKey(keys.aead, JSON.stringify(pkg), PASSKEY_BACKUP_D)
  return signer.signEvent({ kind: KIND_PRIVATE, created_at, tags: [["d", PASSKEY_BACKUP_D]], content })
}

export function openPasskeyBackup(event: NostrEvent, keys: PasskeyKeys, locator: string): ProfilePackage {
  if (event.pubkey !== locator || event.kind !== KIND_PRIVATE || !event.tags.some((t) => t[0] === "d" && t[1] === PASSKEY_BACKUP_D)) throw new PasskeyError("damaged", "not this passkey's backup")
  try {
    return parseProfilePackage(JSON.parse(decryptWithDataKey(keys.aead, event.content, PASSKEY_BACKUP_D)))
  } catch {
    throw new PasskeyError("damaged", "the backup doesn't open with this passkey")
  }
}
