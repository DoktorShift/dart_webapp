// Badge checks against a production build with NEXT_PUBLIC_BLUELINE_RELAYS pointing at two
// local "nak serve" relays: the success card on the result screen (guest and profile, phone and
// landscape), the badges screens, "Im Profil zeigen" with what reaches the relays (nak reads
// and verifies it), the profile card, arranging, the guest's view, and English in dark mode.
// Reuses the profile track's browser helpers (docs/implementation/evidence/P2.01/scripts/fix1/lib.mjs).
//   nak serve --port 20080 & nak serve --port 20081 &
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20080,ws://127.0.0.1:20081 npm run build && npx next start -p 3323
//   BASE=http://localhost:3323 RELAY_PORTS=20080,20081,20082 OUT=/tmp/badges-shots node docs/implementation/evidence/P7a.01/scripts/badges-checks.mjs
import { BASE, RELAYS, check, dart, done, finishSeeded, game, idb, layout, nak, open, scrollAll, shot, tab, wait } from "../../P2.01/scripts/fix1/lib.mjs"

// 301: Anna T20 T20 T20 (180), Ben 1 1 1, Anna T20 11, then the bull: a 121 checkout, 301 in
// six darts (a perfect leg in 301, average 150.5). Anna reaches nine milestones at once: first
// win, first 100+, 140+ and 180, 100+ finish, perfect leg, 40/60/80 average. Ben reaches nothing.
const nearWin = (names) => game(names, [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)])
const ANNAS = 9
const BADGE_NAMES = /^(Erster Sieg|Erste 100\+|Erste 140\+|Erste 180|Finish ab 100|Perfektes Leg|Schnitt 40|Schnitt 60|Schnitt 80)$/
// The screen on top of the tab's stack (covered ones stay in the DOM, inert).
const top = (page) => page.locator("[data-scroll-container]:visible").last()
const newest = (list) => [...list].sort((x, y) => y.created_at - x.created_at)[0]

const req = (args) => {
  try {
    return nak(["req", ...args, ...RELAYS], { timeout: 8000 }).split("\n").filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
const noLayoutProblems = (l) => l.ellipsis.length === 0 && !l.wide && l.overflow.length === 0

// --- The success card as a guest, on four screen sizes -----------------------------------------
for (const [w, h] of [[320, 548], [390, 844], [568, 320], [844, 390]]) {
  const { ctx, page, sockets, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: w, height: h } })
  await finishSeeded(page)
  await wait(page, 1200)
  await shot(page, `10-result-card-${w}x${h}`)
  const card = page.getByRole("button", { name: /Auszeichnung/ })
  check(`result ${w}x${h}: the success card is one row naming the nine new badges`, (await card.count()) === 1 && (await card.textContent()) === `${ANNAS} neue Auszeichnungen`, await card.textContent())
  const l = await layout(page)
  check(`result ${w}x${h}: no ellipsis, no horizontal overflow, no page scroll`, noLayoutProblems(l) && !(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 1)), JSON.stringify(l))
  check(`result ${w}x${h}: no socket opened as a guest`, sockets.length === 0, sockets.join(","))
  if (w === 390) {
    await card.click()
    await wait(page, 900)
    await shot(page, "11-earned-sheet-guest")
    const sheet = page.getByRole("dialog").last()
    check("the sheet lists the badges reached, without an action for a guest", (await sheet.getByText("Erste 180").count()) === 1 && (await sheet.getByText("Perfektes Leg").count()) === 1 && (await sheet.locator("li").count()) === ANNAS && (await sheet.getByRole("button", { name: "Im Profil zeigen" }).count()) === 0)
    await sheet.getByRole("button", { name: "Fertig" }).click()
    await wait(page, 600)
    await page.getByRole("button", { name: "Ausblenden" }).click()
    await wait(page, 600)
    check("Ausblenden puts the card away", (await card.count()) === 0)
    await page.reload()
    await wait(page, 1500)
    check("… and it stays away after a reload", (await page.getByRole("button", { name: /Auszeichnung/ }).count()) === 0)
  }
  check(`result ${w}x${h}: no console errors`, errors.length === 0, errors.join(" | "))
  await ctx.close()
}

// --- Guest: the Profile tab's row and screen ----------------------------------------------------
{
  const { ctx, page, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
  await finishSeeded(page)
  await page.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 800)
  await tab(page, "Profil")
  await wait(page, 1200)
  await scrollAll(page)
  await wait(page, 400)
  await shot(page, "20-guest-profile-row")
  const row = page.getByRole("button", { name: /^Auszeichnungen/ })
  check("a guest's Profile tab has the Auszeichnungen row with the count", (await row.count()) === 1 && (await row.textContent()).includes(String(ANNAS)), await row.textContent())
  await row.click()
  await wait(page, 1200)
  await shot(page, "21-guest-badges")
  check("the guest's badges are grouped by player, reached on this device", (await top(page).getByText("Anna", { exact: true }).count()) === 1 && (await top(page).getByText("Auf diesem Gerät erreicht").count()) === ANNAS && (await top(page).getByText(/Mit einem Profil/).count()) === 1)
  await page.getByRole("button", { name: "Erste 180" }).click()
  await wait(page, 1000)
  await shot(page, "22-guest-badge-detail")
  check("a guest's badge detail: meaning, condition, date and the game; no visibility", (await top(page).getByText("Drei Triple-20 in einer Aufnahme.").count()) === 1 && (await top(page).getByText("Ergebnis").count()) === 1 && (await page.getByRole("button", { name: "Im Profil zeigen" }).count()) === 0)
  check("no console errors (guest)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

// --- A profile: show in profile, what reaches the relays, the card, arranging -----------------
{
  const { ctx, page, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
  await finishSeeded(page)
  await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).click()
  await wait(page, 900)
  await page.getByRole("radio", { name: "Anna" }).click()
  await page.getByLabel("Anzeigename").fill("Anna Schmidt")
  await page.getByRole("button", { name: "Profil anlegen" }).click()
  await page.getByText("Dein Profil ist angelegt", { exact: false }).waitFor({ timeout: 30000 })
  await wait(page, 1500)
  const pubkey = (await idb(page, "kv", "profile.session")).value.pubkey
  await shot(page, "30-result-with-profile")
  // The card is still there; the sheet now offers "Im Profil zeigen".
  await page.getByRole("button", { name: /Auszeichnung/ }).click()
  await wait(page, 900)
  await shot(page, "31-earned-sheet-profile")
  const sheet = page.getByRole("dialog").last()
  check("with a profile the sheet offers to show the badges in it", (await sheet.getByRole("button", { name: "Im Profil zeigen" }).count()) === 1)
  const t0 = Date.now()
  await sheet.getByRole("button", { name: "Im Profil zeigen" }).click()
  await sheet.getByText("Jetzt in deinem Profil.").waitFor({ timeout: 30000 })
  console.log(`shown in ${Date.now() - t0} ms (lab value, two local relays)`)
  await shot(page, "32-earned-sheet-shown")
  await wait(page, 1500)
  const awards = req(["-k", "8", "-a", pubkey])
  const definitions = req(["-k", "30009", "-a", pubkey])
  const evidence = req(["-k", "1180", "-a", pubkey])
  const lists = req(["-k", "10008", "-a", pubkey])
  check("the relays hold the nine self-earned awards, their definitions and evidence, and the list", awards.length === ANNAS && definitions.length === ANNAS && evidence.length === ANNAS && lists.length >= 1, `${awards.length}/${definitions.length}/${evidence.length}/${lists.length}`)
  check("nak verifies every published badge event", nak(["verify"], { input: `${[...awards, ...definitions, ...evidence, ...lists].map((e) => JSON.stringify(e)).join("\n")}\n` }) === "")
  check("every award is marked self-earned and names its evidence; nothing names Ben or the throws", awards.every((a) => a.tags.some((t) => t[0] === "p" && t[1] === pubkey) && a.tags.some((t) => t[0] === "a" && t[1].includes(":blueline:self:"))) && !JSON.stringify([...awards, ...definitions, ...evidence]).includes("Ben"))
  check("the evidence names the game, its mode and the figure", evidence.some((e) => JSON.parse(e.content).result?.value === 180 && JSON.parse(e.content).result?.mode === "301"))
  check("the list shows the nine", newest(lists).tags.filter((t) => t[0] === "e").length === ANNAS)
  await sheet.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 600)
  await page.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 800)

  // The Profile tab: the row and the card.
  await tab(page, "Profil")
  await wait(page, 1500)
  await shot(page, "33-profile-card-chips")
  check("the profile card shows three badges as chips", (await page.getByRole("button", { name: BADGE_NAMES }).count()) === 3)
  await scrollAll(page)
  await wait(page, 400)
  const row = page.getByRole("button", { name: /^Auszeichnungen/ })
  check("the Auszeichnungen row counts nine", (await row.textContent()).includes(String(ANNAS)), await row.textContent())
  await row.click()
  await wait(page, 1500)
  await shot(page, "34-badges-list")
  check("the list: Im Profil with nine and Anordnen, and what is within reach with progress", (await top(page).getByText("Im Profil", { exact: true }).count()) === 1 && (await top(page).getByRole("button", { name: BADGE_NAMES }).count()) === ANNAS && (await page.getByRole("button", { name: "Anordnen" }).count()) === 1 && (await top(page).getByText("Erreichbar").count()) === 1 && (await top(page).getByText(/1 von 10 Spielen/).count()) === 1)
  const l = await layout(page)
  check("badges list: no ellipsis, no overflow, targets at least 44 pt", noLayoutProblems(l) && l.small.length === 0, JSON.stringify(l))
  await page.getByRole("button", { name: /^Erste 180/ }).click()
  await wait(page, 1200)
  await shot(page, "35-badge-detail-shown")
  check("the detail says self-earned, in the profile, with the game and 'Aus dem Profil nehmen'", (await top(page).getByText("Selbst erreicht").count()) >= 1 && (await top(page).getByText("Im Profil", { exact: true }).count()) === 1 && (await top(page).getByText("Ergebnis").count()) === 1 && (await page.getByRole("button", { name: "Aus dem Profil nehmen" }).count()) === 1)
  await page.getByRole("button", { name: "Aus dem Profil nehmen" }).click()
  await page.getByRole("button", { name: "Im Profil zeigen" }).waitFor({ timeout: 20000 })
  await wait(page, 1200)
  await shot(page, "36-badge-detail-hidden")
  const hidden = newest(req(["-k", "10008", "-a", pubkey]))
  check("hiding publishes the list without it; the award itself stays", hidden.tags.filter((t) => t[0] === "e").length === ANNAS - 1 && req(["-k", "8", "-a", pubkey]).length === ANNAS)
  await page.getByRole("button", { name: "Im Profil zeigen" }).click()
  await page.getByRole("button", { name: "Aus dem Profil nehmen" }).waitFor({ timeout: 20000 })
  await wait(page, 800)
  // Erweitert: the technical details sit behind a disclosure.
  check("the technical details are not in view before Erweitert is opened", !(await top(page).getByText("Aussteller-Kennung").isVisible()))
  await top(page).getByText("Erweitert").click()
  await wait(page, 500)
  await shot(page, "37-badge-detail-advanced")
  check("Erweitert shows the issuer key and event id once opened", await top(page).getByText("Aussteller-Kennung").isVisible())
  await page.getByRole("button", { name: /Zurück|Auszeichnungen/ }).first().click()
  await wait(page, 1000)

  // Arranging.
  await page.getByRole("button", { name: "Anordnen" }).click()
  await wait(page, 1200)
  await shot(page, "38-arrange")
  const first = await page.locator("ol li").first().textContent()
  await page.locator("ol li").nth(1).getByRole("button", { name: /nach oben/ }).click()
  await wait(page, 300)
  await page.getByRole("button", { name: "Speichern" }).click()
  await wait(page, 2500)
  const arranged = newest(req(["-k", "10008", "-a", pubkey]))
  check("arranging publishes the new order and returns to the list", arranged.created_at > hidden.created_at && arranged.tags.filter((t) => t[0] === "e").length === ANNAS && (await page.locator("ol li:visible").count()) === 0, first ?? "")
  check("no console errors (profile)", errors.length === 0, errors.join(" | "))

  // English, dark: the list and a detail.
  const en = await open({ context: ctx })
  await en.page.goto(BASE)
  await wait(en.page, 1500)
  await en.page.evaluate(() => localStorage.setItem("dart-scorer.language.v1", "en"))
  await en.page.emulateMedia({ colorScheme: "dark" })
  await en.page.evaluate(() => localStorage.setItem("theme", "dark"))
  await en.page.reload()
  await wait(en.page, 1500)
  await en.page.getByRole("navigation", { name: /^(Bereiche|Sections)$/ }).last().getByRole("button", { name: "Profile", exact: true }).click()
  await wait(en.page, 1500)
  await scrollAll(en.page)
  await wait(en.page, 400)
  await en.page.getByRole("button", { name: /^Badges/ }).click()
  await wait(en.page, 1500)
  await shot(en.page, "40-badges-list-en-dark")
  check("English: the list reads 'In your profile', 'Within reach'", (await top(en.page).getByText("In your profile", { exact: true }).count()) === 1 && (await top(en.page).getByText("Within reach").count()) === 1)
  await en.page.getByRole("button", { name: /^First 180/ }).click()
  await wait(en.page, 1200)
  await shot(en.page, "41-badge-detail-en-dark")
  check("English: the detail reads 'Self-earned'", (await top(en.page).getByText("Self-earned").count()) >= 1)
  await ctx.close()
}

await done()
