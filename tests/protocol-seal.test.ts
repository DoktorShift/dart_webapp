import { test } from "node:test"
import assert from "node:assert/strict"
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from "nostr-core"
import { invitePreview, previewKey, readInvitePreview } from "../lib/protocol/invite.ts"
import { buildRecord, parseRecord, sealRecord } from "../lib/protocol/records.ts"
import { ProtocolError } from "../lib/protocol/reasons.ts"
import { contentKeyText, MAX_SEAL_READERS, newContentKey, newSealNonce, openEnvelope, openSealedEvents, parseEnvelope, wrapHint, wrapsFor } from "../lib/protocol/seal.ts"

// Sealed records of closed clubs: one content key per record, wrapped with real NIP-44 (nostr-core)
// for each reader, as lib/clubs will do it with a signer.

const NOW = 1760000000
const CLUB = "a".repeat(64)
const person = () => {
  const secret = generateSecretKey()
  return { secret, pubkey: getPublicKey(secret) }
}
const owner = person()
const alice = person()
const bob = person()
const mallory = person()

const nip44To = (from: Uint8Array, to: string, text: string) => nip44.encrypt(text, nip44.getConversationKey(from, to))
const unwrapper = (secret: Uint8Array) => async (author: string, payload: string) => nip44.decrypt(payload, nip44.getConversationKey(secret, author))

function sealedEvent(author: ReturnType<typeof person>, type: Parameters<typeof buildRecord>[0], content: unknown, readers: string[], extra: { preview?: Parameters<typeof sealRecord>[1]["preview"]; at?: number } = {}) {
  const template = buildRecord(type, content as never, { created_at: extra.at ?? NOW, root: CLUB })
  const key = newContentKey()
  const wraps = readers.map((reader) => ({ reader, payload: nip44To(author.secret, reader, contentKeyText(key)) }))
  const event = finalizeEvent(sealRecord(template, { key, nonce: newSealNonce(), wraps, ...(extra.preview ? { preview: extra.preview } : {}) }), author.secret)
  return { event, key, plaintext: template.content }
}

test("each reader opens a sealed record with their own key; others cannot", async () => {
  const season = sealedEvent(owner, "club.season.end", { season: "e".repeat(32) }, [owner.pubkey, alice.pubkey])
  for (const reader of [owner, alice]) {
    const opened = await openSealedEvents([season.event], { reader: reader.pubkey, unwrap: unwrapper(reader.secret) })
    assert.equal(opened.plaintexts.get(season.event.id), season.plaintext)
    assert.equal(opened.keys.get(season.event.id), contentKeyText(season.key))
  }
  // Mallory is not wrapped for; trying Alice's hint with Mallory's key fails too.
  const none = await openSealedEvents([season.event], { reader: mallory.pubkey, unwrap: unwrapper(mallory.secret) })
  assert.equal(none.plaintexts.size, 0)
  const stolen = await openSealedEvents([season.event], { reader: alice.pubkey, unwrap: unwrapper(mallory.secret) })
  assert.equal(stolen.plaintexts.size, 0)
})

test("the envelope names no reader: hints depend on the record's nonce", () => {
  const a = sealedEvent(owner, "club.season.end", { season: "e".repeat(32) }, [alice.pubkey, bob.pubkey])
  const b = sealedEvent(owner, "club.season.end", { season: "e".repeat(32) }, [alice.pubkey, bob.pubkey])
  const ea = parseEnvelope(a.event.content)
  const eb = parseEnvelope(b.event.content)
  assert.ok(!a.event.content.includes(alice.pubkey) && !a.event.content.includes(bob.pubkey))
  assert.notDeepEqual(
    ea.wraps.map((w) => w.hint),
    eb.wraps.map((w) => w.hint),
  )
  assert.equal(wrapsFor(ea, alice.pubkey).length, 1)
  assert.equal(wrapsFor(ea, mallory.pubkey).length, 0)
  assert.equal(wrapHint(ea.nonce, alice.pubkey), ea.wraps.find((w) => wrapsFor(ea, alice.pubkey).includes(w.payload))?.hint)
})

test("a content key opens only its own record and type", () => {
  const one = sealedEvent(owner, "club.season.end", { season: "e".repeat(32) }, [owner.pubkey])
  const env = parseEnvelope(one.event.content)
  assert.equal(openEnvelope(env, "club.season.end", one.key), one.plaintext)
  // Moved under another label, or opened with another key: nothing.
  assert.equal(openEnvelope(env, "club.season", one.key), null)
  assert.equal(openEnvelope(env, "club.season.end", newContentKey()), null)
  const tampered = { ...env, ciphertext: env.ciphertext.map((x, i) => (i === 0 ? x ^ 1 : x)) }
  assert.equal(openEnvelope(tampered, "club.season.end", one.key), null)
})

test("a new member reads earlier records through a key share, and only then", async () => {
  // Before Bob joined: a season wrapped for owner and Alice only.
  const season = sealedEvent(owner, "club.season.end", { season: "e".repeat(32) }, [owner.pubkey, alice.pubkey], { at: NOW })
  const date = sealedEvent(owner, "club.date", { date: "d".repeat(32), title: "Clubabend", starts: NOW + 86400, prev: CLUB }, [owner.pubkey, alice.pubkey], { at: NOW + 1 })
  const before = await openSealedEvents([season.event, date.event], { reader: bob.pubkey, unwrap: unwrapper(bob.secret) })
  assert.equal(before.plaintexts.size, 0)
  // The owner shares both keys with everyone now in the club, Bob included.
  const share = sealedEvent(
    owner,
    "club.keys",
    {
      keys: [
        [season.event.id, contentKeyText(season.key)],
        [date.event.id, contentKeyText(date.key)],
      ],
    },
    [owner.pubkey, alice.pubkey, bob.pubkey],
    { at: NOW + 2 },
  )
  const after = await openSealedEvents([date.event, share.event, season.event], { reader: bob.pubkey, unwrap: unwrapper(bob.secret) })
  assert.equal(after.plaintexts.get(season.event.id), season.plaintext)
  assert.equal(after.plaintexts.get(date.event.id), date.plaintext)
  // A cached key opens without asking the signer again.
  let asked = 0
  const cached = await openSealedEvents([season.event], {
    reader: bob.pubkey,
    unwrap: async () => {
      asked++
      return null
    },
    known: after.keys,
  })
  assert.equal(cached.plaintexts.get(season.event.id), season.plaintext)
  assert.equal(asked, 0)
  // A wrong shared key opens nothing (and breaks nothing).
  const bogus = sealedEvent(owner, "club.keys", { keys: [[season.event.id, "0".repeat(64)]] }, [mallory.pubkey], { at: NOW + 3 })
  const fooled = await openSealedEvents([season.event, bogus.event], { reader: mallory.pubkey, unwrap: unwrapper(mallory.secret) })
  assert.equal(fooled.plaintexts.has(season.event.id), false)
})

test("a removed member is simply no longer wrapped for", async () => {
  const early = sealedEvent(owner, "club.season.end", { season: "e".repeat(32) }, [owner.pubkey, alice.pubkey])
  const late = sealedEvent(owner, "club.season.end", { season: "f".repeat(32) }, [owner.pubkey])
  const opened = await openSealedEvents([early.event, late.event], { reader: alice.pubkey, unwrap: unwrapper(alice.secret) })
  assert.deepEqual([...opened.plaintexts.keys()], [early.event.id])
})

test("the invite link's token opens the preview; members open the invite itself", async () => {
  const token = "0f".repeat(16)
  const preview = { name: "Dartfreunde Nord", about: "Dienstags ab 19 Uhr", host: owner.pubkey, hostName: "Mia", kind: "personal" as const, expires: NOW + 86400, next: { title: "Clubabend", starts: NOW + 3600 } }
  const invite = sealedEvent(owner, "club.invite", { kind: "personal", token, expires: NOW + 86400 }, [owner.pubkey, alice.pubkey], {
    preview: { key: previewKey(token), nonce: newSealNonce(), content: preview },
  })
  const env = parseEnvelope(invite.event.content)
  assert.deepEqual(readInvitePreview(env, token), invitePreview.check(preview, ""))
  assert.throws(() => readInvitePreview(env, "1f".repeat(16)), (e: unknown) => e instanceof ProtocolError && e.reason === "invite_proof_invalid")
  // The token itself never stands in the event.
  assert.ok(!invite.event.content.includes(token))
  const r = parseRecord(invite.event, { now: NOW })
  assert.equal(r.status, "sealed")
  const opened = await openSealedEvents([invite.event], { reader: alice.pubkey, unwrap: unwrapper(alice.secret) })
  assert.equal(JSON.parse(opened.plaintexts.get(invite.event.id) as string).token, token)
})

test("a hundred members fit into one sealed record", () => {
  const readers = Array.from({ length: MAX_SEAL_READERS }, () => person().pubkey)
  const big = sealedEvent(owner, "club.season.end", { season: "e".repeat(32) }, readers)
  assert.ok(JSON.stringify(big.event).length <= 32 * 1024, `${JSON.stringify(big.event).length} bytes`)
})
