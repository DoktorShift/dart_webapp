// Review round 2, finding 4 (medium): a partial lookup is not "nothing found". The profile's
// relay list (kind 10002 on relay A) names relay C, where alone its kind 0 lives; C is down. Sign
// in with a bunker on A: the card says "Nicht geladen", Bearbeiten says the profile couldn't be
// loaded completely (Speichern stays off for a public change, the board name still saves),
// Erweitert names C as the relay without an answer and shows the list from A. With C back,
// "Erneut versuchen" finds the profile, and an edit keeps its foreign fields.
//   Run with nothing listening on the third port of RELAY_PORTS: the script starts relay C
//   itself for the second half and stops it at the end.
//   RELAY_PORTS=20000,20001,20002 BASE=http://localhost:3311 node docs/implementation/evidence/P2.01/scripts/fix2/f4-partial.mjs
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BASE, NAK, OTHER, RELAYS, check, done, idb, nak, open, req, scrollAll, shot, startBunker, tab, wait } from "../fix1/lib.mjs"

const secret = nak(["key", "generate"])
const pubkey = nak(["key", "public", secret])
const original = { name: "lena_s", display_name: "Lena aus Amber", about: "Darts!", lud16: "lena@wallet.example" }
// The relay list on A names C; the kind 0 goes to C once it runs (second half).
nak(["event", "-k", "10002", "-t", `r=${OTHER}`, "--sec", secret, RELAYS[0]])
const { bunker, uri } = await startBunker(spawn, secret, RELAYS[0], mkdtempSync(join(tmpdir(), "nak-bunker-")))

const { ctx, page, errors } = await open({ viewport: { width: 320, height: 548 } })
await page.goto(BASE)
await wait(page, 1200)
await tab(page, "Profil")
await wait(page, 900)
await page.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await wait(page, 600)
await page.getByRole("button", { name: /Mit einer anderen App/ }).click()
await wait(page, 900)
await page.getByRole("button", { name: /Signer-App/ }).click()
await wait(page, 1200)
await page.getByLabel("Oder Verbindungslink einfügen").fill(uri)
await page.getByRole("button", { name: "Öffnen" }).click()
await page.getByText("Bist du das?").waitFor({ timeout: 20000 })
await wait(page, 800)
await page.getByRole("button", { name: "Ja, das bin ich" }).click()
await wait(page, 3000)
await page.getByRole("button", { name: "Später" }).click().catch(() => {})
await wait(page, 9000)
await shot(page, "f4-root-incomplete")
const panel = page.locator('[data-tab-panel="profile"]')
check("the card says 'Nicht geladen', not 'Ohne Namen'", (await panel.getByText("Nicht geladen").count()) === 1 && (await panel.getByText("Ohne Namen").count()) === 0)

await page.getByRole("button", { name: "Bearbeiten" }).click()
await wait(page, 2000)
await shot(page, "f4-edit-incomplete")
check("the sheet says the profile couldn't be loaded completely, not 'nichts gefunden'", (await page.getByText(/nicht vollständig geladen/).count()) === 1 && (await page.getByText(/nichts gefunden/).count()) === 0)
await page.getByLabel("Anzeigename").fill("Lena")
check("Speichern stays off for a public change", (await page.getByRole("button", { name: "Speichern" }).isEnabled()) === false)
await page.getByLabel("Anzeigename").fill("")
await page.getByLabel("Name im Spiel").fill("Lena")
check("the board name alone can be saved", (await page.getByRole("button", { name: "Speichern" }).isEnabled()) === true)
await page.getByRole("button", { name: "Speichern" }).click()
await wait(page, 2000)
check("nothing public was written by looking or by the board name", req(["-k", "0", "-a", pubkey], RELAYS).length === 0)

await scrollAll(page)
await wait(page, 400)
await page.getByRole("button", { name: "Erweitert" }).click()
await wait(page, 9000)
await shot(page, "f4-advanced-incomplete")
const host = OTHER.replace(/^ws:\/\//, "")
check("Erweitert shows the person's list (from A) with C 'Nicht erreichbar'", (await page.getByText(host).count()) >= 1 && (await page.getByText("Nicht erreichbar").count()) >= 1)
check("the app's relays are not offered as a new list", (await page.getByText(/Noch keine eigene Liste/).count()) === 0)

// Relay C comes back, with the profile's kind 0.
const relayC = spawn(NAK, ["serve", "--port", OTHER.split(":").pop()], { stdio: "ignore" })
await wait(page, 2000)
nak(["event", "-k", "0", "-c", JSON.stringify(original), "--sec", secret, OTHER])
await page.getByRole("button", { name: /Zurück|Profil/ }).first().click()
await wait(page, 800)
await page.getByRole("button", { name: "Bearbeiten" }).click()
await wait(page, 1000)
// Opening the sheet looks again; "Erneut versuchen" is there while the last lookup was incomplete.
await page.getByRole("button", { name: "Erneut versuchen" }).click().catch(() => {})
// The profile shows its display_name (lib/profile/metadata.ts); the field follows the found version.
let found = ""
for (let i = 0; i < 40 && found !== "Lena aus Amber"; i++) {
  await wait(page, 500)
  found = await page.getByLabel("Anzeigename").inputValue()
}
await shot(page, "f4-edit-found")
check("with C back, the profile is found and its name shows in the sheet", found === "Lena aus Amber", found)
await page.getByLabel("Anzeigename").fill("Lena S.")
await page.getByRole("button", { name: "Speichern" }).click()
await page.getByRole("button", { name: "Speichern" }).waitFor({ state: "detached", timeout: 20000 }).catch(() => {})
await wait(page, 2000)
const published = req(["-k", "0", "-a", pubkey], [...RELAYS, OTHER]).map((e) => JSON.parse(e.content)).find((c) => c.display_name === "Lena S.")
check("the edit builds on the found version: the name goes where that profile shows it, foreign fields kept", published && published.name === "lena_s" && published.about === "Darts!" && published.lud16 === "lena@wallet.example", JSON.stringify(published))
// The browser logs each refused socket to the stopped relay; those are the point of the check.
const unexpected = errors.filter((e) => !e.includes(`ws://${host}/`))
check("no console errors beyond the refused sockets to C", unexpected.length === 0, unexpected.join(" | ").slice(0, 300))
console.log("session", JSON.stringify((await idb(page, "kv", "profile.session"))?.value?.kind))
bunker.kill()
relayC.kill()
await ctx.close()
await done()
