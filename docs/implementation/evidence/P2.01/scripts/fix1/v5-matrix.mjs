// The changed screens in DE/EN, light/dark, 320x548 and 1024x768, with a layout audit each.
import { execFileSync } from "node:child_process"
import { BASE, RELAYS, check, done, layout, nak, open, scrollAll, shot, tab, wait } from "./lib.mjs"

const secret = nak(["key", "generate"])
const other = nak(["key", "public", secret])
nak(["event", "-k", "0", "-c", JSON.stringify({ name: "Lena aus Amber", about: "Darts!" }), "--sec", secret, ...RELAYS])
const link = execFileSync("node", ["link.mjs", other], { cwd: new URL(".", import.meta.url).pathname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
const hash = link.slice(link.indexOf("#"))

const combos = [
  { lang: "de", dark: false, viewport: { width: 320, height: 548 } },
  { lang: "en", dark: true, viewport: { width: 320, height: 548 } },
  { lang: "de", dark: true, viewport: { width: 1024, height: 768 } },
  { lang: "en", dark: false, viewport: { width: 1024, height: 768 } },
]
const L = {
  de: { profile: "Profil", play: "Spielen", create: "Profil anlegen", name: "Anzeigename", edit: "Bearbeiten", advanced: "Erweitert", preview: "So sehen andere dein Profil", stats: "Statistik", signOut: "Abmelden", cancel: "Abbrechen", remove: /entfernen$/, toggle: "Statistik im Profil zeigen", add: "Zum Spiel hinzufügen", me: "Du", x01: "X01" },
  en: { profile: "Profile", play: "Play", create: "Create profile", name: "Display name", edit: "Edit", advanced: "Advanced", preview: "How others see your profile", stats: "Statistics", signOut: "Sign out", cancel: "Cancel", remove: /^Remove /, toggle: "Show statistics in profile", add: "Add to game", me: "You", x01: "X01" },
}

for (const combo of combos) {
  const l = L[combo.lang]
  const tag = `${combo.viewport.width}-${combo.lang}-${combo.dark ? "dark" : "light"}`
  const { ctx, page, errors } = await open(combo)
  const audit = async (name) => {
    await shot(page, `m-${tag}-${name}`)
    const r = await layout(page)
    const bad = r.ellipsis.length > 0 || r.wide || r.overflow.length > 0
    if (bad || r.small.length) console.log(`  ${name}: ${JSON.stringify(r)}`)
    check(`${tag} ${name}: no ellipsis, no sideways overflow`, !bad)
  }
  await page.goto(`${BASE}/${hash}`)
  await wait(page, 4000)
  await audit("public")
  await page.goto(BASE)
  await wait(page, 1200)
  await tab(page, l.profile)
  await wait(page, 900)
  await page.getByRole("button", { name: l.create }).click()
  await wait(page, 900)
  await page.getByLabel(l.name).fill(combo.lang === "de" ? "Johanna Konstantinopoulou-Schmidt" : "Johanna Konstantinopoulou-Smith")
  await wait(page, 300)
  await audit("create")
  await page.getByRole("button", { name: l.create }).click()
  await wait(page, 3000)
  await audit("root")
  await page.getByRole("button", { name: l.edit }).click()
  await wait(page, 2500)
  await audit("edit")
  await page.getByRole("button", { name: l.cancel }).click()
  await wait(page, 600)
  await scrollAll(page)
  await wait(page, 400)
  await audit("root-bottom")
  await page.getByRole("button", { name: l.stats }).click()
  await wait(page, 1500)
  await audit("stats")
  await page.getByRole("button", { name: l.profile, exact: true }).first().click()
  await wait(page, 800)
  await scrollAll(page)
  await page.getByRole("button", { name: l.advanced, exact: true }).click()
  await wait(page, 3000)
  await audit("advanced")
  await page.getByRole("button", { name: l.remove }).first().click()
  await wait(page, 600)
  await audit("advanced-remove")
  await page.getByRole("button", { name: l.cancel }).click()
  await wait(page, 500)
  await page.getByRole("button", { name: l.profile, exact: true }).first().click()
  await wait(page, 800)
  await scrollAll(page)
  await page.getByRole("button", { name: l.preview }).click()
  await wait(page, 3000)
  await page.getByRole("switch", { name: l.toggle }).click()
  await wait(page, 2500)
  await audit("preview-on")
  await page.getByRole("button", { name: l.profile, exact: true }).first().click()
  await wait(page, 800)
  await scrollAll(page)
  await page.getByRole("button", { name: l.signOut }).click()
  await wait(page, 800)
  await audit("signout")
  await page.getByRole("button", { name: l.cancel }).click()
  await wait(page, 500)
  // Setup with "Du", from the Play tab.
  await tab(page, l.play)
  await wait(page, 800)
  await page.getByRole("button", { name: l.x01 }).first().click()
  await wait(page, 1500)
  await audit("setup")
  check(`${tag} setup offers '${l.me}'`, (await page.getByRole("button", { name: l.me, exact: true }).count()) === 1)
  check(`${tag}: no console errors`, errors.length === 0, errors.join(" | ").slice(0, 300))
  await ctx.close()
}
await done()
