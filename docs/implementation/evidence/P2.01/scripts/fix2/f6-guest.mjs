// Review round 2, low finding (profile-root.tsx:4): a guest's chunks carry neither the signed-in
// view nor the rounds/lists code. Guest path: start, Profile tab, setup, game, result with the
// offer row. Every JS chunk loaded is read and searched for markers of the signed-in code.
//   BASE=http://localhost:3311 node docs/implementation/evidence/P2.01/scripts/fix2/f6-guest.mjs
import { BASE, check, done, nearWin, open, tab, wait } from "../fix1/lib.mjs"

// Code that only a profile needs: player rounds (lib/profile/rounds.ts), the stats card opt-in
// (use-stats-card.ts), the signer-app code (connect-screen.tsx) and the replacement dialog's
// name lookup (replace-dialog.tsx imports use-profile).
const MARKERS = ["blueline-round-", "profile.stats-card", "nostrconnect://", "profilePlayers"]
const { ctx, page, errors, sockets } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
const chunks = new Set()
page.on("response", (r) => {
  if (r.url().includes("/_next/static/chunks/") && r.url().endsWith(".js")) chunks.add(r.url())
})
await page.goto(BASE)
await wait(page, 1500)
await tab(page, "Profil")
await wait(page, 1500)
await tab(page, "Spielen")
await wait(page, 500)
await page.getByRole("button", { name: /Weiterspielen|Continue/ }).first().click()
await wait(page, 1200)
await page.keyboard.press("b")
await wait(page, 2500)
check("the offer row is on the result screen", (await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).count()) === 1)
await page.getByRole("button", { name: "Neues Spiel" }).click()
await wait(page, 2000)
// Idle long enough for the shell's offline warm-up (4 s after settling on the tabs).
await page.getByRole("button", { name: /Zurück|Spielen/ }).first().click().catch(() => {})
await wait(page, 7000)

const found = []
for (const url of chunks) {
  const text = await (await fetch(url)).text()
  for (const marker of MARKERS) if (text.includes(marker)) found.push(`${url.split("/").pop()}: ${marker}`)
}
console.log(`${chunks.size} chunks loaded as a guest`)
check("no chunk of the guest path carries signed-in code", found.length === 0, found.join(", "))
check("no socket opened as a guest", sockets.length === 0, sockets.join(","))
check("no console errors", errors.length === 0, errors.join(" | ").slice(0, 300))
await ctx.close()
await done()
