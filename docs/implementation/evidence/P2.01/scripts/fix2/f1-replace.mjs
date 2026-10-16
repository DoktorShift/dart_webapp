// Review round 2, finding 1 (high): confirming "Abmelden und wechseln" must run the replacement,
// not the decline path. Tab B creates a local profile (Bea); tab A signs in with a bunker link
// and confirms the replacement: it reaches the claim step, and the signer app then signs an edit
// (kind 0 on the relay, signed by the bunker's key). Then the same with "Profil anlegen" in tab
// A: the form is gone, the Profile tab shows the new profile, and only one profile was created.
//   RELAY_PORTS=20000,20001,20002 BASE=http://localhost:3311 node docs/implementation/evidence/P2.01/scripts/fix2/f1-replace.mjs
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BASE, RELAYS, browser, check, done, idb, nak, req, shot, startBunker, tab, wait } from "../fix1/lib.mjs"

const secret = nak(["key", "generate"])
const pubkey = nak(["key", "public", secret])
const { bunker, uri } = await startBunker(spawn, secret, RELAYS[0], mkdtempSync(join(tmpdir(), "nak-bunker-")))

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

async function createBea() {
  await b.getByRole("button", { name: "Profil anlegen" }).click()
  await wait(b, 900)
  await b.getByLabel("Anzeigename").fill("Bea")
  await b.getByRole("button", { name: "Profil anlegen" }).click()
  await wait(b, 2500)
  return (await idb(b, "kv", "profile.session"))?.value
}

// --- Link variant --------------------------------------------------------------------------
await a.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await wait(a, 600)
await a.getByRole("button", { name: /Mit einer anderen App/ }).click()
await wait(a, 900)
await a.getByRole("button", { name: /Signer-App/ }).click()
await wait(a, 1200)
const bea = await createBea()
check("tab B: Bea's local profile exists", bea?.kind === "local", bea?.pubkey?.slice(0, 8))
await a.getByLabel("Oder Verbindungslink einfügen").fill(uri)
await a.getByRole("button", { name: "Öffnen" }).click()
await a.getByText("Bist du das?").waitFor({ timeout: 20000 })
await wait(a, 1000)
await a.getByRole("button", { name: "Ja, das bin ich" }).click()
await a.getByRole("alertdialog").waitFor({ timeout: 10000 })
await wait(a, 400)
await a.getByRole("alertdialog").getByRole("button", { name: "Abmelden und wechseln" }).click()
await wait(a, 3000)
await shot(a, "f1-after-confirm-link")
const after = (await idb(a, "kv", "profile.session"))?.value
check("confirmed: the signer app profile is signed in", after?.kind === "nip46" && after?.pubkey === pubkey, `${after?.kind}`)
check("tab A left the code/paste step (no connection link field, no dialog)", (await a.getByLabel("Oder Verbindungslink einfügen").count()) === 0 && (await a.getByRole("alertdialog").count()) === 0)
const onRoot = (await a.locator('[data-tab-panel="profile"]').getByRole("button", { name: "Bearbeiten" }).count()) === 1
const onClaim = (await a.getByText("Gehören dir Spiele auf diesem Gerät?").count()) === 1
check("tab A is at the claim step or the profile root", onRoot || onClaim, onRoot ? "root" : onClaim ? "claim" : "neither")
if (onClaim) {
  await a.getByRole("button", { name: "Später" }).click()
  await wait(a, 1200)
}
// A signature by the signer app now works: the connection the commit kept was not dropped.
await a.getByRole("button", { name: "Bearbeiten" }).click()
await wait(a, 1500)
await a.getByLabel("Anzeigename").fill("Lena")
const save = a.getByRole("button", { name: "Speichern" })
await save.waitFor({ state: "visible" })
await a.waitForFunction(() => !document.querySelector('button[disabled]')?.textContent?.includes("Speichern"), null, { timeout: 15000 }).catch(() => {})
const t0 = Date.now()
await save.click()
await save.waitFor({ state: "detached", timeout: 20000 }).catch(() => {})
const took = Date.now() - t0
const notReachable = (await a.getByText(/nicht erreichbar/).count()) > 0
const signed = req(["-k", "0", "-a", pubkey], [RELAYS[0]])
check("the edit was signed by the signer app and reached the relay", !notReachable && signed.some((e) => e.pubkey === pubkey && JSON.parse(e.content).name === "Lena"), `${took} ms, ${signed.length} kind 0 (lab value)`)
await shot(a, "f1-after-edit-link")
await wait(b, 800)
check("tab B follows the switch (Bea is gone)", (await idb(b, "kv", "profile.session"))?.value?.pubkey === pubkey)

// --- Create variant ------------------------------------------------------------------------
// Tab A signs out again, fills "Profil anlegen" while tab B recreates Bea, then confirms.
await a.locator('[data-tab-panel="profile"]').getByRole("button", { name: "Abmelden" }).scrollIntoViewIfNeeded()
await a.locator('[data-tab-panel="profile"]').getByRole("button", { name: "Abmelden" }).click()
await wait(a, 600)
await a.getByRole("alertdialog").getByRole("button", { name: "Abmelden, Spiele behalten" }).click()
await wait(a, 2500)
await tab(b, "Profil")
await wait(b, 800)
await a.getByRole("button", { name: "Profil anlegen" }).click()
await wait(a, 900)
await a.getByLabel("Anzeigename").fill("Carl")
const bea2 = await createBea()
check("tab B: Bea again", bea2?.kind === "local" && bea2?.pubkey !== pubkey, bea2?.pubkey?.slice(0, 8))
await a.getByRole("button", { name: "Profil anlegen" }).click()
await a.getByRole("alertdialog").waitFor({ timeout: 10000 })
await wait(a, 400)
check("the dialog names Bea", (await a.getByRole("alertdialog").getByText(/„Bea“/).count()) === 1)
await a.getByRole("alertdialog").getByRole("button", { name: "Abmelden und wechseln" }).click()
await wait(a, 3000)
await shot(a, "f1-after-confirm-create")
const carl = (await idb(a, "kv", "profile.session"))?.value
check("Carl's profile is signed in", carl?.kind === "local" && carl?.pubkey !== bea2?.pubkey, carl?.pubkey?.slice(0, 8))
check("the form is gone and the Profile tab shows Carl", (await a.getByLabel("Anzeigename").count()) === 0 && (await a.locator('[data-tab-panel="profile"]').getByText("Carl").count()) >= 1)
// One createProfile ran: one player of Carl's. Bea's players stay, as every player on the device
// does when a profile leaves ("Die Spiele auf diesem Gerät bleiben").
const players = await idb(a, "players")
check("exactly one player belongs to Carl", players.filter((p) => p.pubkey === carl?.pubkey).length === 1 && players.filter((p) => p.name === "Carl").length === 1, JSON.stringify(players.map((p) => [p.name, p.pubkey?.slice(0, 6) ?? null])))
check("no console errors", errors.length === 0, errors.join(" | ").slice(0, 300))

bunker.kill()
await ctx.close()
await done()
