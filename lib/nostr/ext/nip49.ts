// NIP-49: a secret key encrypted with a password (ncryptsec). To be upstreamed to nostr-core
// (gap NC-06): nostr-core 1.0.6 has no NIP-49 but ships the primitives used here, scrypt from
// @noble/hashes and XChaCha20-Poly1305 from @noble/ciphers.
//
// scrypt at log_n 16 needs 64 MiB and took 0.2 to 0.3 s on a desktop (Node and Chromium,
// evidence/P0.03/CORE.md); phones are slower. Run it off the main thread with
// ./nip49.offthread.ts in the app. This module is plain functions so it works in a worker,
// on the main thread and in Node tests alike.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { scrypt, scryptAsync } from "@noble/hashes/scrypt.js"
import { randomBytes } from "@noble/hashes/utils.js"
import { bech32 } from "@scure/base"

// 0x00: the key is known to have been handled insecurely (stored or pasted unencrypted).
// 0x01: it is not known to have been. 0x02: the client doesn't track this.
export type KeySecurity = 0 | 1 | 2

export const DEFAULT_LOG_N = 16
// Above this, scrypt needs more than 1 GiB; phones can't, and a file asking for it is suspect.
export const MAX_LOG_N = 20
const VERSION = 0x02
const PREFIX = "ncryptsec"
const PAYLOAD_LENGTH = 91

export type Nip49ErrorCode = "malformed" | "unsupported" | "wrong-password" | "invalid-key"

export class Nip49Error extends Error {
  code: Nip49ErrorCode
  constructor(code: Nip49ErrorCode, message: string) {
    super(message)
    this.name = "Nip49Error"
    this.code = code
  }
}

export interface EncryptOptions {
  logN?: number
  keySecurity?: KeySecurity
  // Only for reproducible tests; normally random.
  salt?: Uint8Array
  nonce?: Uint8Array
}

export interface Decrypted {
  secretKey: Uint8Array
  logN: number
  keySecurity: KeySecurity
}

// Passwords are NFKC-normalized so the same password typed on another device (other keyboard,
// composed or decomposed umlauts) gives the same key.
export function normalizePassword(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize("NFKC"))
}

const scryptOptions = (logN: number) => ({ N: 2 ** logN, r: 8, p: 1, dkLen: 32, maxmem: 128 * 8 * 2 ** MAX_LOG_N + 1024 })

function checkLogN(logN: number) {
  if (!Number.isInteger(logN) || logN < 1 || logN > MAX_LOG_N) throw new Nip49Error("unsupported", `log_n ${logN} is outside 1 to ${MAX_LOG_N}`)
}

function seal(key: Uint8Array, secretKey: Uint8Array, logN: number, salt: Uint8Array, nonce: Uint8Array, keySecurity: KeySecurity): string {
  const associated = Uint8Array.of(keySecurity)
  const ciphertext = xchacha20poly1305(key, nonce, associated).encrypt(secretKey)
  key.fill(0)
  const payload = new Uint8Array(PAYLOAD_LENGTH)
  payload.set([VERSION, logN], 0)
  payload.set(salt, 2)
  payload.set(nonce, 18)
  payload.set(associated, 42)
  payload.set(ciphertext, 43)
  return bech32.encode(PREFIX, bech32.toWords(payload), 200)
}

interface Parsed {
  logN: number
  salt: Uint8Array
  nonce: Uint8Array
  keySecurity: KeySecurity
  associated: Uint8Array
  ciphertext: Uint8Array
}

function parse(ncryptsec: string): Parsed {
  let payload: Uint8Array
  try {
    const decoded = bech32.decode(ncryptsec.trim().toLowerCase() as `${string}1${string}`, 200)
    if (decoded.prefix !== PREFIX) throw new Error("prefix")
    payload = bech32.fromWords(decoded.words)
  } catch {
    throw new Nip49Error("malformed", "not an ncryptsec")
  }
  if (payload.length !== PAYLOAD_LENGTH) throw new Nip49Error("malformed", "wrong length")
  if (payload[0] !== VERSION) throw new Nip49Error("unsupported", `version ${payload[0]}`)
  const logN = payload[1]
  checkLogN(logN)
  const keySecurity = payload[42]
  if (keySecurity > 2) throw new Nip49Error("malformed", "unknown key security byte")
  return {
    logN,
    salt: payload.slice(2, 18),
    nonce: payload.slice(18, 42),
    keySecurity: keySecurity as KeySecurity,
    associated: payload.slice(42, 43),
    ciphertext: payload.slice(43),
  }
}

function open(key: Uint8Array, parsed: Parsed): Decrypted {
  let secretKey: Uint8Array
  try {
    secretKey = xchacha20poly1305(key, parsed.nonce, parsed.associated).decrypt(parsed.ciphertext)
  } catch {
    throw new Nip49Error("wrong-password", "wrong password or damaged data")
  } finally {
    key.fill(0)
  }
  if (secretKey.length !== 32) throw new Nip49Error("invalid-key", "not a secret key")
  return { secretKey, logN: parsed.logN, keySecurity: parsed.keySecurity }
}

function prepare(secretKey: Uint8Array, options: EncryptOptions) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) throw new Nip49Error("invalid-key", "a secret key has 32 bytes")
  const logN = options.logN ?? DEFAULT_LOG_N
  checkLogN(logN)
  return { logN, salt: options.salt ?? randomBytes(16), nonce: options.nonce ?? randomBytes(24), keySecurity: options.keySecurity ?? 2 }
}

// Synchronous: blocks for the whole scrypt run. Use in a worker.
export function encrypt(secretKey: Uint8Array, password: string, options: EncryptOptions = {}): string {
  const { logN, salt, nonce, keySecurity } = prepare(secretKey, options)
  return seal(scrypt(normalizePassword(password), salt, scryptOptions(logN)), secretKey, logN, salt, nonce, keySecurity)
}

export function decrypt(ncryptsec: string, password: string): Decrypted {
  const parsed = parse(ncryptsec)
  return open(scrypt(normalizePassword(password), parsed.salt, scryptOptions(parsed.logN)), parsed)
}

// Same results through @noble's scryptAsync. Note that it yields only to microtasks, so on the
// main thread the page still can't paint or take input until it is done; its use is in the
// worker (where it also runs far faster than the synchronous variant in Chromium) and as the
// fallback when no worker can start.
export async function encryptAsync(secretKey: Uint8Array, password: string, options: EncryptOptions = {}): Promise<string> {
  const { logN, salt, nonce, keySecurity } = prepare(secretKey, options)
  return seal(await scryptAsync(normalizePassword(password), salt, { ...scryptOptions(logN), asyncTick: 25 }), secretKey, logN, salt, nonce, keySecurity)
}

export async function decryptAsync(ncryptsec: string, password: string): Promise<Decrypted> {
  const parsed = parse(ncryptsec)
  return open(await scryptAsync(normalizePassword(password), parsed.salt, { ...scryptOptions(parsed.logN), asyncTick: 25 }), parsed)
}

// Reads the parameters without the password (to tell how long decryption will take).
export function inspect(ncryptsec: string): { logN: number; keySecurity: KeySecurity } {
  const { logN, keySecurity } = parse(ncryptsec)
  return { logN, keySecurity }
}
