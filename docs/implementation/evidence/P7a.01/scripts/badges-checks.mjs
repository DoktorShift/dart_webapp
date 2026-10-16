// Badge checks against a production build with NEXT_PUBLIC_BLUELINE_RELAYS pointing at two
// local "nak serve" relays: the success card on the result screen (guest and profile, phone and
// landscape), the badges screens, "Im Profil zeigen" with what reaches the relays (nak reads
// and verifies it), the profile card, arranging, a stranger's award, a correction, another
// signed-in player opening a chip, the guest's view, and English in dark mode.
// Reuses the profile track's browser helpers (docs/implementation/evidence/P2.01/scripts/fix1/lib.mjs).
//   nak serve --port 20680 & nak serve --port 20681 & nak serve --port 20682 &
//   NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20680,ws://127.0.0.1:20681 npm run build && npx next start -p 3323
//   BASE=http://localhost:3323 RELAY_PORTS=20680,20681,20682 OUT=/tmp/badges-shots node docs/implementation/evidence/P7a.01/scripts/badges-checks.mjs
import { BASE, RELAYS, check, dart, done, finishSeeded, game, idb, layout, nak, open, scrollAll, shot, tab, wait } from "../../P2.01/scripts/fix1/lib.mjs"

// 301: Anna T20 T20 T20 (180), Ben 1 1 1, Anna T20 11, then the bull: a 121 checkout, 301 in
// six darts (a perfect leg in 301, average 150.5). Anna reaches nine milestones at once: first
// win, first 100+, 140+ and 180, 100+ finish, perfect leg, 40/60/80 average. Ben reaches nothing.
const nearWin = (names) => game(names, [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)])
const ANNAS = 9
const BADGE_NAMES = /^(Erster Sieg|Erste 100\+|Erste 140\+|Erste 180|Finish ab 100|Perfektes Leg|Schnitt 40|Schnitt 60|Schnitt 80)/
// The screen on top of the tab's stack (covered ones stay in the DOM, inert).
const top = (page) => page.locator("[data-scroll-container]:visible").last()
const back = (page) => page.getByRole("button", { name: /Zurück|Auszeichnungen|Spielerprofil/ }).first().click()
const newest = (list) => [...list].sort((x, y) => y.created_at - x.created_at)[0]

const req = (args) => {
  try {
    return nak(["req", ...args, ...RELAYS], { timeout: 8000 }).split("\n").filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
const noLayoutProblems = (l) => l.ellipsis.length === 0 && !l.wide && l.overflow.length === 0
const inView = async (locator, height) => {
  const box = await locator.boundingBox()
  return !!box && box.y >= 0 && box.y + box.height <= height + 1
}

// "Deine Ergebnisse mitnehmen" on the result: the profile of one seat, created in the sheet.
async function createProfile(page, seat, name) {
  await page.getByRole("button", { name: "Deine Ergebnisse mitnehmen" }).click()
  await wait(page, 900)
  await page.getByRole("radio", { name: seat }).click()
  await page.getByLabel("Anzeigename").fill(name)
  await page.getByRole("button", { name: "Profil anlegen" }).click()
  await page.getByText("Dein Profil ist angelegt", { exact: false }).waitFor({ timeout: 30000 })
  await wait(page, 1500)
  return (await idb(page, "kv", "profile.session")).value.pubkey
}

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
  // Up to 500 pt high the card is a bar line: no dismiss button, no icon, no background; up to
  // 740 pt it is 44 pt without the icon.
  const dismiss = page.getByRole("button", { name: "Ausblenden" })
  const icon = card.locator("svg").first()
  const box = await card.boundingBox()
  if (h <= 500) check(`result ${w}x${h}: landscape: a bar line without dismiss button, icon or ring`, !(await dismiss.isVisible()) && !(await icon.isVisible()) && (await card.evaluate((el) => getComputedStyle(el.parentElement).backgroundColor)) === "rgba(0, 0, 0, 0)", `${box?.height}`)
  else if (h <= 740) check(`result ${w}x${h}: short: 44 pt without the icon`, (await dismiss.isVisible()) && !(await icon.isVisible()) && box.height >= 43.5 && box.height < 45, `${box?.height}`)
  else check(`result ${w}x${h}: the full row with icon and dismiss button`, (await dismiss.isVisible()) && (await icon.isVisible()) && box.height >= 47 && box.height <= 49, `${box?.height}`)
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
  const { ctx, page, sockets, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
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
  await wait(page, 1500)
  await shot(page, "22-guest-badge-detail")
  check("a guest's badge detail: meaning, condition, date and the game; no visibility", (await top(page).getByText("Drei Triple-20 in einer Aufnahme.").count()) === 1 && (await top(page).getByText("Ergebnis").count()) === 1 && (await page.getByRole("button", { name: "Im Profil zeigen" }).count()) === 0)
  check("guest milestone detail opens no socket (guest path)", sockets.length === 0, sockets.join(","))
  check("no console errors (guest)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

// --- A profile: show in profile, what reaches the relays, the card, arranging -----------------
let annaPubkey = ""
{
  const { ctx, page, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
  await finishSeeded(page)
  const pubkey = await createProfile(page, "Anna", "Anna Schmidt")
  annaPubkey = pubkey
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
  check("the confirmation stands in the button's place, in view without scrolling", (await inView(sheet.getByText("Jetzt in deinem Profil."), 844)) && (await sheet.getByRole("button", { name: "Im Profil zeigen" }).count()) === 0)
  await wait(page, 1500)
  const awards = req(["-k", "8", "-a", pubkey])
  const definitions = req(["-k", "30009", "-a", pubkey])
  const evidence = req(["-k", "1180", "-a", pubkey])
  const lists = req(["-k", "10008", "-a", pubkey])
  check("the relays hold the nine self-earned awards, their definitions and evidence, and one list", awards.length === ANNAS && definitions.length === ANNAS && evidence.length === ANNAS && lists.length === 1, `${awards.length}/${definitions.length}/${evidence.length}/${lists.length}`)
  check("nak verifies every published badge event", nak(["verify"], { input: `${[...awards, ...definitions, ...evidence, ...lists].map((e) => JSON.stringify(e)).join("\n")}\n` }) === "")
  check("every award is marked self-earned and names its evidence; nothing names Ben or the throws", awards.every((a) => a.tags.some((t) => t[0] === "p" && t[1] === pubkey) && a.tags.some((t) => t[0] === "a" && t[1].includes(":blueline:self:"))) && !JSON.stringify([...awards, ...definitions, ...evidence]).includes("Ben"))
  check("the evidence names the game, its mode and the figure", evidence.some((e) => JSON.parse(e.content).result?.value === 180 && JSON.parse(e.content).result?.mode === "301"))
  const listed = newest(lists).tags.filter((t) => t[0] === "a").map((t) => t[1].split(":")[4])
  check("the one list names the nine, rarest first", listed.length === ANNAS && listed.slice(0, 3).join(",") === "perfect-leg,first-180,checkout-100", listed.join(","))
  await sheet.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 600)
  // Opened again, the sheet says they are in the profile; nothing to publish any more.
  await page.getByRole("button", { name: /Auszeichnung/ }).click()
  await wait(page, 900)
  check("the sheet opened again keeps the confirmation and offers nothing", (await sheet.getByText("Jetzt in deinem Profil.").count()) === 1 && (await sheet.getByRole("button", { name: "Im Profil zeigen" }).count()) === 0)
  await sheet.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 600)
  await page.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 800)

  // The Profile tab: the row and the card.
  await tab(page, "Profil")
  await wait(page, 1500)
  await shot(page, "33-profile-card-chips")
  const chips = page.getByRole("button", { name: BADGE_NAMES })
  check("the profile card shows three badges as chips, the rarest first", (await chips.count()) === 3 && (await chips.first().textContent()) === "Perfektes Leg", (await chips.allTextContents()).join(","))
  await scrollAll(page)
  await wait(page, 400)
  const row = page.getByRole("button", { name: /^Auszeichnungen/ })
  check("the Auszeichnungen row counts nine", (await row.textContent()).includes(String(ANNAS)), await row.textContent())
  await row.click()
  await wait(page, 1500)
  await shot(page, "34-badges-list")
  check("the list: Im Profil with nine and Anordnen, and what is within reach with progress", (await top(page).getByText("Im Profil", { exact: true }).count()) === 1 && (await top(page).getByRole("button", { name: BADGE_NAMES }).count()) === ANNAS && (await page.getByRole("button", { name: "Anordnen" }).count()) === 1 && (await top(page).getByText("Erreichbar").count()) === 1 && (await top(page).getByText(/1 von 10 Spielen/).count()) === 1)
  check("nothing from strangers: no 'Weitere' row", (await page.getByRole("button", { name: /Weitere erhaltene/ }).count()) === 0)
  const l = await layout(page)
  check("badges list: no ellipsis, no overflow, targets at least 44 pt", noLayoutProblems(l) && l.small.length === 0, JSON.stringify(l))
  // A milestone within reach keeps its progress on its own screen.
  await page.getByRole("button", { name: /^10 Spiele/ }).click()
  await wait(page, 1200)
  await shot(page, "35a-reachable-detail")
  check("a reachable milestone's screen has the progress row", (await top(page).getByText("Fortschritt").count()) === 1 && (await top(page).getByText("1 von 10 Spielen").count()) === 1)
  await back(page)
  await wait(page, 1000)
  await page.getByRole("button", { name: /^Erste 180/ }).click()
  await wait(page, 1200)
  await shot(page, "35-badge-detail-shown")
  check("the detail says self-earned, in the profile, with the game and 'Aus dem Profil nehmen'", (await top(page).getByText("Selbst erreicht").count()) >= 1 && (await top(page).getByText("Im Profil", { exact: true }).count()) === 1 && (await top(page).getByText("Ergebnis").count()) === 1 && (await page.getByRole("button", { name: "Aus dem Profil nehmen" }).count()) === 1)
  await page.getByRole("button", { name: "Aus dem Profil nehmen" }).click()
  await page.getByRole("button", { name: "Im Profil zeigen" }).waitFor({ timeout: 20000 })
  await wait(page, 1200)
  await shot(page, "36-badge-detail-hidden")
  check("an award already published says so instead of warning about game data", (await top(page).getByText(/schon veröffentlicht/).count()) === 1 && (await top(page).getByText(/bleiben privat/).count()) === 0)
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
  await back(page)
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

  // --- A stranger gives Anna a badge: it waits behind one quiet row until she looks ----------
  const issuerSec = "7f".repeat(32)
  const issuerPub = nak(["key", "public", issuerSec])
  nak(["event", "-k", "0", "-c", JSON.stringify({ name: "Dart-Club Blau-Weiß" }), "--sec", issuerSec, ...RELAYS])
  nak(["event", "-k", "30009", "-d", "helfer-clubabend", "-t", "name=Helfer des Clubabends", "-t", "description=Hat beim Clubabend ausgeholfen.", "--sec", issuerSec, ...RELAYS])
  nak(["event", "-k", "8", "-t", `a=30009:${issuerPub}:helfer-clubabend`, "-t", `p=${pubkey}`, "--sec", issuerSec, ...RELAYS])
  await back(page)
  await wait(page, 800)
  await page.getByRole("button", { name: /^Auszeichnungen/ }).click()
  const more = page.getByRole("button", { name: /Weitere erhaltene Auszeichnungen/ })
  await more.waitFor({ timeout: 20000 })
  await wait(page, 800)
  await scrollAll(page)
  await wait(page, 400)
  await shot(page, "50-list-with-stranger-row")
  check("a stranger's award is one quiet row with its count, not under Erreicht", (await more.textContent()).includes("1") && (await top(page).getByText("Helfer des Clubabends").count()) === 0)
  await back(page)
  await wait(page, 1000)
  await scrollAll(page)
  await wait(page, 400)
  check("the Profile row does not count the stranger's award as new", !/neu/.test(await row.textContent()), await row.textContent())
  await row.click()
  await wait(page, 1200)
  await scrollAll(page)
  await wait(page, 300)
  await more.click()
  await wait(page, 1200)
  await shot(page, "51-more-received")
  await page.getByRole("button", { name: /Helfer des Clubabends/ }).click()
  await wait(page, 1500)
  await shot(page, "52-stranger-award-detail")
  check("the stranger's award opens as received, with its issuer, and can be shown", (await top(page).getByText("Erhalten").count()) >= 1 && (await top(page).getByText("Dart-Club Blau-Weiß").count()) === 1 && (await page.getByRole("button", { name: "Im Profil zeigen" }).count()) === 1)
  await page.getByRole("button", { name: "Im Profil zeigen" }).click()
  await page.getByRole("button", { name: "Aus dem Profil nehmen" }).waitFor({ timeout: 20000 })
  await back(page)
  await wait(page, 800)
  await back(page)
  await wait(page, 1200)
  await scrollAll(page)
  await wait(page, 400)
  await shot(page, "53-list-after-vouching")
  check("once shown, the issuer is known: the award is in the profile and the quiet row is gone", (await top(page).getByRole("button", { name: /Helfer des Clubabends/ }).count()) === 1 && (await page.getByRole("button", { name: /Weitere erhaltene/ }).count()) === 0)
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

// --- A correction: Rückgängig on the result after showing, a 40 finish instead of the 121 ------
{
  const { ctx, page, errors } = await open({ seed: nearWin(["Anna", "Ben"]), viewport: { width: 390, height: 844 } })
  await finishSeeded(page)
  await createProfile(page, "Anna", "Anna Schmidt")
  await page.getByRole("button", { name: /Auszeichnung/ }).click()
  await wait(page, 900)
  const sheet = page.getByRole("dialog").last()
  await sheet.getByRole("button", { name: "Im Profil zeigen" }).click()
  await sheet.getByText("Jetzt in deinem Profil.").waitFor({ timeout: 30000 })
  await sheet.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 600)
  // The winning dart was wrong: undo it. Anna throws 1 (49 left), Ben 1 1 1, Anna 9 then D20: a
  // 40 checkout in nine darts, so "Finish ab 100" and "Perfektes Leg" no longer hold.
  await page.locator("[role=dialog] header button").first().click()
  await wait(page, 1000)
  for (const key of ["1", "1", "1", "1", "9", "d", "2", "0"]) {
    await page.keyboard.press(key)
    await wait(page, key === "d" || key === "2" ? 150 : 900)
  }
  await wait(page, 1500)
  await shot(page, "60-result-corrected")
  await page.getByRole("button", { name: /Auszeichnung/ }).click()
  await wait(page, 900)
  await shot(page, "61-sheet-corrected")
  check("after the correction the sheet says the badges are in the profile already and offers nothing", (await sheet.getByText("Schon in deinem Profil.").count()) === 1 && (await sheet.getByRole("button", { name: "Im Profil zeigen" }).count()) === 0)
  await sheet.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 500)
  await page.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 800)
  await tab(page, "Profil")
  await wait(page, 1500)
  await shot(page, "62-profile-card-corrected")
  check("the card's chip of the voided award says the result was corrected", (await page.getByRole("button", { name: /Perfektes Leg/ }).first().textContent()).includes("Ergebnis korrigiert"))
  await scrollAll(page)
  await wait(page, 400)
  await page.getByRole("button", { name: /^Auszeichnungen/ }).click()
  await wait(page, 1500)
  await shot(page, "63-list-corrected")
  const corrected = top(page).getByRole("button", { name: /Ergebnis korrigiert/ })
  check("the list marks the two voided awards under Im Profil and offers both again under Erreichbar", (await corrected.count()) === 2 && (await corrected.allTextContents()).every((s) => /Finish ab 100|Perfektes Leg/.test(s)) && (await top(page).getByRole("button", { name: /Höchstes Finish bisher: 49/ }).count()) === 1, (await corrected.allTextContents()).join(" | "))
  await corrected.filter({ hasText: "Finish ab 100" }).click()
  await wait(page, 1200)
  await shot(page, "64-detail-voided")
  await page.getByRole("button", { name: "Löschung anfragen" }).click()
  await wait(page, 600)
  await page.getByRole("button", { name: "Anfragen" }).click()
  await page.getByText("Löschung angefragt.").waitFor({ timeout: 20000 })
  await wait(page, 800)
  await shot(page, "65-deletion-requested")
  check("after the deletion request the screen keeps the badge and says what happened", (await top(page).getByText("Finish ab 100").count()) >= 1 && (await top(page).getByText(/korrigiert/).count()) >= 1 && (await top(page).getByText("Löschung angefragt.").count()) === 1)
  await back(page)
  await wait(page, 1200)
  check("the deleted award left the list", (await top(page).getByRole("button", { name: /Ergebnis korrigiert/ }).count()) === 1)
  check("no console errors (correction)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

// --- Another phone (320x548): Carla's own card and sheet, then Anna's profile with its chips ---
{
  const { ctx, page, errors } = await open({ seed: nearWin(["Carla", "Dieter"]), viewport: { width: 320, height: 548 } })
  await finishSeeded(page)
  await createProfile(page, "Carla", "Carla")
  await page.getByRole("button", { name: /Auszeichnung/ }).click()
  await wait(page, 900)
  const sheet = page.getByRole("dialog").last()
  await shot(page, "70-sheet-320")
  await sheet.getByRole("button", { name: "Im Profil zeigen" }).click()
  await sheet.getByText("Jetzt in deinem Profil.").waitFor({ timeout: 30000 })
  await shot(page, "71-sheet-shown-320")
  check("320x548: the confirmation is in view without scrolling the list", await inView(sheet.getByText("Jetzt in deinem Profil."), 548))
  await sheet.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 600)
  await page.getByRole("button", { name: "Fertig" }).click()
  await wait(page, 800)

  // Anordnen at 320: names shrink, nothing breaks mid-word.
  await tab(page, "Profil")
  await wait(page, 1500)
  await scrollAll(page)
  await wait(page, 400)
  await page.getByRole("button", { name: /^Auszeichnungen/ }).click()
  await wait(page, 1500)
  await page.getByRole("button", { name: "Anordnen" }).click()
  await wait(page, 1200)
  await shot(page, "72-arrange-320")
  const broken = await page.evaluate(() => [...document.querySelectorAll("ol li span.block")].filter((el) => el.getClientRects().length > 1 && el.textContent.split(" ").every((word) => word.length > 0)).map((el) => el.textContent))
  const la = await layout(page)
  check("320x548 Anordnen: no name is cut or broken mid-word, targets stay 44 pt", noLayoutProblems(la) && la.small.length === 0 && broken.length === 0, `${JSON.stringify(la)} ${broken.join(",")}`)
  await back(page)
  await wait(page, 800)

  // Anna's profile, opened from her link while Carla is signed in: the chips open her badges.
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = RELAYS.join(",")
  const { profileLink } = await import("../../../../../lib/profile/profile-link.ts")
  await page.goto(profileLink(BASE, annaPubkey, RELAYS))
  await wait(page, 4000)
  await shot(page, "73-anna-profile-as-carla")
  // Anna's first three: the club's badge she chose to show, then her two rarest milestones.
  const chips = page.getByRole("button", { name: /^(Helfer des Clubabends|Perfektes Leg|Erste 180|Finish ab 100)/ })
  check("a signed-in viewer sees Anna's three chips", (await chips.count()) === 3, (await chips.allTextContents()).join(","))
  await chips.filter({ hasText: "Perfektes Leg" }).click()
  await wait(page, 2000)
  await shot(page, "74-anna-badge-as-carla")
  check("… and opens one: self-earned, with its condition, no 'nicht bekannt'", (await top(page).getByText("Selbst erreicht").count()) >= 1 && (await top(page).getByText("Bedingung").count()) === 1 && (await top(page).getByText(/nicht bekannt/).count()) === 0)
  check("no console errors (Carla)", errors.length === 0, errors.join(" | "))
  await ctx.close()
}

await done()
