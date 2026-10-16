import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "./storage-helpers.ts"
import { loadCore } from "../lib/nostr/core.ts"
import type { Nip46Connection } from "../lib/nostr/signers.ts"
import type { Signer } from "../lib/nostr/types.ts"
import { dbGet, dbGetAll, dbKeys, dbPut, kvSet } from "../lib/storage/db.ts"
import { connectExternal, getSession, getSigner, importLocalKey, loadSession, onSessionEnd, signOut, startLocalProfile } from "../lib/profile/session.ts"
import { SESSION_KEY } from "../lib/profile/storage-keys.ts"
import { openSecret, sealSecret } from "../lib/profile/vault.ts"
import { newDraft } from "../lib/tournaments/draft.ts"
import { listDrafts, saveDraft } from "../lib/tournaments/store.ts"

// The session contract of decision 0002 §4: one current session, every signer checked, the local
// key only ever stored encrypted, and nothing of a profile left behind when it signs out or
// another profile signs in on the device.

beforeEach(async () => {
  // Ends whatever session the previous test left in this module, then starts on an empty device.
  await signOut({ keepLocalData: true })
  await resetStorage()
})

const template = () => ({ kind: 0, content: '{"name":"Lena"}', tags: [], created_at: 1_790_000_000 })

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")

// Everything stored on the device, as text, to look for secrets in it.
async function dump() {
  const stores = ["kv", "objects", "pending", "players", "matches"] as const
  const all = await Promise.all(stores.map((store) => dbGetAll(store)))
  return JSON.stringify(all, (_key, value) => (value instanceof Uint8Array ? toHex(value) : value))
}

test("a guest has no session, and asking for a signer fails", async () => {
  assert.equal(await loadSession(), null)
  assert.equal(getSession(), null)
  await assert.rejects(getSigner(), /no profile/)
})

test("a new local profile signs with its own key, checked against the session", async () => {
  const session = await startLocalProfile()
  assert.match(session.pubkey, /^[0-9a-f]{64}$/)
  assert.equal(session.kind, "local")
  assert.equal(session.madeHere, true)
  assert.deepEqual(getSession(), session)
  const signer = await getSigner()
  assert.equal(await signer.getPublicKey(), session.pubkey)
  const event = await signer.signEvent(template())
  assert.equal(event.pubkey, session.pubkey)
  const core = await loadCore()
  assert.ok(core.verifyEventSignature(event))
  // Encryption to oneself works with a local key.
  assert.equal(await signer.nip44!.decrypt(session.pubkey, await signer.nip44!.encrypt(session.pubkey, "x")), "x")
})

test("the local key is stored only encrypted, under a key that can't be read out", async () => {
  const core = await loadCore()
  const secret = core.generateSecretKey()
  const session = await importLocalKey(secret)
  assert.equal(session.pubkey, core.getPublicKey(secret))
  const stored = await dump()
  assert.ok(!stored.includes(toHex(secret)), "the key must not be in the database in the clear")
  const vault = await dbGet<{ id: string; value: CryptoKey }>("kv", "profile.vault-key")
  assert.equal(vault?.value.extractable, false)
  await assert.rejects(crypto.subtle.exportKey("raw", vault!.value))
  // The signer opens from the sealed key.
  assert.equal((await (await getSigner()).signEvent(template())).pubkey, session.pubkey)
})

test("a sealed secret opens only for what it was sealed for", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32))
  const sealed = await sealSecret(secret, "local-key")
  assert.deepEqual(await openSecret(sealed, "local-key"), secret)
  await assert.rejects(openSecret(sealed, "connection-key"))
  await assert.rejects(openSecret({ ...sealed, data: sealed.data.map((b, i) => (i === 0 ? b ^ 1 : b)) }, "local-key"))
})

test("signing out removes the keys and everything of the profile, and keeps the games when asked", async () => {
  await startLocalProfile()
  await kvSet("profile.settings", { card: true })
  await dbPut("objects", [{ id: "own:0:" }, { id: "profile:someone-else" }])
  await dbPut("pending", { id: "signer:abc" })
  await dbPut("matches", { id: "m1" })
  await kvSet("results-offer.dismissed", ["m1"])
  let ended = 0
  const stop = onSessionEnd(() => {
    ended++
  })
  await signOut({ keepLocalData: true })
  stop()
  assert.equal(ended, 1)
  assert.equal(getSession(), null)
  assert.deepEqual(await dbKeys("kv"), ["results-offer.dismissed"])
  assert.deepEqual(await dbKeys("objects"), ["profile:someone-else"])
  assert.deepEqual(await dbKeys("pending"), [])
  assert.deepEqual(await dbKeys("matches"), ["m1"])
  await assert.rejects(getSigner(), /no profile/)
})

test("signing out without keeping local data deletes everything on the device", async () => {
  await startLocalProfile()
  await dbPut("matches", { id: "m1" })
  await dbPut("players", { id: "pl_1" })
  await signOut({ keepLocalData: false })
  assert.deepEqual(await dbKeys("matches"), [])
  assert.deepEqual(await dbKeys("players"), [])
  assert.deepEqual(await dbKeys("kv"), [])
})

test("signing out says when deleting everything couldn't delete everything; the session ends either way", async () => {
  await startLocalProfile()
  await dbPut("matches", { id: "m1" })
  const transaction = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, names: string | string[], mode?: IDBTransactionMode, ...rest: [IDBTransactionOptions?]) {
    if (mode === "readwrite" && [names].flat().includes("matches")) throw new DOMException("the disk is full", "QuotaExceededError")
    return transaction.call(this, names, mode, ...rest)
  }
  try {
    assert.equal(await signOut({ keepLocalData: false }), false)
  } finally {
    IDBDatabase.prototype.transaction = transaction
  }
  assert.equal(getSession(), null)
  assert.deepEqual(await dbKeys("matches"), ["m1"])
  assert.equal(await signOut({ keepLocalData: false }), true)
})

test("another profile signing in clears the previous one's data, but not the device's", async () => {
  const first = await startLocalProfile()
  await kvSet("profile.settings", { card: true })
  await dbPut("objects", { id: "own:10002:" })
  await dbPut("matches", { id: "m1" })
  let ended = 0
  const stop = onSessionEnd(() => {
    ended++
  })
  const core = await loadCore()
  const second = core.getPublicKey(core.generateSecretKey())
  await connectExternal("nip07", { pubkey: second }, { replace: true })
  stop()
  assert.equal(ended, 1)
  assert.equal(getSession()?.pubkey, second)
  assert.notEqual(second, first.pubkey)
  assert.deepEqual(await dbKeys("objects"), [])
  assert.deepEqual((await dbKeys("kv")).sort(), [SESSION_KEY, "profile.vault-key"].sort())
  assert.deepEqual(await dbKeys("matches"), ["m1"])
})

test("a tournament being created is the profile's: the next profile doesn't see it, a sign-out takes it", async () => {
  const core = await loadCore()
  await importLocalKey(core.generateSecretKey())
  // The draft names a closed club and a guest.
  await saveDraft({ ...newDraft("d1", "Europe/Berlin"), club: "c".repeat(64), clubName: "Geheimer Club", name: "Vereinsmeisterschaft", guests: ["Mia Muster"] })
  await importLocalKey(core.generateSecretKey(), { replace: true })
  assert.deepEqual(await listDrafts(), [])
  await saveDraft({ ...newDraft("d2", "Europe/Berlin"), name: "Sommercup" })
  await signOut({ keepLocalData: true })
  assert.deepEqual(await listDrafts(), [])
})

test("another profile signs in only with replace: without it, nothing changes and the key stays", async () => {
  const first = await startLocalProfile()
  await dbPut("objects", { id: "own:0:" })
  const core = await loadCore()
  const second = core.getPublicKey(core.generateSecretKey())
  let ended = 0
  const stop = onSessionEnd(() => {
    ended++
  })
  await assert.rejects(connectExternal("nip07", { pubkey: second }), { name: "SessionError", code: "occupied", session: first })
  await assert.rejects(startLocalProfile(), { name: "SessionError", code: "occupied" })
  await assert.rejects(importLocalKey(core.generateSecretKey()), { name: "SessionError", code: "occupied" })
  stop()
  assert.equal(ended, 0)
  assert.deepEqual(getSession(), first)
  assert.deepEqual(await loadSession(), first)
  assert.deepEqual(await dbKeys("objects"), ["own:0:"])
  assert.equal((await (await getSigner()).signEvent(template())).pubkey, first.pubkey)
  // Told what it means, the person may replace it.
  const session = await connectExternal("nip07", { pubkey: second }, { replace: true })
  assert.equal(session.pubkey, second)
  assert.deepEqual(await dbKeys("objects"), [])
})

test("a sign-in request started as a guest does not survive a profile signing in", async () => {
  // An Android signer was asked for its key; before it answers, a local profile is created.
  await dbPut("pending", { id: "signer:request-1" })
  await startLocalProfile()
  assert.deepEqual(await dbKeys("pending"), [])
})

test("signing in again with the same profile keeps its data", async () => {
  const core = await loadCore()
  const secret = core.generateSecretKey()
  await importLocalKey(secret)
  await dbPut("objects", { id: "own:0:" })
  await importLocalKey(secret)
  assert.deepEqual(await dbKeys("objects"), ["own:0:"])
})

test("a signer app session keeps its connection key sealed and uses the live connection", async () => {
  const core = await loadCore()
  const user = core.generateSecretKey()
  const client = core.generateSecretKey()
  const userPubkey = core.getPublicKey(user)
  const inner: Signer = { getPublicKey: async () => userPubkey, signEvent: async (t) => core.finalizeEvent({ ...t }, user) }
  let loggedOut = false
  const connection = {
    signer: inner,
    pubkey: userPubkey,
    session: { clientSecretKey: toHex(client), remoteSignerPubkey: "b".repeat(64), userPubkey, relays: ["wss://relay.example"] },
    remote: {
      close() {},
      async logout() {
        loggedOut = true
      },
    },
  } as unknown as Nip46Connection
  const session = await connectExternal("nip46", { connection })
  assert.equal(session.kind, "nip46")
  assert.equal(session.pubkey, userPubkey)
  assert.ok(!(await dump()).includes(toHex(client)), "the connection key must not be stored in the clear")
  assert.equal((await (await getSigner()).signEvent(template())).pubkey, userPubkey)
  await signOut({ keepLocalData: true })
  assert.ok(loggedOut, "the signer app hears that the connection ended")
})

test("an Android signer session can't decrypt, so private data is never asked for through the address", async () => {
  const core = await loadCore()
  const pubkey = core.getPublicKey(core.generateSecretKey())
  await connectExternal("nip55", { pubkey })
  const signer = await getSigner()
  assert.equal(await signer.getPublicKey(), pubkey)
  assert.equal(signer.nip44, undefined)
  assert.equal(signer.nip04, undefined)
})

test("an external session needs a real public key", async () => {
  await assert.rejects(connectExternal("nip07", { pubkey: "npub1xyz" }))
  assert.equal(await loadSession(), null)
})

test("a browser extension that now uses another account is never signed with", async () => {
  const core = await loadCore()
  const keys = [core.generateSecretKey(), core.generateSecretKey()]
  let account = 0
  // The extension as a page sees it (window.nostr); the person can switch its account any time.
  const extension = {
    getPublicKey: async () => core.getPublicKey(keys[account]),
    signEvent: async (t: Parameters<Signer["signEvent"]>[0]) => core.finalizeEvent({ ...t }, keys[account]),
  }
  const page = globalThis.window as unknown as { nostr?: unknown }
  page.nostr = extension
  try {
    const session = await connectExternal("nip07", { pubkey: core.getPublicKey(keys[0]) })
    assert.equal((await (await getSigner()).signEvent(template())).pubkey, session.pubkey)
    // Switched in the extension: nothing it signs now gets out under this profile.
    account = 1
    await assert.rejects((await getSigner()).signEvent(template()), { name: "SignerError", code: "mismatch" })
  } finally {
    delete page.nostr
  }
})
