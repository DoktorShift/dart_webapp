// Review round 2, finding 2 (medium): after "Name im Spiel" is changed, the next game started
// the normal way still counts for the profile. Keep results as Anna (display name "Anna-Lena
// Schmidtbauer"), rename the board name to Annie, open setup: the seat shows Annie with the
// profile mark, no "Du" beside it, and Start seats the linked player. Typing the profile's name
// into a seat hides "Du" as well.
//   RELAY_PORTS=20000,20001,20002 BASE=http://localhost:3311 node docs/implementation/evidence/P2.01/scripts/fix2/f3-rename.mjs
import { BASE, check, done, finishSeeded, idb, nearWin, open, shot, tab, wait } from "../fix1/lib.mjs"

const { ctx, page, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
await finishSeeded(page)
await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).click()
await wait(page, 1200)
await page.getByRole("radio", { name: "Anna" }).click()
await page.getByLabel("Anzeigename").fill("Anna-Lena Schmidtbauer")
await page.getByRole("button", { name: "Profil anlegen" }).click()
await page.getByText("Dein Profil ist angelegt", { exact: false }).waitFor({ timeout: 30000 })
const pubkey = (await idb(page, "kv", "profile.session")).value.pubkey

// A game started the normal way, as Anna and Ben: this is "the last game" setup prefills from.
await page.getByRole("button", { name: "Neues Spiel" }).click()
await wait(page, 1500)
const first = page.locator("main input")
await first.nth(0).fill("Anna")
await first.nth(1).fill("Ben")
await page.getByRole("button", { name: /Spiel starten/ }).click()
await wait(page, 2000)
const started = JSON.parse(await page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1")))
check("the game started with Anna's linked player", (await idb(page, "players")).find((p) => p.id === started.config.players[0].id)?.pubkey === pubkey)
await page.evaluate(() => localStorage.removeItem("dart-scorer.current-match.v1"))
await page.goto(BASE)
await wait(page, 1500)
await tab(page, "Profil")
await wait(page, 1500)
await page.getByRole("button", { name: "Bearbeiten" }).click()
await wait(page, 1500)
await page.getByLabel("Name im Spiel").fill("Annie")
await page.getByRole("button", { name: "Speichern" }).click()
await wait(page, 2000)
check("the card says 'Am Board: Annie'", (await page.locator('[data-tab-panel="profile"]').getByText("Am Board: Annie").count()) === 1)

// Setup, started the normal way.
await tab(page, "Spielen")
await wait(page, 800)
await page.getByRole("button", { name: /^501$|X01/ }).first().click()
await wait(page, 1500)
await shot(page, "f3-setup-after-rename")
const seats = page.locator("main input")
const names = []
for (let i = 0; i < (await seats.count()); i++) names.push(await seats.nth(i).inputValue())
check("seats are prefilled with the renamed player and Ben", names[0] === "Annie" && names[1] === "Ben", JSON.stringify(names))
check("the first seat carries the profile mark", (await page.getByRole("img", { name: "Mit Profil verbunden" }).count()) === 1)
check("'Du' is not offered beside her", (await page.getByRole("button", { name: "Du", exact: true }).count()) === 0)
await page.getByRole("button", { name: /Spiel starten/ }).click()
await wait(page, 2000)
const current = JSON.parse(await page.evaluate(() => localStorage.getItem("dart-scorer.current-match.v1")))
const players = await idb(page, "players")
const seat0 = players.find((p) => p.id === current.config.players[0].id)
check("Start seats the linked player (counts for the profile)", seat0?.pubkey === pubkey && seat0?.name === "Annie", JSON.stringify(players.map((p) => [p.name, p.pubkey?.slice(0, 6) ?? null])))
check("no second player was created for the old name", !players.some((p) => p.name === "Anna"))

// Typed name: "Du" hides once a seat holds the profile's name.
await page.evaluate(() => localStorage.removeItem("dart-scorer.current-match.v1"))
await page.goto(BASE)
await wait(page, 1500)
await page.getByRole("button", { name: /^501$|X01/ }).first().click()
await wait(page, 1500)
const inputs = page.locator("main input")
for (let i = 0; i < (await inputs.count()); i++) await inputs.nth(i).fill("")
await wait(page, 400)
check("'Du' is offered while her seat is empty", (await page.getByRole("button", { name: "Du", exact: true }).count()) === 1)
await inputs.nth(0).fill("annie")
await wait(page, 400)
await shot(page, "f3-setup-typed-name")
check("'Du' hides once her name is typed (case apart)", (await page.getByRole("button", { name: "Du", exact: true }).count()) === 0)
check("no console errors", errors.length === 0, errors.join(" | ").slice(0, 300))
await ctx.close()
await done()
