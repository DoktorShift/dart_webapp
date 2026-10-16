import { test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { decrypt, encrypt } from "../lib/nostr/ext/nip49.ts"
import { createLocalSigner } from "../lib/nostr/signers.ts"
import type { NostrEvent } from "../lib/nostr/types.ts"
import { BACKUP_VERSION, BackupFileError, backupFileName, makeBackupFile, newBackupPassword, openBackupFile, type BackupFile, type Nip49 } from "../lib/recovery/backup-file.ts"
import type { ProfilePackage } from "../lib/recovery/package.ts"

// The backup file (P2.04): a NIP-49 key plus the rest of the profile package, both under the
// generated password. The official NIP-49 vector stands in for "another app wrote the key".

const VECTOR = "ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p"
const VECTOR_KEY = "3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683"

// scrypt at a small cost, synchronous: the tests don't wait for log_n 16.
const quick: Nip49 = { encrypt: async (key, password, options) => encrypt(key, password, { ...options, logN: 4 }), decrypt: async (text, password) => decrypt(text, password) }

async function vectorPackage(): Promise<ProfilePackage> {
  const signer = await createLocalSigner(hexToBytes(VECTOR_KEY))
  const pubkey = await signer.getPublicKey()
  // As plain JSON, the way events come out of a file (no verified mark of the signer).
  const relayList: NostrEvent = JSON.parse(JSON.stringify(await signer.signEvent({ kind: 10002, created_at: 1_790_000_000, tags: [["r", "wss://relay.example"]], content: "" })))
  return { v: 1, pubkey, access: { kind: "local", key: VECTOR_KEY }, events: [relayList] }
}

const code = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof BackupFileError, String(error))
    return error.code
  }
  return "no error"
}

test("backup file: round trip keeps the key, the data key and the events; the file names its format", async () => {
  const pkg = await vectorPackage()
  const dataKey = { key: bytesToHex(new Uint8Array(32).fill(7)), created: 1_790_000_000, event: pkg.events[0] }
  const text = await makeBackupFile(pkg, "pw", { nip49: quick, now: new Date("2026-10-16T20:00:00Z") })
  const file: BackupFile = JSON.parse(text)
  assert.equal(file.format, "blueline-backup")
  assert.equal(file.version, BACKUP_VERSION)
  assert.equal(file.created, "2026-10-16T20:00:00.000Z")
  assert.equal(file.pubkey, pkg.pubkey)
  assert.match(file.ncryptsec, /^ncryptsec1/)
  // Nothing of the key or the relay list is readable in the file.
  assert.ok(!text.includes(VECTOR_KEY) && !text.includes("relay.example"))

  const back = await openBackupFile(text, "pw", quick)
  assert.deepEqual(back, { v: 1, pubkey: pkg.pubkey, access: { kind: "local", key: VECTOR_KEY }, events: pkg.events })

  // A data key record travels too (its event is the profile's data key record; here any signed
  // event of the profile is refused, the slot being another one).
  const withKey = await makeBackupFile({ ...pkg, dataKey }, "pw", { nip49: quick })
  assert.equal(await code(() => openBackupFile(withKey, "pw", quick)), "damaged")
  assert.equal(backupFileName(new Date("2026-10-16T20:00:00Z")), "blueline-sicherung-2026-10-16.json")
})

test("backup file: the key part is a standard NIP-49 key (the official vector opens with 'nostr')", async () => {
  const pkg = await vectorPackage()
  const text = await makeBackupFile(pkg, "nostr", { nip49: quick })
  // The same key, written by another implementation at log_n 16: the rest still opens, since it
  // hangs off the key, not the password.
  const spliced = JSON.stringify({ ...JSON.parse(text), ncryptsec: VECTOR })
  const back = await openBackupFile(spliced, "nostr")
  assert.equal(back.access.kind === "local" && back.access.key, VECTOR_KEY)
  assert.equal(back.pubkey, pkg.pubkey)
})

test("backup file: wrong password, damage and foreign files are told apart", async () => {
  const pkg = await vectorPackage()
  const text = await makeBackupFile(pkg, "right", { nip49: quick })
  const file: BackupFile = JSON.parse(text)
  assert.equal(await code(() => openBackupFile(text, "wrong", quick)), "wrong-password")
  assert.equal(await code(() => openBackupFile("not json", "right", quick)), "damaged")
  assert.equal(await code(() => openBackupFile(JSON.stringify({ ...file, format: "blueline-data" }), "right", quick)), "format")
  assert.equal(await code(() => openBackupFile(JSON.stringify({ ...file, version: BACKUP_VERSION + 1 }), "right", quick)), "newer")
  assert.equal(await code(() => openBackupFile(JSON.stringify({ ...file, ncryptsec: file.ncryptsec.slice(0, -4) + "qqqq" }), "right", quick)), "damaged")
  // The encrypted rest changed by one character: the authentication tag catches it.
  const flipped = file.data[10] === "A" ? "B" : "A"
  assert.equal(await code(() => openBackupFile(JSON.stringify({ ...file, data: file.data.slice(0, 10) + flipped + file.data.slice(11) }), "right", quick)), "damaged")
  // The rest moved to another profile's file doesn't open there either.
  assert.equal(await code(() => openBackupFile(JSON.stringify({ ...file, pubkey: "ab".repeat(32) }), "right", quick)), "damaged")
  // A profile in a signer app has no key to back up.
  assert.equal(await code(() => makeBackupFile({ ...pkg, access: { kind: "nip46" } }, "pw", { nip49: quick })), "not-local")
})

test("backup password: four groups of five unambiguous letters and digits, evenly drawn", () => {
  const password = newBackupPassword()
  assert.match(password, /^[a-hj-km-np-z2-9]{5}(-[a-hj-km-np-z2-9]{5}){3}$/)
  // Bytes at or above 248 are drawn again, so no letter is likelier than another.
  let calls = 0
  const fixed = newBackupPassword((n) => {
    calls++
    return new Uint8Array(n).map((_, i) => (calls === 1 ? 250 : i))
  })
  assert.equal(calls, 2)
  assert.equal(fixed, "abcde-fghjk-mnpqr-stuvw")
})
