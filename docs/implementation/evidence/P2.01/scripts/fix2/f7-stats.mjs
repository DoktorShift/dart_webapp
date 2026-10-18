// Review round 2, low finding (profile.screens.de.ts:75): the period control in Statistik keeps
// every segment on one line at 320 px, in German and English. Also the warm-up of the profile's
// local-data screens once a profile is signed in (components/profile/register.ts): their chunks
// are fetched without visiting them.
//   BASE=http://localhost:3311 node docs/implementation/evidence/P2.01/scripts/fix2/f7-stats.mjs
import { check, done, finishSeeded, layout, nearWin, open, shot, tab, wait } from "../fix1/lib.mjs"

for (const [lang, dark] of [
  ["de", false],
  ["en", true],
]) {
  const { ctx, page, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 320, height: 548 }, lang, dark })
  const chunks = []
  page.on("response", (r) => {
    if (r.url().includes("/_next/static/chunks/") && r.url().endsWith(".js")) chunks.push(r.url().split("/").pop())
  })
  await finishSeeded(page)
  await page.getByRole("button", { name: lang === "de" ? "Deine Ergebnisse mitnehmen" : "Keep your results" }).click()
  await wait(page, 1200)
  await page.getByRole("radio", { name: "Anna" }).click()
  await page.getByRole("button", { name: lang === "de" ? "Profil anlegen" : "Create profile" }).click()
  await page.getByText(lang === "de" ? "Dein Profil ist angelegt" : "Your profile is ready", { exact: false }).waitFor({ timeout: 30000 })
  await page.getByRole("button", { name: lang === "de" ? "Neues Spiel" : "New game" }).click()
  await wait(page, 1200)
  await page.getByRole("button", { name: lang === "de" ? /Zurück|Spielen/ : /Back|Play/ }).first().click().catch(() => {})
  await wait(page, 600)
  const before = chunks.length
  await tab(page, lang === "de" ? "Profil" : "Profile")
  await wait(page, 3000)
  const warmed = chunks.slice(before)
  check(`${lang}: the profile's local-data screens are fetched ahead (${warmed.length} chunks after the tab showed)`, warmed.length >= 5, warmed.join(","))
  await page.getByRole("button", { name: lang === "de" ? "Statistik" : "Statistics" }).click()
  await wait(page, 1500)
  await shot(page, `f7-stats-320-${lang}`)
  const heights = await page.getByRole("radiogroup", { name: lang === "de" ? "Zeitraum" : "Period" }).getByRole("radio").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)))
  check(`${lang}: the period segments are one line each (equal heights)`, heights.length === 3 && heights.every((h) => h === heights[0] && h <= 48), heights.join("/"))
  const l = await layout(page)
  check(`${lang}: no ellipsis, no sideways overflow`, l.ellipsis.length === 0 && !l.wide && l.overflow.length === 0, JSON.stringify(l).slice(0, 200))
  check(`${lang}: no console errors`, errors.length === 0, errors.join(" | ").slice(0, 300))
  await ctx.close()
}
await done()
