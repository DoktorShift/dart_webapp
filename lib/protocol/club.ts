import type { RecordSpec } from "./common.ts"
import { eventId, MODE_ID, name, objectId, prev, pubkey, shortText } from "./common.ts"
import { INVITE_KINDS } from "./invite.ts"
import { KIND_RECORD } from "./kinds.ts"
import type { Infer, Schema } from "./schema.ts"
import { arr, bool, hex, httpsUrl, int, nullable, obj, oneOf, opt, refine, str, time } from "./schema.ts"
import { MAX_SEAL_READERS } from "./seal.ts"

// Club records (docs/protocol/families/club.md). A club is the id of its club.found event;
// every other record names it in its "e" tag. State comes from replaying them (club-state.ts).
// In a closed club every record except club.join and club.leave is sealed for the current
// members (seal.ts); nothing is encrypted to a shared club key.

export const CLUB_ROLES = ["owner", "admin", "director", "member"] as const
export type ClubRole = (typeof CLUB_ROLES)[number]

// Members per club: every sealed record wraps its key once per member, and that has to fit
// into one event (seal.ts).
export const MAX_CLUB_MEMBERS = MAX_SEAL_READERS

// Content keys one club.keys record shares; more go into several records.
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

// The invite id is the event id of this record. The token is the secret of the link; members
// need it to check join proofs, which is why an invite is always sealed. The preview for people
// who open the link sits in the same event, encrypted under previewKey(token) (invite.ts).
const clubInvite = obj({
  kind: oneOf(INVITE_KINDS, "group: admits with a valid proof until expiry or revocation; personal: once, after acceptance"),
  token: hex(16, "Invite token (secret of the link)"),
  expires: time(),
  label: opt(shortText(60)),
})

const clubJoin = refine(
  obj({
    invite: opt(eventId("club.invite event id")),
    proof: opt(hex(32, "HMAC-SHA256(token, 'blueline-invite-v1:' + joiner pubkey), see invite.ts")),
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
  "club.invite": rec(clubInvite, "Creates a group link or a personal invite", { encrypted: true }),
  "club.invite.revoke": rec(obj({ invite: eventId("club.invite event id") }), "Ends an invite"),
  "club.join": rec(clubJoin, "Joins through a group link, or asks to join (personal invite or none)", { encryption: "none" }),
  "club.accept": rec(obj({ request: eventId("club.join event id"), member: pubkey() }), "Accepts a waiting join request"),
  "club.decline": rec(obj({ request: eventId("club.join event id") }), "Declines a waiting join request"),
  "club.leave": rec(obj({}), "A member leaves, or someone withdraws their waiting request"),
  "club.remove": rec(obj({ member: pubkey(), prev: prev(), reason: opt(shortText()) }), "Removes a member"),
  "club.role": rec(obj({ member: pubkey(), role: oneOf(["admin", "director", "member"]), prev: prev() }), "Gives a member a role"),
  "club.owner.offer": rec(obj({ to: pubkey(), prev: prev() }), "The owner offers ownership to a member"),
  "club.owner.cancel": rec(obj({ offer: eventId() }), "The owner withdraws the open offer"),
  "club.owner.accept": rec(obj({ offer: eventId() }), "The offered member takes over ownership"),
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
} satisfies Record<string, RecordSpec>

// Records a closed club may carry in the clear: a join comes from someone who is not a member
// yet, and a leave says nothing a relay does not already see.
export const CLUB_PLAIN_TYPES: readonly string[] = ["club.join", "club.leave"]
