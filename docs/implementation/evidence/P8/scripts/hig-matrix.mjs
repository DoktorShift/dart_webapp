// P8 integrated HIG pass: the app's main surfaces side by side, in German (light) and English
// (dark), at 320x548, 390x844, 568x320, 768x1024 and 1024x768, from the state the evening left on
// Anna's phone (profile, club, tournament, a paid stake) and from an empty guest device. Every
// screenshot gets the layout audit of lib.mjs; each surface is also searched for protocol words.
// The game screen is checked as one fixed screen with 1 to 6 players (the setup's maximum) at the
// small sizes.
//
// Not run by itself: darts-night.mjs calls it at the end of the evening when MATRIX=1, while the
// evening's relays are still up.
import { BASE, OUT, PHONE, SE, SE_LANDSCAPE, TABLET, BOARD, audit, dart as throwDart, device, isOnScreen, onScreen, shot, tab } from "./lib.mjs"

const SIZES = [SE, PHONE, SE_LANDSCAPE, TABLET, BOARD]
const LOOKS = [
  {
    locale: "de", dark: false, tabs: { play: "Spielen", ranks: "Rangliste", clubs: "Clubs", tournaments: "Turniere", profile: "Profil" }, resume: /Weiterspielen/,
    ranks: { device: "Hier gespielt", friends: "Freunde", clubs: "Clubs", tournaments: "Turniere" }, profile: { friends: /Freund/, addFriend: "Freund hinzufügen", stats: "Statistik", training: /^Training/, start: "Training starten", startGame: "Spiel starten", visibility: "Sichtbarkeit", history: /^Spielverlauf/, done: "Fertig", back: /^Zurück zu Profil$/, goal: /^Ziel/, goalSave: "Ziel setzen", cancel: "Abbrechen", share: "Training als Bild teilen" },
  },
  {
    locale: "en", dark: true, tabs: { play: "Play", ranks: "Leaderboard", clubs: "Clubs", tournaments: "Tournaments", profile: "Profile" }, resume: /Continue|Resume/,
    ranks: { device: "Played here", friends: "Friends", clubs: "Clubs", tournaments: "Tournaments" }, profile: { friends: /friend/i, addFriend: "Add friend", stats: "Statistics", training: /^Training/, start: "Start training", startGame: "Start game", visibility: "Visibility", history: /^Game history/, done: "Done", back: /^Back to Profile$/, goal: /^Goal/, goalSave: "Set goal", cancel: "Cancel", share: "Share training as a picture" },
  },
]
// Words of the protocol that never belong in normal flows (NOSTR-DESIGN-RULES.md).
const PROTOCOL = /\b(relay|relays|nostr|npub|nsec|invoice|bolt11|preimage|NWC|NIP-\d+|event|zap request|Schlüssel|private key)\b/i

const dart = (segment, multiplier = 1) => ({ kind: "dart", dart: { segment, multiplier } })
const NAMES = ["Anna", "Ben", "Carla von Testhausen", "Dieter", "Ela Schmidt-Wellenbrink", "Fritz"]
const match = (id, names, throws, extras) => ({
  id,
  startedAt: "2026-10-16T19:00:00.000Z",
  acknowledgedLegs: 0,
  status: "playing",
  config: { modeId: "301", modeName: "301", type: "x01", startScore: 301, doubleOut: true, doubleIn: false, cutThroat: false, bullFinish: false, legsToWin: 1, setsToWin: 1, startRule: "alternate", players: names.map((name, i) => ({ id: `m${i}`, name })), ...(extras ? { extras } : {}) },
  throws,
})
// Anna 50 left with her third dart in hand (the bull wins it); 500 sats at stake.
const nearWin = () => match(`hig-${Math.random().toString(36).slice(2)}`, ["Anna", "Ben"], [dart(20, 3), dart(20, 3), dart(20, 3), dart(1), dart(1), dart(1), dart(20, 3), dart(11)], { "payments.stake": { sats: 500 } })

async function seed(page, current) {
  await page.evaluate((c) => localStorage.setItem("dart-scorer.current-match.v1", c), JSON.stringify(current))
  await page.goto(BASE)
  await page.waitForTimeout(900)
}

// What one screen says in words the player reads, and whether a protocol word is among them.
const words = async (page) => {
  const visible = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => el.children.length === 0 && !el.closest('[inert], [aria-hidden="true"]') && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1)
      .map((el) => el.textContent ?? "")
      .join(" "),
  )
  return visible.match(PROTOCOL)?.[0] ?? null
}

export async function runMatrix({ annaState }) {
  const results = []
  const note = (what, ok, detail = "") => {
    results.push({ what, ok: !!ok, detail })
    if (!ok) console.log(`  NOTE ${what}${detail ? ` (${detail})` : ""}`)
  }
  for (const look of LOOKS) {
    for (const size of SIZES) {
      const tag = `${size.width}x${size.height}-${look.locale}${look.dark ? "-dark" : ""}`
      const d = await device(`m-${tag}`, { viewport: size, locale: look.locale, dark: look.dark, storageState: annaState })
      const { page } = d
      const visit = async (name) => {
        await page.waitForTimeout(900)
        await shot(d, `m-${name}-${tag}`)
        const word = await words(page)
        note(`${tag} ${name}: no protocol word`, word === null, word ?? "")
      }
      try {
      // A game left with "Speichern und verlassen" waits above the tab bar on every other tab
      // (the iOS 26 accessory), one tap from going on.
      await page.goto(BASE)
      await seed(page, { ...match(`hig-paused-${tag}`, NAMES.slice(0, 2), [dart(20, 3), dart(19)]), status: "paused" })
      await tab(page, look.tabs.ranks)
      await visit("ranks-resume")
      // On a phone in landscape the accessory steps aside (no room above the tab bar); the game
      // waits on the Play tab as before.
      const resumeShown = await isOnScreen(page.getByRole("button", { name: look.resume }))
      if (size.height > 500) note(`${tag} ranks-resume: the waiting game is one tap away above the tab bar`, resumeShown)
      else note(`${tag} ranks-resume: in landscape the accessory steps aside`, !resumeShown)
      // The evening left the stake game's result open: start from the Play tab.
      await page.goto(BASE)
      await page.evaluate(() => localStorage.removeItem("dart-scorer.current-match.v1"))
      await page.reload()
      await page.waitForTimeout(1200)
      await visit("play")
      await tab(page, look.tabs.ranks)
      await visit("ranks")
      // The tab's four areas: each says what it counts.
      const ranks = page.locator('[data-tab-panel="leaderboard"]')
      await ranks.getByRole("radio", { name: look.ranks.friends }).click()
      await page.waitForTimeout(1500)
      await visit("ranks-friends")
      await ranks.getByRole("radio", { name: look.ranks.clubs }).click()
      await visit("ranks-clubs")
      await ranks.getByRole("radio", { name: look.ranks.tournaments }).click()
      await visit("ranks-tournaments")
      await ranks.getByRole("radio", { name: look.ranks.device }).click()
      await tab(page, look.tabs.clubs)
      await visit("clubs")
      await (await onScreen(page.getByRole("button", { name: /Dartfreunde Nord/ }))).click()
      await visit("club")
      await tab(page, look.tabs.tournaments)
      await page.waitForTimeout(600)
      // Tapping the tab again returns to its root (iOS behaviour).
      await tab(page, look.tabs.tournaments)
      await visit("tournaments")
      if (await isOnScreen(page.getByRole("button", { name: /Pub Open/ }))) {
        await (await onScreen(page.getByRole("button", { name: /Pub Open/ }))).click()
        await visit("tournament")
      } else note(`${tag}: the finished tournament is listed on the Tournaments tab`, false)
      await tab(page, look.tabs.profile)
      const profile = page.locator('[data-tab-panel="profile"]')
      // Anna has played only against others tonight: one training first (from the card's own
      // button, Anna alone, a 301 in six darts), so the training screen has something to show.
      await page.waitForTimeout(900)
      const startTraining = await onScreen(profile.getByRole("button", { name: look.profile.start, exact: true }), 5_000).catch(() => null)
      if (startTraining) {
        await startTraining.click()
        await (await onScreen(page.getByRole("button", { name: look.profile.startGame, exact: true }))).click()
        await page.getByRole("button", { name: /Spieloptionen|Game options/ }).waitFor({ timeout: 15_000 })
        for (const [s, m] of [[20, 3], [20, 3], [20, 3], [20, 3], [11, 3], [14, 2]]) await throwDart(page, s, m)
        await (await onScreen(page.getByRole("button", { name: look.profile.done, exact: true }), 20_000)).click()
        await page.waitForTimeout(800)
        await tab(page, look.tabs.profile)
      }
      await visit("profile")
      // The profile's own screens: statistics with a figure and its "before", the training as
      // growth over time, the visibility choice, and the history export sheet.
      const back = async () => {
        await (await onScreen(page.getByRole("button", { name: look.profile.back }))).click()
        await page.waitForTimeout(500)
      }
      await (await onScreen(profile.getByRole("button", { name: look.profile.stats, exact: true }))).click()
      await visit("profile-stats")
      await back()
      // Friends: the list (Ben since tonight) and the sheet that adds one.
      await (await onScreen(profile.getByRole("button", { name: look.profile.friends }))).click()
      await visit("profile-friends")
      await (await onScreen(page.getByRole("button", { name: look.profile.addFriend }).first())).click()
      await visit("profile-friends-add")
      await (await onScreen(page.getByRole("button", { name: look.profile.done, exact: true }))).click()
      await page.waitForTimeout(400)
      await back()
      await (await onScreen(profile.getByRole("button", { name: look.profile.training }).first())).click()
      // The goal (M18): set to 60 from its sheet, then the screen with the line through the chart,
      // and "Teilen" in the bar.
      await (await onScreen(profile.getByRole("button", { name: look.profile.goal }))).click()
      await page.getByRole("dialog").getByRole("textbox").fill("60")
      await page.waitForTimeout(500)
      await shot(d, `m-profile-training-goal-${tag}`)
      await page.getByRole("button", { name: look.profile.goalSave, exact: true }).click()
      await page.waitForTimeout(600)
      // Back to the top: the shot is the screen as it opens, chart first.
      await page.evaluate(() => document.querySelectorAll("[data-scroll-container]").forEach((el) => el.scrollTo(0, 0)))
      await visit("profile-training")
      note(`${tag} profile-training: the goal row shows 60`, (await page.getByRole("button", { name: /^(Ziel|Goal)\b.*60/ }).count()) >= 1)
      // The chart needs a month with enough trainings; the evening's import gives October three.
      note(`${tag} profile-training: the goal line is in the chart`, (await page.getByText(/^(Ziel|Goal) 60/).count()) >= 1)
      note(`${tag} profile-training: Teilen in the bar`, await isOnScreen(page.getByRole("button", { name: look.profile.share, exact: true })))
      // The picture before it goes anywhere (M17): the sheet with the drawn card, then cancel.
      await page.getByRole("button", { name: look.profile.share, exact: true }).click()
      await page.getByRole("dialog").locator("img").waitFor({ timeout: 15_000 })
      await page.waitForTimeout(500)
      await shot(d, `m-profile-share-${tag}`)
      note(`${tag} profile-share: the picture is shown before sharing`, (await page.getByRole("dialog").locator("img").count()) === 1)
      await (await onScreen(page.getByRole("button", { name: look.profile.cancel, exact: true }))).click()
      await page.waitForTimeout(500)
      await back()
      await (await onScreen(profile.getByRole("button", { name: look.profile.visibility }))).click()
      await visit("profile-visibility")
      await back()
      await (await onScreen(profile.getByRole("button", { name: look.profile.history }))).click()
      await page.waitForTimeout(700)
      await shot(d, `m-profile-history-${tag}`)
      // The import's preview (M16) from the evening's table, then back without importing.
      await page.locator('input[type="file"]').last().setInputFiles(new URL("../fixtures/spielverlauf.csv", import.meta.url).pathname)
      await page.waitForTimeout(900)
      await shot(d, `m-profile-import-${tag}`)
      note(`${tag} profile-import: the preview asks which name is you`, await isOnScreen(page.getByRole("radiogroup")))
      await (await onScreen(page.getByRole("button", { name: look.profile.cancel, exact: true }))).click()
      await page.waitForTimeout(400)
      await (await onScreen(page.getByRole("button", { name: look.profile.done, exact: true }))).click()
      await page.waitForTimeout(400)

      // The result with several pieces: the stake, the badges, the club or offer rows.
      await tab(page, look.tabs.play)
      await seed(page, nearWin())
      if (await isOnScreen(page.getByRole("button", { name: look.resume }))) await (await onScreen(page.getByRole("button", { name: look.resume }))).click()
      await page.getByRole("button", { name: /Spieloptionen|Game options/ }).waitFor({ timeout: 15_000 })
      await page.waitForTimeout(500)
      await page.keyboard.press("b")
      await page.waitForTimeout(2500)
      await visit("result")
      const resultFits = await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1)
      note(`${tag} result: one screen, no page scroll`, resultFits)
      // The stake row's two marks must not run into its words.
      const overlap = await page.evaluate(() => {
        const row = [...document.querySelectorAll("button")].find((b) => /500 sats/.test(b.textContent ?? "") && b.getBoundingClientRect().width > 0)
        const signet = row?.querySelector("span.inline-flex")
        const label = row && [...row.querySelectorAll("span")].find((s) => /500 sats/.test(s.textContent ?? "") && s !== signet)
        if (!signet || !label) return null
        const imgs = [...signet.querySelectorAll("img")].map((i) => i.getBoundingClientRect().right)
        return { signetRight: Math.round(Math.max(...imgs)), labelLeft: Math.round(label.getBoundingClientRect().left) }
      })
      if (overlap) note(`${tag} result: the stake row's signet stays clear of its label`, overlap.signetRight <= overlap.labelLeft, JSON.stringify(overlap))

      // The game screen as one fixed screen with every player count (small sizes only).
      if (size.height <= 548 || size === PHONE) {
        for (let n = 1; n <= NAMES.length; n++) {
          await seed(page, match(`hig-n${n}-${tag}`, NAMES.slice(0, n), [dart(20, 3), dart(19)]))
          if (await isOnScreen(page.getByRole("button", { name: look.resume }))) await (await onScreen(page.getByRole("button", { name: look.resume }))).click()
          await page.getByRole("button", { name: /Spieloptionen|Game options/ }).waitFor({ timeout: 15_000 })
          await page.waitForTimeout(700)
          if (n === 2 || n === NAMES.length) await shot(d, `m-game-${n}p-${tag}`)
          const state = await page.evaluate((names) => {
            const body = document.body.innerText
            const keys = [...document.querySelectorAll("button")].filter((b) => /^(20|Bull|25|Double|Triple)$/.test((b.textContent ?? "").trim()))
            return {
              scroll: document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1,
              names: names.every((name) => body.includes(name)),
              keys: keys.length > 0 && keys.every((k) => { const r = k.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.height >= 43.5 }),
            }
          }, NAMES.slice(0, n))
          const a = await audit(page)
          note(`${tag} game, ${n} player${n === 1 ? "" : "s"}: one fixed screen, every name whole, keys in view and 44 pt`, !state.scroll && state.names && state.keys && a.ellipsis.length === 0 && a.dots.length === 0, JSON.stringify({ ...state, ellipsis: a.ellipsis, dots: a.dots }))
          // Leave the game for the next count.
          await page.evaluate(() => localStorage.removeItem("dart-scorer.current-match.v1"))
        }
      }
      } catch (error) {
        note(`${tag}: the pass went through`, false, String(error?.message ?? error).split("\n")[0].slice(0, 160))
        await page.screenshot({ path: `${OUT}/fail-m-${tag}.jpg`, type: "jpeg", quality: 60 }).catch(() => {})
      }
      await d.ctx.close()
    }

    // An empty device: the guest's empty states.
    for (const size of [SE, PHONE]) {
      const tag = `${size.width}x${size.height}-${look.locale}${look.dark ? "-dark" : ""}`
      const d = await device(`e-${tag}`, { viewport: size, locale: look.locale, dark: look.dark })
      const { page } = d
      await page.goto(BASE)
      await page.waitForTimeout(1000)
      for (const [key, name] of [["ranks", look.tabs.ranks], ["clubs", look.tabs.clubs], ["tournaments", look.tabs.tournaments], ["profile", look.tabs.profile]]) {
        await tab(page, name)
        await page.waitForTimeout(1000)
        await shot(d, `e-${key}-${tag}`)
        const word = await words(page)
        note(`${tag} empty ${key}: no protocol word`, word === null, word ?? "")
      }
      // Offline: what the guest's Clubs tab says without a connection.
      await d.ctx.setOffline(true)
      await tab(page, look.tabs.clubs)
      await page.waitForTimeout(400)
      const discover = page.getByRole("button", { name: /Öffentliche Clubs|Public clubs/ })
      if (await isOnScreen(discover)) {
        await (await onScreen(discover)).click()
        await page.waitForTimeout(6000)
        await shot(d, `e-clubs-offline-${tag}`)
        note(`${tag} offline public clubs: a next step is offered`, await isOnScreen(page.getByRole("button", { name: /Erneut versuchen|Try again|Retry/ })))
      }
      await d.ctx.close()
    }
  }
  return results
}

