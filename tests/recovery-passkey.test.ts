import { test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { createLocalSigner } from "../lib/nostr/signers.ts"
import type { ProfilePackage } from "../lib/recovery/package.ts"
import { enrollPasskey, locatorPubkey, openPasskeyBackup, passkeyBackupEvent, PasskeyError, passkeyPlatformOk, passkeySupport, unlockPasskey, type PasskeyEnv } from "../lib/recovery/passkey.ts"

// The passkey backup (P2.04) against a SIMULATED authenticator: WebAuthn is stood in for by a
// fake that behaves like the providers research DR-05 describes (PRF at creation, PRF only on
// get(), no PRF, unstable PRF, a closed dialog). Real passkeys, platforms and password managers
// are verified only on real devices (open item).

type Behaviour = { prfAtCreate?: boolean; prfAtGet?: boolean; stable?: boolean; cancel?: boolean }

function simulatedAuthenticator({ prfAtCreate = true, prfAtGet = true, stable = true, cancel = false }: Behaviour = {}): PasskeyEnv & { credentials: Map<string, Uint8Array> } {
  const credentials = new Map<string, Uint8Array>()
  const credential = (id: Uint8Array, prf: Uint8Array | null) =>
    ({ rawId: id.buffer, getClientExtensionResults: () => (prf ? { prf: { results: { first: prf.buffer } } } : {}) }) as unknown as Credential
  const denied = () => Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" })
  return {
    credentials,
    secure: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Safari/605.1.15",
    capabilities: async () => ({ prf: true }),
    async create(options) {
      if (cancel) throw denied()
      const id = randomBytes(16)
      const secret = randomBytes(32)
      credentials.set(bytesToHex(id), secret)
      const extensions = options.publicKey?.extensions as { prf?: { eval?: { first?: unknown } } } | undefined
      assert.ok(extensions?.prf?.eval?.first, "the PRF extension is asked for at creation")
      assert.equal(options.publicKey?.authenticatorSelection?.residentKey, "required")
      assert.equal(options.publicKey?.authenticatorSelection?.userVerification, "required")
      return credential(id, prfAtCreate ? secret : null)
    },
    async get(options) {
      if (cancel) throw denied()
      const allowed = options.publicKey?.allowCredentials?.[0]?.id
      const id = allowed ? new Uint8Array(allowed as ArrayBuffer) : (() => {
        const [first] = credentials.keys()
        return new Uint8Array(first.match(/../g)!.map((h) => parseInt(h, 16)))
      })()
      const secret = credentials.get(bytesToHex(id))
      if (!secret) throw denied()
      return credential(id, prfAtGet ? (stable ? secret : randomBytes(32)) : null)
    },
  }
}

const code = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof PasskeyError, String(error))
    return error.code
  }
  return "no error"
}

test("simulated passkey: enrolling proves the PRF twice and derives keys the same passkey yields again", async () => {
  const env = simulatedAuthenticator()
  const keys = await enrollPasskey(env, { rpName: "BlueLine Darts", userName: "BlueLine Darts" })
  assert.equal(keys.locator.length, 32)
  assert.equal(keys.aead.length, 32)
  assert.notEqual(bytesToHex(keys.locator), bytesToHex(keys.aead))
  // Restoring: the passkey picked from the list gives the same keys, so the same locator.
  const again = await unlockPasskey(env)
  assert.equal(bytesToHex(again.locator), bytesToHex(keys.locator))
  assert.equal(bytesToHex(again.aead), bytesToHex(keys.aead))
  assert.equal(await locatorPubkey(again), await locatorPubkey(keys))
  // Another passkey yields other keys.
  const other = await enrollPasskey(simulatedAuthenticator(), { rpName: "BlueLine Darts", userName: "BlueLine Darts" })
  assert.notEqual(bytesToHex(other.locator), bytesToHex(keys.locator))
})

test("simulated passkey: PRF only on get() (Samsung Pass) passes; no PRF, an unstable PRF and a closed dialog don't", async () => {
  const options = { rpName: "BlueLine Darts", userName: "BlueLine Darts" }
  await enrollPasskey(simulatedAuthenticator({ prfAtCreate: false }), options)
  assert.equal(await code(() => enrollPasskey(simulatedAuthenticator({ prfAtCreate: false, prfAtGet: false }), options)), "unsupported")
  assert.equal(await code(() => enrollPasskey(simulatedAuthenticator({ stable: false }), options)), "mismatch")
  assert.equal(await code(() => enrollPasskey(simulatedAuthenticator({ cancel: true }), options)), "cancelled")
  assert.equal(await code(() => unlockPasskey(simulatedAuthenticator({ cancel: true }))), "cancelled")
})

test("passkey support: only a secure page with the capability on a platform where PRF is known to work", async () => {
  const env = simulatedAuthenticator()
  assert.equal(await passkeySupport(env), "possible")
  assert.equal(await passkeySupport(null), "unsupported")
  assert.equal(await passkeySupport({ ...env, secure: false }), "unsupported")
  assert.equal(await passkeySupport({ ...env, capabilities: undefined }), "unsupported")
  assert.equal(await passkeySupport({ ...env, capabilities: async () => ({ prf: false }) }), "unsupported")
  assert.equal(await passkeySupport({ ...env, capabilities: async () => ({}) }), "possible")
  assert.equal(passkeyPlatformOk("Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X)"), false)
  assert.equal(passkeyPlatformOk("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)"), true)
  assert.equal(passkeyPlatformOk("Mozilla/5.0 (Linux; Android 14; wv) Chrome/120"), false)
  assert.equal(passkeyPlatformOk("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) FBAN/FBIOS"), false)
  assert.equal(passkeyPlatformOk("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) Safari/605.1.15"), true)
})

test("simulated passkey: the backup on relays is signed by the locator and opens only with the passkey's keys", async () => {
  const keys = await enrollPasskey(simulatedAuthenticator(), { rpName: "BlueLine Darts", userName: "BlueLine Darts" })
  const secret = randomBytes(32)
  const pubkey = await (await createLocalSigner(secret)).getPublicKey()
  const pkg: ProfilePackage = { v: 1, pubkey, access: { kind: "local", key: bytesToHex(secret) }, events: [] }
  const event = await passkeyBackupEvent(keys, pkg, 1_790_000_000)
  const locator = await locatorPubkey(keys)
  assert.equal(event.pubkey, locator)
  assert.equal(event.kind, 30078)
  assert.deepEqual(event.tags, [["d", "blueline-backup-v1"]])
  assert.ok(!event.content.includes(bytesToHex(secret)) && !event.content.includes(pubkey))
  assert.deepEqual(openPasskeyBackup(event, keys, locator), pkg)
  const other = await enrollPasskey(simulatedAuthenticator(), { rpName: "BlueLine Darts", userName: "BlueLine Darts" })
  assert.equal(await code(async () => openPasskeyBackup(event, other, locator)), "damaged")
  assert.equal(await code(async () => openPasskeyBackup(event, keys, await locatorPubkey(other))), "damaged")
})
