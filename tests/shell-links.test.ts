import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_PAYLOAD_LENGTH, buildLink, containsSecretKey, isAnswerLink, parseAppLink, parseHash } from "../lib/shell/links.ts"

// Expected values follow the link format in docs/decisions/0002 §9 and the task card P0.02:
// "#<kind>=<payload>", payload opaque, only on the app's own start page.

const SITE = "https://blueline21.netlify.app"

test("every link kind is read from the page address", () => {
  assert.deepEqual(parseHash("#p=npub1abc"), { kind: "p", payload: "npub1abc" })
  assert.deepEqual(parseHash("#watch=m1"), { kind: "watch", payload: "m1" })
  assert.deepEqual(parseHash("#club=c1"), { kind: "club", payload: "c1" })
  assert.deepEqual(parseHash("#tournament=t1"), { kind: "tournament", payload: "t1" })
  assert.deepEqual(parseHash("#pair=k.s.1700000000.r"), { kind: "pair", payload: "k.s.1700000000.r" })
  assert.deepEqual(parseHash("#board=b1"), { kind: "board", payload: "b1" })
  assert.deepEqual(parseHash("#handoff=H1.x"), { kind: "handoff", payload: "H1.x" })
})

test("the payload is everything after the first '=' and stays as it is", () => {
  assert.deepEqual(parseHash("#club=id&k=secret=="), { kind: "club", payload: "id&k=secret==" })
  assert.deepEqual(parseHash("#p=a%20b"), { kind: "p", payload: "a%20b" })
})

test("fragments that are not links are ignored", () => {
  for (const hash of ["", "#", "#club", "#club=", "#=abc", "#install", "#unknown=1", "#Club=1", "#club=a b", "#club=a\nb", "#club=\u0007"]) {
    assert.equal(parseHash(hash), null, JSON.stringify(hash))
  }
})

test("payloads have an upper length", () => {
  assert.equal(parseHash(`#club=${"a".repeat(MAX_PAYLOAD_LENGTH)}`)?.payload.length, MAX_PAYLOAD_LENGTH)
  assert.equal(parseHash(`#club=${"a".repeat(MAX_PAYLOAD_LENGTH + 1)}`), null)
})

test("a signer answer may be empty and is passed on without the '='", () => {
  assert.deepEqual(parseHash("#signer-return"), { kind: "signer-return", payload: "" })
  assert.deepEqual(parseHash("#signer-return="), { kind: "signer-return", payload: "" })
  assert.deepEqual(parseHash("#signer-return=Signer1H4sI"), { kind: "signer-return", payload: "Signer1H4sI" })
  assert.deepEqual(parseHash("#signer-return?event=abc"), { kind: "signer-return", payload: "?event=abc" })
  assert.equal(parseHash("#signer-returned=1"), null)
})

test("a wallet app's answer arrives the same way", () => {
  assert.deepEqual(parseHash("#wallet-return"), { kind: "wallet-return", payload: "" })
  assert.deepEqual(parseHash("#wallet-return?value=nostr%2Bwalletconnect"), { kind: "wallet-return", payload: "?value=nostr%2Bwalletconnect" })
  assert.equal(parseHash("#wallet-returned"), null)
})

test("answers of other apps open no screen of their own; every other link does", () => {
  assert.equal(isAnswerLink("signer-return"), true)
  assert.equal(isAnswerLink("wallet-return"), true)
  for (const kind of ["p", "watch", "club", "tournament", "pair", "board"] as const) assert.equal(isAnswerLink(kind), false, kind)
})

test("scanned or pasted links count only for this app's start page", () => {
  const origins = [SITE]
  assert.deepEqual(parseAppLink(`${SITE}/#club=c1`, origins), { kind: "club", payload: "c1" })
  assert.deepEqual(parseAppLink(`  ${SITE}/#club=c1 \n`, origins), { kind: "club", payload: "c1" })
  assert.deepEqual(parseAppLink("blueline21.netlify.app/#club=c1", origins), { kind: "club", payload: "c1" })
  assert.deepEqual(parseAppLink(`${SITE}/?ref=x#tournament=t1`, origins), { kind: "tournament", payload: "t1" })
  assert.deepEqual(parseAppLink("#watch=m1", origins), { kind: "watch", payload: "m1" })
  assert.deepEqual(parseAppLink("http://localhost:3203/#club=c1", ["http://localhost:3203/", SITE]), { kind: "club", payload: "c1" })

  assert.equal(parseAppLink("https://example.com/#club=c1", origins), null, "other site")
  assert.equal(parseAppLink("http://blueline21.netlify.app/#club=c1", origins), null, "other scheme is another origin")
  assert.equal(parseAppLink(`${SITE}/about#club=c1`, origins), null, "other page")
  assert.equal(parseAppLink(`${SITE}/`, origins), null, "no fragment")
  assert.equal(parseAppLink(`${SITE}/#install`, origins), null, "fragment that is no link")
  assert.equal(parseAppLink("javascript:alert(1)//#club=c1", origins), null)
  assert.equal(parseAppLink("nostr:npub1abc", origins), null)
  assert.equal(parseAppLink("BLAU-24", origins), null)
  assert.equal(parseAppLink("", origins), null)
})

test("links are built on the site's origin and read back unchanged", () => {
  assert.equal(buildLink(SITE, "club", "c1"), `${SITE}/#club=c1`)
  assert.equal(buildLink(`${SITE}/about`, "p", "npub1abc"), `${SITE}/#p=npub1abc`)
  assert.equal(buildLink(SITE, "signer-return", ""), `${SITE}/#signer-return=`)
  for (const [kind, payload] of [["tournament", "t1&k=z"], ["pair", "a.b.c"], ["board", "b1"]] as const) {
    assert.deepEqual(parseAppLink(buildLink(SITE, kind, payload), [SITE]), { kind, payload })
  }
  assert.throws(() => buildLink(SITE, "club", ""))
  assert.throws(() => buildLink(SITE, "club", "a b"))
  assert.throws(() => buildLink("not a url", "club", "c1"))
})

test("a profile's secret key is recognised wherever it is pasted, and nothing else is taken for one", () => {
  const nsec = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5"
  for (const text of [nsec, ` ${nsec} `, `nostr:${nsec}`, `Hier mein Code: ${nsec.toUpperCase()}`]) assert.equal(containsSecretKey(text), true, text)
  for (const text of ["npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m", "Anna", "nsec", "nsec1abc", "https://blueline21.netlify.app/#p=U1.abc"]) {
    assert.equal(containsSecretKey(text), false, text)
  }
})
