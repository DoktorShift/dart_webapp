// Review round 2, finding 3 (medium): saving a change with a version known here does not wait
// for the relays. A profile is created online; then (1) offline, Bearbeiten > Anzeigename >
// Speichern closes the sheet at once; (2) online with relay B hanging (blackhole.py holding its
// port), Speichern closes within a moment (the bounded wait), not after the 8 s query deadline.
//   Run with relay B replaced by blackhole.py (RELAY_PORTS' second port).
//   RELAY_PORTS=20000,20001,20002 BASE=http://localhost:3311 node docs/implementation/evidence/P2.01/scripts/fix2/f5-timing.mjs
import { check, done, finishSeeded, idb, nearWin, open, shot, tab, wait } from "../fix1/lib.mjs"

const { ctx, page, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
await finishSeeded(page)
await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).click()
await wait(page, 1200)
await page.getByRole("radio", { name: "Anna" }).click()
await page.getByRole("button", { name: "Profil anlegen" }).click()
await page.getByText("Dein Profil ist angelegt", { exact: false }).waitFor({ timeout: 30000 })
await page.getByRole("button", { name: "Neues Spiel" }).click()
await wait(page, 1200)
await page.getByRole("button", { name: /Zurück|Spielen/ }).first().click().catch(() => {})
await wait(page, 600)
await tab(page, "Profil")
await wait(page, 1500)

async function saveTimed(name, label) {
  await page.getByRole("button", { name: "Bearbeiten" }).click()
  await wait(page, 1200)
  await page.getByLabel("Anzeigename").fill(name)
  const save = page.getByRole("button", { name: "Speichern" })
  const t0 = Date.now()
  await save.click()
  await save.waitFor({ state: "detached", timeout: 20000 }).catch(() => {})
  const took = Date.now() - t0
  await wait(page, 800)
  const shown = (await page.locator('[data-tab-panel="profile"]').getByText(name).count()) >= 1
  check(`${label}: Speichern closes the sheet within a moment and the name shows`, took < 3000 && shown, `${took} ms (lab value)`)
  return took
}

// (1) Offline: no wait at all.
await ctx.setOffline(true)
await wait(page, 500)
await saveTimed("Anna offline", "offline")
await shot(page, "f5-after-offline-save")
await ctx.setOffline(false)
await wait(page, 1500)

// (2) Online, relay B hanging: the bounded wait, not the query deadline.
await saveTimed("Anna hangs", "relay hanging")
const objects = await idb(page, "objects")
check("the version was kept here", objects.some((o) => o.id === "own:0:" && (JSON.parse(o.event.content).display_name ?? JSON.parse(o.event.content).name) === "Anna hangs"), JSON.stringify(objects.map((o) => [o.id, o.event?.content?.slice(0, 40)])))
// Offline, the browser logs each failed fetch; those are the point of the check.
const unexpected = errors.filter((e) => !e.includes("ERR_INTERNET_DISCONNECTED"))
check("no console errors beyond the offline fetches", unexpected.length === 0, unexpected.join(" | ").slice(0, 300))
await ctx.close()
await done()
