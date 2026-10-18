import type { RecordSpec } from "./common.ts"
import { eventId, MODE_ID, name, objectId, prev, pubkey, shortText } from "./common.ts"
import { INVITE_KINDS } from "./invite.ts"
import { KIND_RECORD } from "./kinds.ts"
import type { Infer, Schema } from "./schema.ts"
import { arr, bool, hex, httpsUrl, id32, int, nullable, obj, oneOf, opt, refine, str, time } from "./schema.ts"
import { MAX_SEAL_READERS } from "./seal.ts"

// Club records (docs/protocol/families/club.md). A club is the id of its club.found event;
// every other record names it in its "e" tag. State comes from replaying them (club-state.ts).
// In a closed club every record except club.join and club.leave is sealed for the current
// members (seal.ts); nothing is encrypted to a shared club key. A public club's records,
// invites included, travel in the clear so every reader checks the same club; only key shares
// are sealed there.

export const CLUB_ROLES = ["owner", "admin", "director", "member"] as const
export type ClubRole = (typeof CLUB_ROLES)[number]

// Members of a closed club: every sealed record wraps its key once per member, and that has to
// fit into one event (seal.ts). A closed club without its own capacity has this one
// (club-state.ts); a public club seals nothing for its members and has no such limit.
export const MAX_CLUB_MEMBERS = MAX_SEAL_READERS

// Content keys one club.keys record may list. How many fit depends on the readers it is
// sealed for (records.ts maxSharedKeys: 68 for 100 readers); more go into several records.
export const MAX_SHARED_KEYS = 150

export const seasonRules = obj({
  modes: arr(str({ min: 1, max: 16, pattern: MODE_ID }), { min: 1, max: 6, unique: true, description: "Game modes that count" }),
  points: obj({ win: int(0, 10), draw: int(0, 10), loss: int(0, 10) }),
  confirmations: oneOf(["none", "opponent", "all"], "Player confirmations a result needs to count"),
  minGames: int(0, 1000, "Games needed to be ranked"),
  tiebreak: arr(oneOf(["wins", "legDifference", "headToHead", "average"]), { max: 4, unique: true }),
})
export type SeasonRules = Infer<typeof seasonRules>

const clubFound = obj({
  name: name(),
  about: opt(shortText(500)),
  picture: opt(httpsUrl()),
  visibility: oneOf(["closed", "public"], "closed: every record but join and leave is sealed for the members"),
  capacity: opt(int(2, MAX_CLUB_MEMBERS, "With a limit, group links admit no one directly; an owner or admin accepts")),
})

const clubUpdate = refine(
  obj({
    prev: prev(),
    name: opt(name()),
    about: opt(shortText(500)),
    picture: opt(nullable(httpsUrl())),
    visibility: opt(oneOf(["closed", "public"])),
    capacity: opt(nullable(int(2, MAX_CLUB_MEMBERS))),
    archived: opt(bool()),
  }),
  (v) => (Object.keys(v).length > 1 ? null : "changes nothing"),
)

// The invite id is the event id of this record. It names the public key of the invite key
// derived from the link's token, never the token: whoever reads the record checks join proofs
// (invite.ts). In a public club it travels in the clear, so everyone can, and has no label; a
// closed club seals it, with the preview for people who open the link encrypted under
// previewKey(token). An invite ends with its maker's role as owner or admin.
const clubInvite = obj({
  kind: oneOf(INVITE_KINDS, "group: admits with a valid proof until expiry or revocation; personal: once, after acceptance"),
  key: pubkey("Public key of the invite key HKDF(token, 'blueline-invite-v1', 'proof'), see invite.ts"),
  expires: time(),
  label: opt(str({ max: 60, description: "Plain text; only in a closed club, where the invite is sealed, since it may name the invited person" })),
})

// Ending an admin's role (club.role to a lower role, club.remove) names the last club.update
// the author saw: the admin's club.updates dated before the end count only up to there
// (replay.ts, "Ends of authority").
const tenurePin = id32("Last club.update (or the club id) the author saw; required when the member is an admin")

const clubJoin = refine(
  obj({
    invite: opt(eventId("club.invite event id")),
    proof: opt(hex(64, "BIP-340 signature of the invite key over sha256('blueline-invite-v1:' + joiner pubkey), see invite.ts")),
  }),
  (v) => ((v.invite === undefined) === (v.proof === undefined) ? null : "invite and proof go together"),
)

// [event id, content key] pairs: lets members (typically new ones) open records sealed before
// they were wrapped for.
const sharedKey = arr(hex(32), { min: 2, max: 2, description: "[event id, content key hex]" })

const result = obj({
  season: objectId(),
  match: eventId("Match id"),
  result: eventId("match.result event id the decision is about"),
  count: bool("true: the result counts for the season; false: it is left out"),
  prev: prev(),
  reason: opt(shortText()),
})

const date = refine(
  obj({
    date: objectId(),
    title: name(),
    starts: time(),
    ends: opt(time()),
    place: opt(shortText(140)),
    note: opt(shortText(500)),
    cancelled: opt(bool()),
    prev: prev(),
  }),
  (v) => (v.ends !== undefined && v.ends <= v.starts ? "ends before it starts" : null),
)

// A game members played for the club (lib/clubs): its match, and in a closed club the secret of
// that private match's key, so every member reads it. Any member names the games they hosted;
// whether one counts for a season follows the season's rules and the leaders' decisions
// (club.result). Without these records a club's matches could not be found: match records name
// their match, not the club.
const game = obj({
  match: eventId("Match id: the match.session (sv 1) that founded it"),
  key: opt(hex(32, "Secret of the private match's key (link key); only sealed, in a closed club")),
})

// A member's answer to a club date; their newest answer counts. Public clubs answer their
// NIP-52 dates with NIP-52 RSVPs instead (lib/clubs).
const rsvp = obj({ date: objectId("club.date id"), answer: oneOf(["yes", "maybe", "no"]) })

const rec = <S extends Schema<unknown>>(schema: S, description: string, extra: Partial<Pick<RecordSpec, "root" | "encryption" | "encrypted">> = {}) => ({
  kind: KIND_RECORD,
  root: "required" as const,
  encryption: "seal" as const,
  schema,
  description,
  ...extra,
})

export const CLUB_TYPES = {
  "club.found": rec(clubFound, "Founds a club; its id is the club id", { root: "self" }),
  "club.update": rec(clubUpdate, "Changes name, description, picture, visibility, capacity or archive state"),
  "club.invite": rec(clubInvite, "Creates a group link or a personal invite; in the clear in a public club, sealed in a closed one"),
  "club.invite.revoke": rec(obj({ invite: eventId("club.invite event id") }), "Ends an invite"),
  "club.join": rec(clubJoin, "Joins through a group link, or asks to join (personal invite or none)", { encryption: "none" }),
  "club.accept": rec(obj({ request: eventId("club.join event id"), member: pubkey() }), "Accepts a waiting join request"),
  "club.decline": rec(obj({ request: eventId("club.join event id") }), "Declines a waiting join request"),
  "club.leave": rec(obj({}), "A member leaves, or someone withdraws their waiting request"),
  "club.remove": rec(obj({ member: pubkey(), prev: prev(), reason: opt(shortText()), info: opt(tenurePin) }), "Removes a member"),
  "club.role": rec(obj({ member: pubkey(), role: oneOf(["admin", "director", "member"]), prev: prev(), info: opt(tenurePin) }), "Gives a member a role"),
  "club.owner.offer": rec(
    obj({
      to: pubkey(),
      prev: prev(),
      expires: time("Open until then: after created_at, at most MAX_OFFER_SECONDS (7 days) later"),
      info: id32("The current club details it hands over: last club.update, or the club id"),
      member: id32("The offered member's current base: their last role change, or their join"),
    }),
    "The owner offers ownership to a member",
  ),
  "club.owner.cancel": rec(obj({ offer: eventId() }), "The owner withdraws the open offer"),
  "club.owner.accept": rec(
    obj({
      offer: eventId(),
      info: id32("Last club.update (or the club id) the new owner saw: the offer's info or one built on it"),
      member: id32("The new owner's own last member change (their join, or a role change): the offer's member or one built on it"),
    }),
    "The offered member takes over ownership",
  ),
  "club.keys": rec(obj({ keys: arr(sharedKey, { min: 1, max: MAX_SHARED_KEYS }) }), "Shares content keys of earlier sealed records", { encrypted: true }),
  "club.season": rec(
    refine(obj({ season: objectId(), name: name(), starts: time(), ends: opt(time()), rules: seasonRules }), (v) =>
      v.ends !== undefined && v.ends <= v.starts ? "ends before it starts" : null,
    ),
    "Sets up a season with rules version 1",
  ),
  "club.season.rules": rec(
    obj({ season: objectId(), version: int(2, 1000), rules: seasonRules, reason: opt(shortText()) }),
    "New rules version for a season; after its start only with a reason",
  ),
  "club.season.end": rec(obj({ season: objectId() }), "Ends a season"),
  "club.result": rec(result, "Decides whether a match result counts for a season"),
  "club.date": rec(date, "Creates, changes or cancels a club date"),
  "club.game": rec(game, "Names a game members played for the club, with the key of a private match"),
  "club.rsvp": rec(rsvp, "A member answers a club date"),
} satisfies Record<string, RecordSpec>

// Records a closed club may carry in the clear: a join comes from someone who is not a member
// yet, and a leave says nothing a relay does not already see.
export const CLUB_PLAIN_TYPES: readonly string[] = ["club.join", "club.leave"]
