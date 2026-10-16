import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js"
import { resetStorage } from "./storage-helpers.ts"
import { createLocalSigner } from "../lib/nostr/signers.ts"
import { OWN, ownEvents, rememberOwn } from "../lib/profile/own-events.ts"
import { newRelayList, relayListTemplate } from "../lib/profile/relay-list.ts"
import { getSession, getSigner, SessionError, signOut, startLocalProfile } from "../lib/profile/session.ts"
import { applyProfilePackage, buildProfilePackage, PackageError, parseProfilePackage, type ProfilePackage } from "../lib/recovery/package.ts"
import { createDataKey, keepDataKey, storedDataKey } from "../lib/sync/data-key.ts"

// The profile package (P2.03, P2.04): what a profile takes to another device, built on the one
// that has it and applied on the other. One database stands in for both devices here, reset
// in between.

beforeEach(async () => {
  await signOut({ keepLocalData: true })
  await resetStorage()
})

async function profileWithEverything() {
  const session = await startLocalProfile()
  const signer = await getSigner()
  const dataKey = await createDataKey(signer)
  await keepDataKey(session.pubkey, dataKey)
  await rememberOwn(session.pubkey, [await signer.signEvent(relayListTemplate(newRelayList()))])
  return { session, dataKey }
}

test("the package carries the key, the data key and the relay list; applied elsewhere, the profile is signed in with all of it", async () => {
  const { session, dataKey } = await profileWithEverything()
  const pkg = await buildProfilePackage()
  assert.equal(pkg.pubkey, session.pubkey)
  assert.equal(pkg.access.kind, "local")
  assert.equal(pkg.dataKey?.key, bytesToHex(dataKey.key))
  assert.equal(pkg.events.length, 1)
  // What arrived as JSON is checked before it is used.
  const parsed = parseProfilePackage(JSON.parse(JSON.stringify(pkg)))
  assert.deepEqual(parsed, pkg)

  // The other device: a guest until now.
  await signOut({ keepLocalData: true })
  await resetStorage()
  const applied = await applyProfilePackage(parsed)
  assert.equal(applied.access, "local")
  assert.equal(getSession()?.pubkey, session.pubkey)
  assert.equal(getSession()?.kind, "local")
  assert.equal(getSession()?.madeHere, undefined)
  assert.equal(bytesToHex((await storedDataKey(session.pubkey))!.key), bytesToHex(dataKey.key))
  assert.ok((await ownEvents(session.pubkey)).get(OWN.relayList))
  assert.equal(await (await getSigner()).getPublicKey(), session.pubkey)
})

test("a package for a profile in a signer app carries no key: the data key and events are kept, the signer is connected next", async () => {
  const secret = randomBytes(32)
  const signer = await createLocalSigner(secret)
  const pubkey = await signer.getPublicKey()
  const dataKey = await createDataKey(signer)
  const pkg: ProfilePackage = { v: 1, pubkey, access: { kind: "nip46" }, dataKey: { key: bytesToHex(dataKey.key), created: dataKey.created, event: dataKey.event }, events: [] }
  const applied = await applyProfilePackage(parseProfilePackage(pkg))
  assert.deepEqual(applied, { access: "signer", pubkey, kind: "nip46" })
  assert.equal(getSession(), null)
  assert.equal(bytesToHex((await storedDataKey(pubkey))!.key), bytesToHex(dataKey.key))
  assert.throws(() => parseProfilePackage({ ...pkg, access: { kind: "nip46", key: "ab".repeat(32) } }), /no key/)
})

test("a signer profile's package goes through the same sign-in guard: refused while another profile is signed in, taken with replace", async () => {
  const { session: other, dataKey: othersKey } = await profileWithEverything()
  const signer = await createLocalSigner(randomBytes(32))
  const pubkey = await signer.getPublicKey()
  const dataKey = await createDataKey(signer)
  const pkg: ProfilePackage = { v: 1, pubkey, access: { kind: "nip46" }, dataKey: { key: bytesToHex(dataKey.key), created: dataKey.created, event: dataKey.event }, events: [] }

  await assert.rejects(applyProfilePackage(pkg), (e: unknown) => e instanceof SessionError && e.code === "occupied" && e.session.pubkey === other.pubkey)
  // Nothing of the signed-in profile was touched.
  assert.equal(getSession()?.pubkey, other.pubkey)
  assert.equal(bytesToHex((await storedDataKey(other.pubkey))!.key), bytesToHex(othersKey.key))

  assert.deepEqual(await applyProfilePackage(pkg, { replace: true }), { access: "signer", pubkey, kind: "nip46" })
  assert.equal(getSession(), null)
  assert.equal(bytesToHex((await storedDataKey(pubkey))!.key), bytesToHex(dataKey.key))
})

test("a key that isn't the package's profile, a forged event and a malformed package are refused", async () => {
  const { session } = await profileWithEverything()
  const pkg = await buildProfilePackage()
  await signOut({ keepLocalData: true })
  await resetStorage()

  const other = bytesToHex(randomBytes(32))
  await assert.rejects(applyProfilePackage({ ...pkg, access: { kind: "local", key: other } }), (e: unknown) => e instanceof PackageError && e.code === "mismatch")
  assert.equal(getSession(), null)

  for (const bad of [null, { v: 2 }, { ...pkg, pubkey: "xyz" }, { ...pkg, access: { kind: "magic" } }, { ...pkg, events: "none" }, { ...pkg, dataKey: { key: "00" } }]) {
    assert.throws(() => parseProfilePackage(bad), (e: unknown) => e instanceof PackageError && e.code === "malformed")
  }

  // An event whose signature doesn't hold is dropped; the rest is kept.
  const forged = { ...pkg.events[0], content: '{"changed":true}' }
  await applyProfilePackage({ ...pkg, events: [forged] })
  assert.equal(getSession()?.pubkey, session.pubkey)
  assert.equal((await ownEvents(session.pubkey)).get(OWN.relayList), undefined)
})
