// Findings 6 and 7: the stats-card opt-in holds before the first game; "Zum Spiel hinzufügen" on
// someone's profile opens setup with them seated. Plus the local sign-out dialog's title.
import { execFileSync } from "node:child_process"
import { BASE, RELAYS, check, done, idb, nak, open, scrollAll, shot, tab, wait } from "./lib.mjs"

// Someone with a public profile on the app relays.
const secret = nak(["key", "generate"])
const other = nak(["key", "public", secret])
nak(["event", "-k", "0", "-c", JSON.stringify({ name: "Maximilian Alexander Friedrich von Testhausen-Wel" }), "--sec", secret, ...RELAYS])
const link = execFileSync("node", ["link.mjs", other], { cwd: new URL(".", import.meta.url).pathname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()

const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 } })
// A guest opens the profile from a link.
await page.goto(link)
await wait(page, 4000)
await shot(page, "80-public-guest")
check("a public profile offers 'Zum Spiel hinzufügen' below 'Profil teilen'", (await page.getByRole("button", { name: "Zum Spiel hinzufügen" }).count()) === 1)
await page.getByRole("button", { name: "Zum Spiel hinzufügen" }).click()
await wait(page, 1500)
await shot(page, "81-setup-from-profile")
const seat = await page.locator("main input").first().inputValue()
check("setup opens with the player seated, the name as a seat holds it (16), linked", seat === "Maximilian Alexa" && (await page.getByRole("img", { name: "Mit Profil verbunden" }).count()) === 1, seat)
// Back from setup lands on the profile again.
await page.getByRole("button", { name: /Zurück|Profil/ }).first().click()
await wait(page, 1000)

// A new profile without games: the opt-in sticks.
await tab(page, "Profil")
await wait(page, 900)
await page.getByRole("button", { name: "Profil anlegen" }).click()
await wait(page, 900)
await page.getByLabel("Anzeigename").fill("Carla")
await page.getByRole("button", { name: "Profil anlegen" }).click()
await wait(page, 3000)
await scrollAll(page)
await wait(page, 400)
await page.getByRole("button", { name: "So sehen andere dein Profil" }).click()
await wait(page, 3000)
await page.getByRole("switch", { name: "Statistik im Profil zeigen" }).click()
await wait(page, 2500)
await shot(page, "82-preview-on-no-games")
check("the switch stays on without games, and says why nothing shows yet", (await page.getByRole("switch", { name: "Statistik im Profil zeigen" }).getAttribute("aria-checked")) === "true" && (await page.getByText(/Noch keine Spiele/).count()) >= 1)
const choice = (await idb(page, "kv", "profile.stats-card"))?.value
check("the choice is stored with the profile", choice === true, String(choice))
const pubkey = (await idb(page, "kv", "profile.session"))?.value?.pubkey
const cards = nak(["req", "-k", "31180", "-a", pubkey, ...RELAYS], { timeout: 8000 }).split("\n").filter(Boolean)
check("no card with figures was published without games", cards.length === 0 || cards.every((c) => /"x01":null/.test(JSON.parse(c).content)), String(cards.length))
await page.getByRole("switch", { name: "Statistik im Profil zeigen" }).click()
await wait(page, 1500)
check("switching off is remembered too", (await idb(page, "kv", "profile.stats-card"))?.value === false)

// Sign-out dialog of a local profile: the loss is the first thing read.
await page.getByRole("button", { name: "Profil", exact: true }).first().click()
await wait(page, 800)
await scrollAll(page)
await wait(page, 400)
await page.getByRole("button", { name: "Abmelden" }).click()
await wait(page, 800)
await shot(page, "83-signout-local")
check("the local sign-out dialog leads with the missing backup", (await page.getByRole("alertdialog").getByText("Abmelden ohne Sicherung?").count()) === 1)
await page.getByRole("button", { name: "Abbrechen" }).click()
check("no console errors", errors.length === 0, errors.join(" | "))
await ctx.close()
await done()
