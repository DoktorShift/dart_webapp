// Review round 2, low finding (connect-screen.tsx:261): after a signer app answered the code,
// "Ja, das bin ich" and Abbrechen on the replacement dialog, a fresh code must show, and a signer
// answering it must be heard. Two "nak bunker" daemons play the signer apps ("nak bunker connect"
// tells a running daemon to answer a nostrconnect code).
//   RELAY_PORTS=20000,20001,20002 BASE=http://localhost:3311 node docs/implementation/evidence/P2.01/scripts/fix2/f2-code.mjs
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BASE, NAK, RELAYS, browser, check, done, idb, nak, shot, startBunker, tab, wait } from "../fix1/lib.mjs"

// A signer app: a bunker daemon of its own, told to answer a code.
async function signerApp() {
  const home = mkdtempSync(join(tmpdir(), "nak-bunker-"))
  const { bunker } = await startBunker(spawn, nak(["key", "generate"]), RELAYS[0], home)
  return {
    answer: (code) => spawn(NAK, ["bunker", "connect", code], { env: { ...process.env, HOME: home }, stdio: ["ignore", "ignore", "ignore"] }),
    stop: () => bunker.kill(),
  }
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "de-DE", serviceWorkers: "block" })
await ctx.addInitScript(() => localStorage.setItem("theme", "light"))
const a = await ctx.newPage()
const b = await ctx.newPage()
const errors = []
a.on("pageerror", (e) => errors.push(String(e)))
a.on("console", (m) => m.type() === "error" && errors.push(m.text()))
for (const p of [a, b]) {
  await p.goto(BASE)
  await wait(p, 1200)
  await tab(p, "Profil")
  await wait(p, 900)
}

// Tab A shows a code; tab B creates Bea meanwhile, so tab A's sign-in has to ask.
await a.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await wait(a, 600)
await a.getByRole("button", { name: /Mit einer anderen App/ }).click()
await wait(a, 900)
await a.getByRole("button", { name: /Signer-App/ }).click()
const codeLink = a.getByRole("link", { name: "In der Signer-App auf diesem Gerät öffnen" })
await codeLink.waitFor({ timeout: 15000 })
const code1 = await codeLink.getAttribute("href")
check("a nostrconnect code is shown", code1?.startsWith("nostrconnect://"))
await b.getByRole("button", { name: "Profil anlegen" }).click()
await wait(b, 900)
await b.getByLabel("Anzeigename").fill("Bea")
await b.getByRole("button", { name: "Profil anlegen" }).click()
await wait(b, 2500)
const bea = (await idb(b, "kv", "profile.session"))?.value
check("tab B: Bea's local profile exists", bea?.kind === "local")

const first = await signerApp()
first.answer(code1)
await a.getByText("Bist du das?").waitFor({ timeout: 30000 })
await wait(a, 800)
await a.getByRole("button", { name: "Ja, das bin ich" }).click()
await a.getByRole("alertdialog").waitFor({ timeout: 15000 })
await wait(a, 400)
await a.getByRole("alertdialog").getByRole("button", { name: "Abbrechen" }).click()
await wait(a, 2000)
await shot(a, "f2-code-after-cancel")
check("Bea stays signed in", (await idb(a, "kv", "profile.session"))?.value?.pubkey === bea?.pubkey)
const code2 = await codeLink.getAttribute("href").catch(() => null)
check("a fresh code replaced the answered one", code2?.startsWith("nostrconnect://") && code2 !== code1, `…${code1?.slice(-10)} -> …${code2?.slice(-10)}`)
first.stop()

// A signer answering the new code is heard.
const second = await signerApp()
second.answer(code2)
const asked = await a
  .getByText("Bist du das?")
  .waitFor({ timeout: 30000 })
  .then(() => true, () => false)
check("the new code is answered: 'Bist du das?' again", asked)
await shot(a, "f2-code-second-answer")
second.stop()
check("no console errors", errors.length === 0, errors.join(" | ").slice(0, 300))
await ctx.close()
await done()
