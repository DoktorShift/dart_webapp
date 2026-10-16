// Finding 1: an existing profile (another app) whose kind 0 and relay list live on a relay
// outside the app's defaults. Sign in with a bunker:// link, then edit: nothing is written over
// blindly; once the relay is added under Erweitert, the edit keeps every foreign field.
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BASE, OTHER, check, done, nak, open, req, scrollAll, shot, startBunker, tab, wait } from "./lib.mjs"

const secret = nak(["key", "generate"])
const pubkey = nak(["key", "public", secret])
const original = { name: "lena_s", display_name: "Lena aus Amber", about: "Darts!", lud16: "lena@wallet.example", website: "https://lena.example" }
nak(["event", "-k", "0", "-c", JSON.stringify(original), "--sec", secret, OTHER])
nak(["event", "-k", "10002", "-t", `r=${OTHER}`, "--sec", secret, OTHER])
const home = mkdtempSync(join(tmpdir(), "nak-bunker-"))
const { bunker, uri } = await startBunker(spawn, secret, OTHER, home)

const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 } })
await page.goto(BASE)
await wait(page, 1200)
await tab(page, "Profil")
await wait(page, 1000)
await page.getByRole("button", { name: "Ich habe schon ein Profil" }).click()
await wait(page, 700)
await page.getByRole("button", { name: /Mit einer anderen App/ }).click()
await wait(page, 1200)
await page.getByRole("button", { name: /Signer-App/ }).click()
await wait(page, 1500)
await page.getByLabel("Oder Verbindungslink einfügen").fill(uri)
await page.getByRole("button", { name: "Öffnen" }).click()
await page.getByText("Bist du das?").waitFor({ timeout: 20000 })
await wait(page, 1500)
await page.getByRole("button", { name: "Ja, das bin ich" }).click()
await wait(page, 4000)
await shot(page, "21-external-profile-root")
const card = await page.locator('[data-tab-panel="profile"] section[aria-labelledby]').first().innerText()
check("the profile card shows no made-up state: 'Ohne Namen' only once the relays answered", /Ohne Namen|Wird geladen/.test(card), card.split("\n")[0])

// Bearbeiten: the lookup found nothing on the app relays; saving says it creates the profile anew.
await page.getByRole("button", { name: "Bearbeiten" }).click()
await wait(page, 1500)
await shot(page, "22-edit-nothing-found")
check("edit sheet says nothing was found before anything is written", (await page.getByText(/Zu deinem Profil wurde nichts gefunden/).count()) === 1)
check("edit sheet has the two names apart: Name im Spiel and Anzeigename", (await page.getByLabel("Name im Spiel").count()) === 1 && (await page.getByLabel("Anzeigename").count()) === 1)
await page.getByRole("button", { name: "Abbrechen" }).click()
await wait(page, 600)
check("nothing was published by looking", req(["-k", "0", "-a", pubkey]).length === 0)

// Erweitert: no list of the person's own found, so the app's relays stand in, said so.
await scrollAll(page)
await wait(page, 400)
await page.getByRole("button", { name: "Erweitert" }).click()
await wait(page, 3000)
await shot(page, "23-advanced-external")
check("the relay list says it is the app's, not the person's", (await page.getByText(/Noch keine eigene Liste/).count()) === 1)
// Removing asks first; cancelling publishes nothing.
await page.getByRole("button", { name: /entfernen$/ }).first().click()
await wait(page, 600)
await shot(page, "24-remove-asks")
check("removing a relay asks first", (await page.getByRole("alertdialog").count()) === 1)
await page.getByRole("button", { name: "Abbrechen" }).click()
await wait(page, 1000)
check("cancelled: no relay list published", req(["-k", "10002", "-a", pubkey]).length === 0)
// Adding the person's relay: the lookup then finds the real profile there.
await page.getByLabel("Relay hinzufügen").fill("ws://127.0.0.1:18973")
await page.getByRole("button", { name: "Hinzufügen" }).click()
await wait(page, 4000)
await shot(page, "25-advanced-with-own-relay")
await page.getByRole("button", { name: "Profil", exact: true }).first().click()
await wait(page, 4000)
await shot(page, "26-profile-found")
check("with its relay known, the profile shows its real name", (await page.locator('[data-tab-panel="profile"]').getByText("Lena aus Amber").count()) >= 1)

// Edit publicly: every field of the other app stays.
await page.getByRole("button", { name: "Bearbeiten" }).click()
await wait(page, 2500)
await shot(page, "27-edit-known")
check("edit sheet no longer warns", (await page.getByText(/nichts gefunden/).count()) === 0)
await page.getByLabel("Anzeigename").fill("Lena")
await page.getByRole("button", { name: "Speichern" }).click()
await wait(page, 4000)
const [published] = req(["-k", "0", "-a", pubkey])
const fields = published ? JSON.parse(published.content) : {}
check("existing fields (about, lud16, website) kept when editing", fields.display_name === "Lena" && fields.name === "lena_s" && fields.about === "Darts!" && fields.lud16 === "lena@wallet.example" && fields.website === "https://lena.example", published?.content ?? "nothing published")
const [list] = req(["-k", "10002", "-a", pubkey])
check("the person's own relay is on the published list", !!list?.tags.some((t) => t[1] === OTHER), JSON.stringify(list?.tags ?? null))
console.log("errors", errors.join(" | "))
check("no console errors", errors.length === 0, errors.join(" | "))
await ctx.close()
bunker.kill("SIGTERM")
await done()
