import { test } from "node:test"
import assert from "node:assert/strict"
import { nip05Label, verifyNip05 } from "../lib/nostr/ext/nip05.ts"

// NIP-05 from the browser: an address counts only when its domain names exactly this key, asked
// without following redirects (NIP-05) and without telling the domain which page asks.

const KEY = "a".repeat(64)

function fakeFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const run = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return answer(String(input), init ?? {})
  }) as typeof fetch
  return { run, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

test("an address that names this key counts, asked the careful way", async () => {
  const { run, calls } = fakeFetch(() => json({ names: { lena: KEY } }))
  assert.equal(await verifyNip05("Lena@Example.com", KEY, { fetch: run }), true)
  assert.equal(calls[0].url, "https://example.com/.well-known/nostr.json?name=lena")
  assert.equal(calls[0].init.redirect, "error")
  assert.equal(calls[0].init.referrerPolicy, "no-referrer")
  assert.equal(calls[0].init.credentials, "omit")
})

test("another key, a missing name, an error or a broken answer never count", async () => {
  for (const answer of [() => json({ names: { lena: "b".repeat(64) } }), () => json({ names: {} }), () => json({}, 404), () => new Response("<html>"), () => Promise.reject(new TypeError("redirect"))]) {
    assert.equal(await verifyNip05("lena@example.com", KEY, { fetch: fakeFetch(answer).run }), false)
  }
})

test("addresses that aren't one are refused before anything is asked", async () => {
  const { run, calls } = fakeFetch(() => json({ names: { lena: KEY } }))
  for (const address of ["lena", "lena@localhost", "lena@127.0.0.1", "le na@example.com", "lena@exa mple.com", "lena@example.com/../x"]) {
    assert.equal(await verifyNip05(address, KEY, { fetch: run }), false, address)
  }
  assert.equal(calls.length, 0)
})

test("the domain's own name reads as the domain", () => {
  assert.equal(nip05Label("_@example.com"), "example.com")
  assert.equal(nip05Label("lena@example.com"), "lena@example.com")
})
