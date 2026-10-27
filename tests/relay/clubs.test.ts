// Clubs against real relays (two "nak serve" on 127.0.0.1, P5.01/P5.02): every step is signed by
// the person's own key and read back by the others from the relays, each on a fresh device (new
// storage, own key), as if they opened the app on their phone. Everything leaves through the
// outbox of lib/sync, resumed here as the app does at its start. Nothing touches a public relay.
// Run: npm run test:relay
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { resetStorage } from "../storage-helpers.ts"
import { runNak, startRelay, type NakRelay } from "../support/nak.ts"
import { relayClient } from "../../lib/nostr/client.ts"
import { loadCore, type Core } from "../../lib/nostr/core.ts"
import type { Throw } from "../../lib/game/types.ts"
import { clubTasks } from "../../lib/clubs/club.ts"
import { answerDate, cancelDate, repeatDates, saveDates } from "../../lib/clubs/dates.ts"
import { KIND_CALENDAR_TIME } from "../../lib/protocol/kinds.ts"
import { answerGame, confirmedCopies, correctGame, gameSeats, recordGame, recordedGame, type FinishedGame } from "../../lib/clubs/games.ts"
import { findInviteByCode } from "../../lib/clubs/codes.ts"
import { acceptInvitation, invitationState, openInvitation } from "../../lib/clubs/invitation.ts"
import { sendInvitation, watchInvitations } from "../../lib/clubs/invitations.ts"
import { startInbox, stopInbox } from "../../lib/profile/inbox.ts"
import { clubLink, readClubPayload } from "../../lib/clubs/links.ts"
import { acceptOwnership, acceptRequest, createInvite, foundClub, isConfirmedMember, offerOwnership, openOffer, removeMember, setRole, updateInfo } from "../../lib/clubs/membership.ts"
import { createSeason, decideResult, DEFAULT_RULES } from "../../lib/clubs/seasons.ts"
import { loadStoredClub } from "../../lib/clubs/store.ts"
import { refreshClub, type Reader } from "../../lib/clubs/sync.ts"
import { seasonTable } from "../../lib/clubs/table.ts"
import { keepCopies } from "../../lib/live/copy.ts"
import { addProfilePlayer } from "../../lib/profile/claim.ts"
import { getSigner, importLocalKey, signOut } from "../../lib/profile/session.ts"
import { formatInviteCode } from "../../lib/protocol/invite.ts"
import { parseEnvelope, wrapsFor } from "../../lib/protocol/seal.ts"
import { readLabels } from "../../lib/protocol/tags.ts"
import { loadArchive } from "../../lib/storage/archive.ts"
import { listPlayers } from "../../lib/storage/players.ts"
import { profileRecords } from "../../lib/sync/history.ts"
import { pendingEvents, resumeOutbox } from "../../lib/sync/outbox.ts"

let core: Core
let a: NakRelay
let b: NakRelay
const SITE = "https://blueline21.netlify.app"
const now = () => Math.floor(Date.now() / 1000)

before(async () => {
  core = await loadCore()
  // Free ports, one after the other (a free port is only free until something listens on it),
  // from NAK_PORT_RANGE on a shared machine (tests/support/nak.ts).
  a = await startRelay()
  b = await startRelay()
  process.env.NEXT_PUBLIC_BLUELINE_RELAYS = `${a.url},${b.url}`
  await resumeOutbox()
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

// Waits until the outbox has put every change on relays of two operators, as a phone does in the
// background before it is put away.
async function sent() {
  const until = Date.now() + 15_000
  while ((await pendingEvents(() => true)).length > 0) {
    if (Date.now() > until) assert.fail("changes still waiting in the outbox")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

// Opens the app on this person's own device: empty storage, their key (which signs by itself).
// The device before has sent its changes.
async function device(who: Person): Promise<Reader & { pubkey: string; signer: NonNullable<Reader["signer"]> }> {
  await sent()
  await signOut({ keepLocalData: true })
  await resetStorage()
  await importLocalKey(who.secret)
  return { pubkey: who.pubkey, signer: await getSigner(), automatic: true }
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
  assert.equal(await openInvitation({ ...address, invite: address.invite }, author.pubkey), null)
  return { address, author }
}

const keyShares = async (club: string) => (await loadStoredClub(club))!.events.filter((e) => readLabels(e.tags)?.type === "club.keys").map((e) => parseEnvelope(e.content))

test("a closed club: a member joins through a group link while no leader is online, and reads everything once a leader's device shared access with them alone", async () => {
  const owner = person()
  const ben = person()
  const carl = person()
  let author = await device(owner)
  const club = await foundClub({ name: "Dartfreunde Nord", about: "Donnerstags im Vereinsheim", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  assert.equal(view.state?.info.name, "Dartfreunde Nord")
  const invite = await createInvite(view.state!, { kind: "group", days: 7, hostName: "Olaf" }, author)
  const link = clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] })
  // Both relays have the founding and the invite; outsiders see nothing but ids: both are sealed.
  await sent()
  for (const relay of [a, b]) {
    const raw = await relayClient().query([{ ids: [club, invite.invite] }], [relay.url])
    assert.equal(raw.events.length, 2)
    assert.ok(raw.events.every((e) => !e.content.includes("Dartfreunde")))
  }

  // Ben opens the link: the preview shows before any profile is needed, then he joins.
  const joining = await viaLink(link, ben)
  view = await refreshClub(club, joining.author)
  assert.equal(view.info?.name, "Dartfreunde Nord")
  assert.equal(view.invite?.preview?.hostName, "Olaf")
  assert.equal(invitationState(view, now()), "open")
  await acceptInvitation(club, joining.author)
  view = await refreshClub(club, joining.author)
  assert.equal(view.me.status, "joined", "joined, waiting for a leader's device")
  assert.equal(view.state, null)

  // The owner opens the app: Ben is a member through the link's proof, and the owner's device
  // shares access to everything written before he joined, sealed for him alone.
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.equal(view.state?.members[ben.pubkey]?.via, "group")
  assert.equal(view.state?.shares.length, 1)
  assert.deepEqual(view.access, [])
  let shares = await keyShares(club)
  assert.equal(shares[0].wraps.length, 1)
  assert.equal(wrapsFor(shares[0], ben.pubkey).length, 1)

  view = await opened(club, ben)
  assert.equal(view.me.status, "member")
  assert.equal(view.state?.info.about, "Donnerstags im Vereinsheim")

  // Carl joins the same way: the next share is for him only; Ben keeps reading.
  await acceptInvitation(club, (await viaLink(link, carl)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  shares = await keyShares(club)
  assert.equal(shares.length, 2)
  assert.equal(shares[1].wraps.length, 1)
  assert.equal(wrapsFor(shares[1], carl.pubkey).length, 1)
  assert.equal((await opened(club, carl)).state?.info.name, "Dartfreunde Nord")
  assert.equal((await opened(club, ben)).state?.members[carl.pubkey]?.role, "member")
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
    assert.equal(invitationState(view, now()), "request")
    await acceptInvitation(club, joining.author)
    view = await refreshClub(club, joining.author)
    assert.equal(view.me.status, "request")
  }
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.deepEqual(clubTasks(view, now()).map((t) => t.kind), ["requests"])
  await acceptRequest(view.state!, view.state!.requests[ben.pubkey], author)
  view = await refreshClub(club, author)
  await acceptRequest(view.state!, view.state!.requests[carl.pubkey], author)
  view = await refreshClub(club, author)
  assert.equal(view.state?.members[ben.pubkey]?.role, "member")
  assert.equal(view.state?.members[carl.pubkey], undefined)
  assert.equal(view.state?.log.rejected.at(-1)?.reason, "club_full")
})

test("members may invite: a member's link carries a code to say aloud, the typed code opens the same invitation, the joining waits for a leader, and the leader's device holds the link's secret too", async () => {
  const owner = person()
  const [ben, carl] = [person(), person()]
  let author = await device(owner)
  const club = await foundClub({ name: "Dartfreunde Süd", visibility: "closed", membersInvite: true }, author)
  let view = await refreshClub(club, author)
  assert.equal(view.state?.info.membersInvite, true)
  const first = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  await acceptInvitation(club, (await viaLink(clubLink(SITE, { club, invite: { id: first.invite, token: first.token }, relays: [] }), ben)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.equal(view.state?.members[ben.pubkey]?.role, "member")

  // Ben, a member, makes a group link: it comes with a code, and the record admits nobody by
  // itself (maker "member").
  view = await opened(club, ben)
  const made = await createInvite(view.state!, { kind: "group", days: 7, hostName: "Ben" }, await device(ben))
  assert.match(made.code ?? "", /^[A-HJ-NP-Z2-9]{8}$/)
  assert.match(formatInviteCode(made.code!), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  await sent()
  view = await refreshClub(club, await device(ben))
  assert.equal(view.state?.invites[made.invite]?.maker, "member")
  assert.equal(view.codes[made.invite], made.code)

  // The relays hold the code's lookup, never the code: the tag opens with the code alone.
  const raw = await relayClient().query([{ ids: [made.invite] }], [a.url])
  const tag = raw.events[0]?.tags.find((t) => t[0] === "c")
  assert.ok(tag && tag[1].length === 32 && !JSON.stringify(raw.events[0]).includes(made.code!))

  // Carl types the code (lower case, with the hyphen): the same invitation, and it only asks.
  const found = await findInviteByCode(formatInviteCode(made.code!).toLowerCase())
  assert.ok("address" in found, "the code finds the invitation")
  assert.equal(found.address.club, club)
  assert.equal(found.address.invite.id, made.invite)
  assert.equal(found.address.invite.token, made.token)
  assert.deepEqual(await findInviteByCode("ABCD-EFG"), { problem: "malformed" })
  assert.deepEqual(await findInviteByCode("ZZZZ-ZZZZ"), { problem: "missing" })
  const carlsDevice = await device(carl)
  assert.equal(await openInvitation(found.address, carl.pubkey), null)
  view = await refreshClub(club, carlsDevice)
  assert.equal(view.invite?.preview?.hostName, "Ben")
  assert.equal(invitationState(view, now()), "request")
  await acceptInvitation(club, carlsDevice)
  view = await refreshClub(club, carlsDevice)
  assert.equal(view.me.status, "request")

  // Ben's device never learns the owner's link (club.md: a leader's link admits at once, a
  // member's only asks); the access grant he got carries no link secrets.
  const bensView = await refreshClub(club, await device(ben))
  assert.equal(bensView.tokens[first.invite], undefined)
  assert.equal(bensView.codes[first.invite], undefined)

  // The owner's device: the request names Ben's invitation, and the link's secret and code are
  // here too, shared sealed by Ben's device (M12), so the owner can show the same code.
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.equal(view.state?.requests[carl.pubkey]?.invite, made.invite)
  assert.equal(view.state?.invites[made.invite]?.by, ben.pubkey)
  assert.equal(view.tokens[made.invite], made.token)
  assert.equal(view.codes[made.invite], made.code)
  await acceptRequest(view.state!, view.state!.requests[carl.pubkey], author)
  view = await refreshClub(club, author)
  assert.equal(view.state?.members[carl.pubkey]?.role, "member")

  // Switching the rule off ends members' links; the owner's own link stays.
  await updateInfo(view.state!, { membersInvite: false }, author)
  view = await refreshClub(club, author)
  assert.equal(view.state?.invites[made.invite]?.ended, "members_off")
  assert.equal(view.state?.invites[first.invite]?.ended, null)
  assert.deepEqual(await findInviteByCode(made.code!).then((r) => ("problem" in r ? r.problem : "found")), "found", "the record is still on the relays; the state says it ended")
  view = await refreshClub(club, await device(ben))
  assert.equal(view.state?.info.membersInvite, false)
})

test("an invitation sent straight to a profile arrives gift-wrapped and opens under the player's clubs by itself", async () => {
  const owner = person()
  const dana = person()
  const author = await device(owner)
  const club = await foundClub({ name: "Dartfreunde West", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  const made = await createInvite(view.state!, { kind: "personal", days: 7, label: "Dana", hostName: "Olaf" }, author)
  view = await refreshClub(club, author)
  const delivery = await sendInvitation(view.state!, { invite: made.invite, token: made.token }, { pubkey: dana.pubkey, relays: [] }, { relays: [], hostName: "Olaf" }, author)
  assert.equal(delivery.published, true)
  // Relays see a gift wrap for Dana: no club, no sender, no label of ours.
  const wraps = await relayClient().query([{ kinds: [1059], "#p": [dana.pubkey] }], [a.url])
  assert.equal(wraps.events.length, 1)
  assert.ok(!JSON.stringify(wraps.events[0]).includes(club) && !JSON.stringify(wraps.events[0]).includes(owner.pubkey))

  // Dana's device opens the app: the invitation is opened like a scanned link.
  const danasDevice = await device(dana)
  const arrived = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the invitation did not arrive")), 15_000)
    const stop = watchInvitations((opened) => {
      clearTimeout(timer)
      stop()
      stopInbox()
      resolve(opened)
    })
    startInbox({ pubkey: dana.pubkey, signer: danasDevice.signer })
  })
  assert.equal(arrived, club)
  view = await refreshClub(club, danasDevice)
  assert.equal(view.invite?.invite, made.invite)
  assert.equal(view.invite?.preview?.hostName, "Olaf")
  // A personal invitation asks a leader to confirm the person (club.md); the closed club's
  // records are not open yet, and still the device says what the join means.
  assert.equal(invitationState(view, now()), "request")
  await acceptInvitation(club, danasDevice)
  view = await refreshClub(club, danasDevice)
  assert.equal(view.me.status, "request")
})

test("a closed club with a member limit says so in the link's preview: the group link only asks", async () => {
  const owner = person()
  const ben = person()
  const author = await device(owner)
  const club = await foundClub({ name: "Begrenzt", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  await updateInfo(view.state!, { capacity: 5 }, author)
  view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  const joining = await viaLink(clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] }), ben)
  view = await refreshClub(club, joining.author)
  assert.equal(view.state, null, "nothing of the club opens before joining")
  assert.equal(view.invite?.preview?.limited, true)
  assert.equal(invitationState(view, now()), "request")
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
  await saveDates(view.state!, [{ title: "Clubabend", starts: now() + 86400 }], author)

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
  assert.deepEqual(clubTasks(view, now()).map((t) => t.kind)[0], "ownership")
  await acceptOwnership(view.state!, author)
  view = await refreshClub(club, author)
  assert.equal(view.id, club)
  assert.equal(view.state?.owner, alice.pubkey)

  view = await opened(club, owner)
  assert.equal(view.state?.owner, alice.pubkey)
  assert.equal(view.me.role, "admin")
})

test("ownership can go to a member who came in through a group link: the offer confirms the membership first, and a new offer replaces one that lapsed", async () => {
  const owner = person()
  const ben = person()
  let author = await device(owner)
  const club = await foundClub({ name: "Gruppenlink", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  await acceptInvitation(club, (await viaLink(clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] }), ben)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  assert.equal(isConfirmedMember(view.state!, ben.pubkey), false)
  await offerOwnership(view.state!, ben.pubkey, author)
  view = await refreshClub(club, author)
  assert.equal(isConfirmedMember(view.state!, ben.pubkey), true, "a role record naming his join confirms him")
  assert.equal(view.state?.members[ben.pubkey]?.role, "member", "with the role he had")
  assert.equal(view.state?.offer?.to, ben.pubkey)
  // A day later the offer has lapsed for the screens; the owner offers again on top of it.
  assert.equal(openOffer(view.state!, view.state!.offer!.expires + 1), null)
  const again = await offerOwnership(view.state!, ben.pubkey, author)
  view = await refreshClub(club, author)
  assert.equal(view.state?.offer?.event, again.events[0].id)

  author = await device(ben)
  view = await refreshClub(club, author)
  assert.deepEqual(clubTasks(view, now()).map((t) => t.kind)[0], "ownership")
  await acceptOwnership(view.state!, author)
  view = await refreshClub(club, author)
  assert.equal(view.state?.owner, ben.pubkey)
  view = await opened(club, owner)
  assert.equal(view.state?.owner, ben.pubkey)
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

test("a season table follows the games: a confirmed result counts, a correction recounts it, a game against guests waits for a leader, a closed club's games are private", async () => {
  const owner = person()
  const ben = person()
  let author = await device(owner)
  const club = await foundClub({ name: "Liga", visibility: "closed" }, author)
  let view = await refreshClub(club, author)
  const invite = await createInvite(view.state!, { kind: "group", days: 7 }, author)
  await acceptInvitation(club, (await viaLink(clubLink(SITE, { club, invite: { id: invite.invite, token: invite.token }, relays: [] }), ben)).author)
  author = await device(owner)
  view = await refreshClub(club, author)
  await createSeason(view.state!, { name: "Herbst", starts: now() - 60, rules: { ...DEFAULT_RULES, confirmations: "opponent" } }, author)
  view = await refreshClub(club, author)

  const seats = [{ name: "Olaf", pubkey: owner.pubkey }, { name: "Ben", pubkey: ben.pubkey }, { name: "Mia" }]
  const won: FinishedGame = { id: "local-1", config: config(["Olaf", "Ben", "Mia"]), seats, winner: 0, throws: visits(180, 60, 60, 180, 60, 60, 141) }
  const recorded = await recordGame(view.state!, won, gameSeats(seats, "closed", (n) => `Gast ${n}`), author)
  await sent()
  const raw = await relayClient().query([{ ids: [recorded.match] }], [a.url])
  assert.ok(!raw.events[0].content.includes("Ben"), "the match is private: its agreement is encrypted")
  // The club remembers the game by its local id, and knows it by its throws: never twice.
  assert.equal((await loadStoredClub(club))?.recorded["local-1"], recorded.match)
  view = await refreshClub(club, author)
  assert.equal(recordedGame(view.games, owner.pubkey, gameSeats(seats, "closed", (n) => `Gast ${n}`), won.throws)?.match, recorded.match)

  const season = Object.values(view.state!.seasons)[0]
  let table = seasonTable(season, view.games)
  assert.deepEqual(table.open.map((o) => o.why), ["confirmations"])

  author = await device(ben)
  view = await refreshClub(club, author)
  assert.equal(view.games[0].agreement.seats[2].alias, "Mia", "a guest's name stays inside the club")
  assert.deepEqual(clubTasks(view, now()).map((t) => t.kind), ["verdict"])
  await answerGame(view.state!, view.games[0], "confirm", author)
  view = await refreshClub(club, author)
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games)
  assert.deepEqual(table.ranked.map((r) => [r.pubkey, r.points]), [[owner.pubkey, 2], [ben.pubkey, 0]])
  // The confirmed game is now one of Ben's own games on his phone, once however often the club is
  // read, and his private history carries it (lib/live/copy.ts).
  await addProfilePlayer(ben.pubkey, "Ben")
  await keepCopies(ben.pubkey, confirmedCopies(view.games, ben.pubkey))
  await keepCopies(ben.pubkey, confirmedCopies(view.games, ben.pubkey))
  const own = await loadArchive()
  assert.deepEqual(own.map((m) => [m.id, m.players[1].pubkey]), [[recorded.match, ben.pubkey]])
  assert.ok(profileRecords(ben.pubkey, own, await listPlayers()).has(`match:${recorded.match}`))

  // The host corrects the result: Ben won. The old confirmation lapses until Ben confirms again.
  author = await device(owner)
  view = await refreshClub(club, author)
  await correctGame(view.state!, view.games[0], { winner: 1, legs: [0, 1, 0] }, "Falsch eingetragen", author)
  view = await refreshClub(club, author)
  assert.equal(view.games[0].result?.replaces, recorded.events[1].id)
  assert.equal(view.games[0].result?.stats, undefined, "a corrected result carries no statistics")

  // A game against a guest only: nobody can confirm it, so it is the leader's to decide.
  const solo: FinishedGame = { id: "local-2", config: config(["Olaf", "Mia"]), seats: [seats[0], seats[2]], winner: 0, throws: visits(180, 60, 180, 60, 141) }
  await recordGame(view.state!, solo, gameSeats(solo.seats, "closed", (n) => `Gast ${n}`), author)
  view = await refreshClub(club, author)
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games)
  assert.deepEqual(table.open.map((o) => o.why).sort(), ["confirmations", "unconfirmable"])
  const decide = clubTasks(view, now()).find((t) => t.kind === "decide")
  assert.equal(decide?.kind === "decide" && decide.why, "unconfirmable")
  await decideResult(view.state!, Object.values(view.state!.seasons)[0], (decide as { game: (typeof view.games)[number] }).game, true, author, "Mia hat kein Profil")
  view = await refreshClub(club, author)
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games, view.state!.results[Object.values(view.state!.seasons)[0].id])
  assert.equal(table.counted.length, 1)

  author = await device(ben)
  view = await refreshClub(club, author)
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games, view.state!.results[Object.values(view.state!.seasons)[0].id])
  assert.deepEqual(table.open.map((o) => o.why), ["confirmations"], "Ben's old confirmation no longer counts")
  assert.deepEqual(confirmedCopies(view.games, ben.pubkey).map((c) => c.record), [null], "nor is the corrected game his own before he confirms it")
  await answerGame(view.state!, view.games.find((g) => g.match === recorded.match)!, "confirm", author)
  view = await refreshClub(club, author)
  await keepCopies(ben.pubkey, confirmedCopies(view.games, ben.pubkey))
  assert.deepEqual((await loadArchive()).map((m) => m.id), [recorded.match])
  table = seasonTable(Object.values(view.state!.seasons)[0], view.games, view.state!.results[Object.values(view.state!.seasons)[0].id])
  // Two points each; head to head Ben beat Olaf.
  assert.deepEqual(table.ranked.map((r) => [r.pubkey, r.points, r.rank]), [[ben.pubkey, 2, 1], [owner.pubkey, 2, 2]])
})

// A week later at the same local time: across a change of daylight-saving time that is not
// 7 × 86400 seconds (lib/clubs/dates.ts repeatDates keeps the hour of the club night).
const weeksLater = (unix: number, weeks: number) => {
  const date = new Date(unix * 1000)
  date.setDate(date.getDate() + 7 * weeks)
  return Math.floor(date.getTime() / 1000)
}

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
  const first = now() + 86400
  await saveDates(view.state!, repeatDates({ title: "Clubabend", starts: first, ends: first + 3 * 3600, place: "Vereinsheim" }, 7, 3), author)
  await sent()
  const calendar = await relayClient().query([{ kinds: [KIND_CALENDAR_TIME], "#e": [club] }], [a.url])
  assert.equal(calendar.events.length, 3)
  assert.equal(await runNak(["verify"], { input: `${calendar.events.map((e) => JSON.stringify(e)).join("\n")}\n` }), "")
  assert.deepEqual(calendar.events.map((e) => e.tags.find((t) => t[0] === "title")?.[1]), ["Clubabend", "Clubabend", "Clubabend"])

  const phone = await device(ben)
  view = await refreshClub(club, phone)
  assert.deepEqual(view.dates.map((d) => d.starts), [first, weeksLater(first, 1), weeksLater(first, 2)])
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
