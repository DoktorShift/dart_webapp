import { hkdf } from "@noble/hashes/hkdf"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils"
import { decryptWithDataKey, encryptWithDataKey } from "../nostr/ext/crypto.ts"
import { Nip49Error, type EncryptOptions } from "../nostr/ext/nip49.ts"
import { decryptOffThread, encryptOffThread } from "../nostr/ext/nip49.offthread.ts"
import { exportFileName } from "../storage/data.ts"
import { PackageError, parseProfilePackage, type ProfilePackage } from "./package.ts"

// The backup file (decision 0002 §7): JSON with the profile key as NIP-49 ncryptsec under the
// password (scrypt log_n 16, run in a worker by lib/nostr/ext/nip49.offthread.ts), and the rest
// of the profile package (data key, relay list, name) encrypted under a key derived from the
// profile key itself: whoever opens the ncryptsec opens the rest, and nothing else does.
//
//   {
//     "format": "blueline-backup", "version": 1, "created": "<ISO time>", "pubkey": "<hex>",
//     "ncryptsec": "ncryptsec1…",
//     "data": base64(0x01 ‖ nonce ‖ XChaCha20-Poly1305(HKDF(key, "blueline-backup-v1", "data"), { dataKey, events }, aad = 0x01 ‖ pubkey))
//   }
//
// The ncryptsec alone is a standard NIP-49 key: any other Nostr app opens it with the password
// (decision 0002 §7, "mit einer dokumentierten unabhängigen Implementierung lesbar").

export const BACKUP_FORMAT = "blueline-backup"
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  created: string
  pubkey: string
  ncryptsec: string
  data: string
}

// "not-local": a profile in a signer app has no key here to put into a file.
export type BackupFileErrorCode = "format" | "newer" | "damaged" | "wrong-password" | "not-local"

export class BackupFileError extends Error {
  code: BackupFileErrorCode
  constructor(code: BackupFileErrorCode, message: string) {
    super(message)
    this.name = "BackupFileError"
    this.code = code
  }
}

// ---- The password --------------------------------------------------------------------------

// Four groups of five, from letters and digits that can't be misread (no 0/o, 1/l/i): about
// 99 bits, made to be kept in a password manager, never typed from memory.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
const GROUPS = 4
const GROUP_LENGTH = 5

export function newBackupPassword(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const letters: string[] = []
  // Rejection sampling keeps every letter equally likely.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length
  while (letters.length < GROUPS * GROUP_LENGTH) {
    for (const byte of random(GROUPS * GROUP_LENGTH)) {
      if (byte < limit && letters.length < GROUPS * GROUP_LENGTH) letters.push(ALPHABET[byte % ALPHABET.length])
    }
  }
  return Array.from({ length: GROUPS }, (_, i) => letters.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH).join("")).join("-")
}

// ---- Making and opening ----------------------------------------------------------------------

const fileKey = (secret: Uint8Array) => hkdf(sha256, secret, utf8ToBytes("blueline-backup-v1"), utf8ToBytes("data"), 32)

export interface Nip49 {
  encrypt: typeof encryptOffThread
  decrypt: typeof decryptOffThread
}

const OFF_THREAD: Nip49 = { encrypt: encryptOffThread, decrypt: decryptOffThread }

// The file's text for a local profile's package. `nip49` (and a small log_n) are for the tests.
export async function makeBackupFile(pkg: ProfilePackage, password: string, options: { nip49?: Nip49; logN?: number; now?: Date } = {}): Promise<string> {
  if (pkg.access.kind !== "local") throw new BackupFileError("not-local", "a profile in a signer app has no key to back up")
  const secret = hexToBytes(pkg.access.key)
  // Key security 1: the key was never handled unencrypted by this app (NIP-49).
  const nip49Options: EncryptOptions = { keySecurity: 1, ...(options.logN ? { logN: options.logN } : {}) }
  const ncryptsec = await (options.nip49 ?? OFF_THREAD).encrypt(secret, password, nip49Options)
  const data = encryptWithDataKey(fileKey(secret), JSON.stringify({ dataKey: pkg.dataKey, events: pkg.events }), pkg.pubkey)
  const file: BackupFile = { format: BACKUP_FORMAT, version: BACKUP_VERSION, created: (options.now ?? new Date()).toISOString(), pubkey: pkg.pubkey, ncryptsec, data }
  return JSON.stringify(file, null, 2)
}

export async function openBackupFile(text: string, password: string, nip49: Pick<Nip49, "decrypt"> = OFF_THREAD): Promise<ProfilePackage> {
  const damaged = (detail: string) => new BackupFileError("damaged", detail)
  let file: Partial<BackupFile>
  try {
    file = JSON.parse(text)
  } catch {
    throw damaged("not JSON")
  }
  if (!file || typeof file !== "object" || file.format !== BACKUP_FORMAT) throw new BackupFileError("format", "not a BlueLine backup")
  if (typeof file.version !== "number" || file.version > BACKUP_VERSION) throw new BackupFileError("newer", `backup version ${file.version}`)
  if (typeof file.pubkey !== "string" || typeof file.ncryptsec !== "string" || typeof file.data !== "string") throw damaged("fields missing")
  let secret: Uint8Array
  try {
    ;({ secretKey: secret } = await nip49.decrypt(file.ncryptsec, password))
  } catch (error) {
    if (error instanceof Nip49Error && error.code === "wrong-password") throw new BackupFileError("wrong-password", "wrong password")
    throw damaged("the key doesn't open")
  }
  let inner: { dataKey?: unknown; events?: unknown }
  try {
    inner = JSON.parse(decryptWithDataKey(fileKey(secret), file.data, file.pubkey))
  } catch {
    throw damaged("the data doesn't open")
  }
  try {
    return parseProfilePackage({ v: 1, pubkey: file.pubkey, access: { kind: "local", key: bytesToHex(secret) }, ...(inner.dataKey ? { dataKey: inner.dataKey } : {}), events: inner.events ?? [] })
  } catch (error) {
    throw error instanceof PackageError ? damaged(error.message) : error
  }
}

// "blueline-sicherung-2026-10-16.json"
export const backupFileName = (now?: Date) => exportFileName("blueline-sicherung", now)
