// Finding 3: two tabs. Tab A, a guest, starts "Mit einer anderen App"; tab B creates a local
// profile meanwhile. Tab A's sign-in must not replace Bea without asking, and Abbrechen keeps her.
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BASE, OTHER, browser, check, done, idb, nak, scrollAll, shot, startBunker, tab, wait } from "./lib.mjs"

const secret = nak(["key", "generate"])
const home = mkdtempSync(join(tmpdir(), "nak-bunker-"))
const { bunker, uri } = await startBunker(spawn, secret, OTHER, home)

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "de-DE", serviceWorkers: "block" })
await ctx.addInitScript(() => localStorage.setItem("theme", "light"))
const a = await ctx.newPage()
const b = await ctx.newPage()
for (const p of [a, b]) {
  await p.goto(BASE)
  await wait(p, 1200)
  await tab(p, "Profil")
  await wait(p, 900)
}
await a.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await wait(a, 600)
await a.getByRole("button", { name: /Mit einer anderen App/ }).click()
await wait(a, 900)
await a.getByRole("button", { name: /Signer-App/ }).click()
await wait(a, 1200)
await b.getByRole("button", { name: "Profil anlegen" }).click()
await wait(b, 900)
await b.getByLabel("Anzeigename").fill("Bea")
await b.getByRole("button", { name: "Profil anlegen" }).click()
await wait(b, 2500)
const local = (await idb(b, "kv", "profile.session"))?.value
check("tab B: local profile exists", local?.kind === "local", local?.pubkey?.slice(0, 8))
await a.getByLabel("Oder Verbindungslink einfügen").fill(uri)
await a.getByRole("button", { name: "Öffnen" }).click()
await a.getByText("Bist du das?").waitFor({ timeout: 20000 })
await wait(a, 1200)
await a.getByRole("button", { name: "Ja, das bin ich" }).click()
await wait(a, 2000)
await shot(a, "32-replace-dialog")
const dialog = a.getByRole("alertdialog")
check("a dialog says that Bea will be signed out on this device", (await dialog.getByText(/Damit wird „Bea“ auf diesem Gerät abgemeldet/).count()) === 1)
check("it warns that a key kept only here is lost", (await dialog.getByText(/Ohne Sicherung oder zweites Gerät/).count()) === 1)
await dialog.getByRole("button", { name: "Abbrechen" }).click()
await wait(a, 2000)
const kept = (await idb(a, "kv", "profile.session"))?.value
check("Abbrechen keeps Bea's profile and key", kept?.pubkey === local?.pubkey && kept?.kind === "local" && !!kept?.secret, `${kept?.kind} ${kept?.pubkey?.slice(0, 8)}`)
await shot(a, "33-tabA-after-cancel")
check("tab A is back at the sign-in choice, not signed in as someone else", (await a.getByText("Bist du das?").count()) === 0)
await wait(b, 1000)
await shot(b, "34-tabB-still-bea")
check("tab B still shows Bea", (await b.locator('[data-tab-panel="profile"]').getByText("Bea").count()) >= 1)

// Signing in again (a fresh bunker: nak's link is not reused here) and confirming the
// replacement switches, deliberately.
const second = await startBunker(spawn, nak(["key", "generate"]), OTHER, mkdtempSync(join(tmpdir(), "nak-bunker-")))
await a.getByLabel("Oder Verbindungslink einfügen").fill(second.uri)
await a.getByRole("button", { name: "Öffnen" }).click()
await a.getByText("Bist du das?").waitFor({ timeout: 20000 })
await wait(a, 1000)
await a.getByRole("button", { name: "Ja, das bin ich" }).click()
await wait(a, 1500)
await a.getByRole("alertdialog").getByRole("button", { name: "Abmelden und wechseln" }).click()
await wait(a, 3500)
const after = (await idb(a, "kv", "profile.session"))?.value
check("confirmed: the signer app profile is signed in", after?.kind === "nip46" && after?.pubkey !== local?.pubkey, `${after?.kind}`)
await tab(b, "Profil")
await wait(b, 1500)
await shot(b, "35-tabB-after-switch")
const players = await idb(b, "players")
check("no player named after the replaced profile was created for the new one", !players.some((p) => p.name === "Bea" && p.pubkey === after?.pubkey), JSON.stringify(players.map((p) => [p.name, p.pubkey?.slice(0, 8) ?? null])))

// Sign-out dialog: Abbrechen preferred, both ways out red.
await tab(a, "Profil")
await wait(a, 800)
await scrollAll(a)
await wait(a, 400)
await a.getByRole("button", { name: "Abmelden" }).click()
await wait(a, 800)
await shot(a, "36-signout-dialog")
const styles = await a.evaluate(() => {
  const dialog = document.querySelector("[role=alertdialog]")
  return [...dialog.querySelectorAll("button")].map((b) => ({ text: b.textContent.trim(), color: getComputedStyle(b).color, background: getComputedStyle(b).backgroundColor }))
})
console.log(JSON.stringify(styles))
const keep = styles.find((s) => s.text.startsWith("Abmelden, Spiele"))
const cancel = styles.find((s) => s.text === "Abbrechen")
check("sign-out choices are not the filled blue button; Abbrechen is", keep && cancel && keep.background !== cancel.background && keep.color !== cancel.color)
await a.getByRole("button", { name: "Abmelden, Spiele behalten" }).click()
await wait(a, 2500)
await tab(b, "Profil")
await wait(b, 1500)
check("tab B shows the guest view after sign-out in tab A", (await b.getByRole("button", { name: "Ich habe schon ein Profil" }).count()) === 1)
await ctx.close()
bunker.kill("SIGTERM")
second.bunker.kill("SIGTERM")
await done()
