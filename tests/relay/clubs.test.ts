// Clubs against real relays (two "nak serve" on 127.0.0.1, P5.01/P5.02): every step is signed by
// the person's own key and read back by the others from the relays, each on a fresh device (new
// storage, own key), as if they opened the app on their phone. Nothing touches a public relay.
// Run: npm run test:relay
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "../storage-helpers.ts"
import { runNak, startRelay, type NakRelay } from "../support/nak.ts"
import { relayClient } from "../../lib/nostr/client.ts"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import type { Throw } from "../../lib/game/types.ts"
import { clubTasks } from "../../lib/clubs/club.ts"
import { answerDate, cancelDate, CALENDAR_TIME_KIND, repeatDates, saveDates } from "../../lib/clubs/dates.ts"
import { answerGame, correctGame, gameSeats, recordGame, type FinishedGame } from "../../lib/clubs/games.ts"
import { acceptInvitation, invitationState, openInvitation } from "../../lib/clubs/invitation.ts"
import { clubLink, readClubPayload } from "../../lib/clubs/links.ts"
import { acceptOwnership, acceptRequest, createInvite, foundClub, offerOwnership, removeMember, setRole, updateInfo } from "../../lib/clubs/membership.ts"
import { createSeason, DEFAULT_RULES } from "../../lib/clubs/seasons.ts"
import { loadStoredClub } from "../../lib/clubs/store.ts"
import { refreshClub, type Reader } from "../../lib/clubs/sync.ts"
import { seasonTable } from "../../lib/clubs/table.ts"
import { getSigner, importLocalKey, signOut } from "../../lib/profile/session.ts"

let core: Core
let a: NakRelay
let b: NakRelay
const SITE = "https://blueline21.netlify.app"

before(async () => {
  core = await loadCore()
  ;[a, b] = await Promise.all([startRelay(), startRelay()])
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `${a.url},${b.url}`
})

after(async () => {
  await signOut({ keepLocalData: true })
  relayClient().close()
  await Promise.all([a?.stop(), b?.stop()])
})

const person = () => {
  const secret = core.generateSecretKey()
  return { secret, pubkey: core.getPublicKey(secret) }
}
type Person = ReturnType<typeof person>

// Opens the app on this person's own device: empty storage, their key.
async function device(who: Person): Promise<Reader & { pubkey: string; signer: NonNullable<Reader["signer"]> }> {
  await signOut({ keepLocalData: true })
  await resetStorage()
  await importLocalKey(who.secret)
  return { pubkey: who.pubkey, signer: await getSigner() }
}

async function opened(club: string, who: Person) {
  const view = await refreshClub(club, await device(who))
  assert.ok(view.state, "the club's records open")
  return view
}

async function viaLink(link: string, who: Person) {
  const author = await device(who)
  const address = readClubPayload(link.split("#club=")[1])
  assert.ok(address?.invite)
  assert.equal(await openInvitation({ ...address, invite: address.invite }), null)
  return { address, author }
}

test("a closed club: a member joins through a group link while no leader is online, and reads everything once a leader's device shared access", async () => {
  const owner = person()
  const ben = person()
  let author = await device(owner)
  const club = await foundClub({ name: "Dartfreunde Nord", about: "Donnerstags im Vereinsheim", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  assert.equal(view.state?.info.name, "Dartfreunde Nord")
  const invite = await createInvite(view.state!, { kind: "group", days: 7, hostName: "Olaf" }, author)
  assert.ok(invite.sent.published)
  const link = clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] })
  // Outsiders see nothing but ids: the founding and the invite are sealed.
  const raw = await relayClient().query([{ ids: [club, invite.invite] }], [a.url])
  assert.ok(raw.events.every((e) => !e.content.includes("Dartfreunde")))

  // Ben opens the link: the preview shows before any profile is needed, then he joins.
  const joining = await viaLink(link, ben)
  view = await refreshClub(club, joining.author)
  assert.equal(view.info?.name, "Dartfreunde Nord")
  assert.equal(view.invite?.preview?.hostName, "Olaf")
  assert.equal(invitationState(view, Math.floor(Date.now() / 1000)), "open")
  await acceptInvitation(club, joining.author)
  view = await refreshClub(club, joining.author)
  assert.equal(view.me.status, "joined", "joined, waiting for a leader's device")
  assert.equal(view.state, null)

  // The owner opens the app: Ben is a member through the link's proof, and the owner's device
  // shares access to everything written before he joined.
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.equal(view.state?.members[ben.pubkey]?.via, "group")
  assert.equal(view.state?.shares.length, 1)

  view = await opened(club, ben)
  assert.equal(view.me.status, "member")
  assert.equal(view.state?.info.about, "Donnerstags im Vereinsheim")
})

test("over capacity: a group link only asks, and a leader can't accept past the limit", async () => {
  const owner = person()
  const [ben, carl] = [person(), person()]
  let author = await device(owner)
  const club = await foundClub({ name: "Kleiner Kreis", visibility: "public" }, author)
  let view = await refreshClub(club, author)
  await updateInfo(view.state!, { capacity: 2 }, author)
  view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  const link = clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] })
  for (const who of [ben, carl]) {
    const joining = await viaLink(link, who)
    view = await refreshClub(club, joining.author)
    assert.equal(invitationState(view, Math.floor(Date.now() / 1000)), "request")
    await acceptInvitation(club, joining.author)
    view = await refreshClub(club, joining.author)
    assert.equal(view.me.status, "request")
  }
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.deepEqual(clubTasks(view, Math.floor(Date.now() / 1000)).map((t) => t.kind), ["requests"])
  await acceptRequest(view.state!, view.state!.requests[ben.pubkey], author)
  view = await refreshClub(club, author)
  await acceptRequest(view.state!, view.state!.requests[carl.pubkey], author)
  view = await refreshClub(club, author)
  assert.equal(view.state?.members[ben.pubkey]?.role, "member")
  assert.equal(view.state?.members[carl.pubkey], undefined)
  assert.equal(view.state?.log.rejected.at(-1)?.reason, "club_full")
})

test("a removed member reads nothing written after the removal; the club and its games stay readable for the others", async () => {
  const owner = person()
  const [ben, carl] = [person(), person()]
  let author = await device(owner)
  const club = await foundClub({ name: "Geschlossene Gesellschaft", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  const link = clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] })
  for (const who of [ben, carl]) await acceptInvitation(club, (await viaLink(link, who)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.equal(Object.keys(view.state!.members).length, 3)

  await removeMember(view.state!, ben.pubkey, author, "Ausgetreten im Streit")
  view = await refreshClub(club, author)
  await updateInfo(view.state!, { name: "Neuer Name" }, author)
  view = await refreshClub(club, author)
  await saveDates(view.state!, [{ title: "Clubabend", starts: Math.floor(Date.now() / 1000) + 86400 }], author)

  view = await refreshClub(club, await device(ben))
  assert.equal(view.me.status, "removed")
  assert.equal(view.me.former?.reason, "Ausgetreten im Streit")
  assert.equal(view.state?.info.name, "Geschlossene Gesellschaft", "the rename was sealed for the remaining members only")
  assert.deepEqual(view.dates, [])
  const stored = await loadStoredClub(club)
  const unread = stored!.events.filter((e) => !(e.id in stored!.keys) && e.tags.some((t) => t[0] === "enc"))
  assert.ok(unread.length >= 2, "the new records stay closed to him")

  const carlsPhone = await device(carl)
  view = await refreshClub(club, carlsPhone)
  assert.equal(view.state?.info.name, "Neuer Name")
  assert.equal(view.dates[0]?.title, "Clubabend")
  // Carl answers; the owner sees it.
  await answerDate(view.state!, view.dates[0], "yes", carlsPhone)
  view = await opened(club, owner)
  assert.equal(view.dates[0].answers[carl.pubkey]?.answer, "yes")
})

test("the hand-over of ownership keeps the club's id and makes the former owner an admin", async () => {
  const owner = person()
  const alice = person()
  let author = await device(owner)
  const club = await foundClub({ name: "Übergabe", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "personal", days: 7, label: "Für Alice" }, author)
  const link = clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] })
  await acceptInvitation(club, (await viaLink(link, alice)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  await acceptRequest(view.state!, view.state!.requests[alice.pubkey], author)
  view = await refreshClub(club, author)
  await setRole(view.state!, alice.pubkey, "admin", author)
  view = await refreshClub(club, author)
  await offerOwnership(view.state!, alice.pubkey, author)

  author = await device(alice)
  view = await refreshClub(club, author)
  assert.deepEqual(clubTasks(view, Math.floor(Date.now() / 1000)).map((t) => t.kind)[0], "ownership")
  await acceptOwnership(view.state!, author)
  view = await refreshClub(club, author)
  assert.equal(view.id, club)
  assert.equal(view.state?.owner, alice.pubkey)

  view = await opened(club, owner)
  assert.equal(view.state?.owner, alice.pubkey)
  assert.equal(view.me.role, "admin")
})

const config = (names: string[]) => ({
  modeId: "501",
  modeName: "501",
  type: "x01" as const,
  startScore: 501,
  doubleOut: true,
  doubleIn: false,
  cutThroat: false,
  bullFinish: false,
  legsToWin: 1,
  setsToWin: 1,
  startRule: "alternate" as const,
  players: names.map((name, i) => ({ id: `s${i}`, name })),
})
const visits = (...totals: number[]): Throw[] => totals.map((total, i) => ({ kind: "visit", total, darts: 3, ...(i === totals.length - 1 ? { atDouble: 1 } : {}) }))

test("a season table follows the games: a confirmed result counts, a correction recounts it, a closed club's games are private", async () => {
  const owner = person()
  const ben = person()
  let author = await device(owner)
  const club = await foundClub({ name: "Liga", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  await acceptInvitation(club, (await viaLink(clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] }), ben)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  await createSeason(view.state!, { name: "Herbst", starts: Math.floor(Date.now() / 1000) - 60, rules: { ...DEFAULT_RULES, confirmations: "opponent" } }, author)
  view = await refreshClub(club, author)

  const seats = [{ name: "Olaf", pubkey: owner.pubkey }, { name: "Ben", pubkey: ben.pubkey }, { name: "Mia" }]
  const won: FinishedGame = { config: config(["Olaf", "Ben", "Mia"]), seats, winner: 0, throws: visits(180, 60, 60, 180, 60, 60, 141) }
  const recorded = await recordGame(view.state!, won, gameSeats(seats, "closed", (n) => `Gast ${n}`), author)
  const raw = await relayClient().query([{ ids: [recorded.match] }], [a.url])
  assert.ok(!raw.events[0].content.includes("Ben"), "the match is private: its agreement is encrypted")

  view = await refreshClub(club, author)
  const season = Object.values(view.state!.seasons)[0]
  let table = seasonTable(season, view.games)
  assert.deepEqual(table.open.map((o) => o.why), ["confirmations"])

  author = await device(ben)
  view = await refreshClub(club, author)
  assert.equal(view.games[0].agreement.seats[2].alias, "Mia", "a guest's name stays inside the club")
  assert.deepEqual(clubTasks(view, Math.floor(Date.now() / 1000)).map((t) => t.kind), ["verdict"])
  await answerGame(view.state!, view.games[0], "confirm", author)
  view = await refreshClub(club, author)
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games)
  assert.deepEqual(table.ranked.map((r) => [r.pubkey, r.points]), [[owner.pubkey, 2], [ben.pubkey, 0]])

  // The host corrects the result: Ben won. The old confirmation lapses until Ben confirms again.
  author = await device(owner)
  view = await refreshClub(club, author)
  await correctGame(view.state!, view.games[0], { ...won, winner: 1, throws: visits(60, 180, 60, 60, 180, 60, 60, 141) }, "Falsch eingetragen", author)
  author = await device(ben)
  view = await refreshClub(club, author)
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games)
  assert.deepEqual(table.counted, [])
  await answerGame(view.state!, view.games[0], "confirm", author)
  view = await refreshClub(club, author)
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games)
  assert.deepEqual(table.ranked.map((r) => [r.pubkey, r.points]), [[ben.pubkey, 2], [owner.pubkey, 0]])
})

test("a public club's dates are calendar events other apps read; members answer, a cancellation shows", async () => {
  const owner = person()
  const ben = person()
  let author = await device(owner)
  const club = await foundClub({ name: "Offene Runde", visibility: "public" }, author)
  let view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  await acceptInvitation(club, (await viaLink(clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] }), ben)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  const first = Math.floor(Date.now() / 1000) + 86400
  await saveDates(view.state!, repeatDates({ title: "Clubabend", starts: first, ends: first + 3 * 3600, place: "Vereinsheim" }, 7, 3), author)
  const calendar = await relayClient().query([{ kinds: [CALENDAR_TIME_KIND], "#e": [club] }], [a.url])
  assert.equal(calendar.events.length, 3)
  assert.equal(await runNak(["verify"], { input: `${calendar.events.map((e) => JSON.stringify(e)).join("\n")}\n` }), "")
  assert.deepEqual(calendar.events.map((e) => e.tags.find((t) => t[0] === "title")?.[1]), ["Clubabend", "Clubabend", "Clubabend"])

  const phone = await device(ben)
  view = await refreshClub(club, phone)
  assert.deepEqual(view.dates.map((d) => d.starts), [first, first + 7 * 86400, first + 14 * 86400])
  await answerDate(view.state!, view.dates[0], "maybe", phone)
  view = await refreshClub(club, phone)
  await answerDate(view.state!, view.dates[0], "yes", phone)

  author = await device(owner)
  view = await refreshClub(club, author)
  assert.equal(view.dates[0].answers[ben.pubkey]?.answer, "yes", "the newest answer counts")
  await cancelDate(view.state!, view.dates[1], author)
  view = await refreshClub(club, author)
  assert.deepEqual(view.dates.map((d) => d.cancelled), [false, true, false])
})
