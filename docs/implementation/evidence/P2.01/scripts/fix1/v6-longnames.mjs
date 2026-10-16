// Finding 4: a seat holds 16 characters. Six tiles of the longest possible seat names, on the
// game screen at 320x548 and 568x320: every name in full, nothing clipped, no scrolling.
import { BASE, check, dart, done, game, layout, open, shot, wait } from "./lib.mjs"

const names = ["Maximilian Alexa", "Johanna Schmidt", "Konstantinopoulo", "Wolfgang-Dietric", "Anna", "Ben"]
for (const [w, h] of [[320, 548], [568, 320], [390, 844]]) {
  for (const count of [6, 4]) {
    const { ctx, page } = await open({ seed: game(names.slice(0, count), [dart(20, 3)], "playing", 501), viewport: { width: w, height: h } })
    await page.goto(BASE)
    await wait(page, 1500)
    await shot(page, `60-game-${count}-seats-${w}x${h}`)
    const r = await layout(page)
    const fit = await page.evaluate((names) => {
      const all = [...document.querySelectorAll("body *")]
      return names.map((name) => {
        const el = all.find((e) => e.childElementCount === 0 && e.textContent === name)
        if (!el) return { name, found: false }
        const rect = el.getBoundingClientRect()
        const parent = el.parentElement.getBoundingClientRect()
        return { name, found: true, clipped: rect.right > parent.right + 1 || rect.bottom > parent.bottom + 1 || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 }
      })
    }, names.slice(0, count))
    const ok = fit.every((f) => f.found && !f.clipped) && r.ellipsis.length === 0 && !r.wide
    check(`${count} seats at ${w}x${h}: every 16-character name in full`, ok, JSON.stringify(fit.filter((f) => !f.found || f.clipped)))
    await ctx.close()
  }
}
await done()
