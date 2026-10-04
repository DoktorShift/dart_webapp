import type { RecordSpec } from "./common.ts"
import { MODE_ID, name, objectId, prev, pubkey, shortText } from "./common.ts"
import { KIND_RECORD } from "./kinds.ts"
import type { Infer } from "./schema.ts"
import { arr, bool, hex, httpsUrl, int, nullable, obj, oneOf, opt, refine, str, time } from "./schema.ts"

// Club records (docs/protocol/families/club.md). A club is the id of its club.found event;
// every other record names it in its "e" tag. State comes from replaying them (club-state.ts).

export const CLUB_ROLES = ["owner", "admin", "director", "member"] as const
export type ClubRole = (typeof CLUB_ROLES)[number]

// Members per club. Bounded by the key rotation record, which wraps the new club key once per
// member and must stay under the event budget.
export const MAX_CLUB_MEMBERS = 200

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
  visibility: oneOf(["closed", "public"], "closed: content encrypted to the club key"),
  key: pubkey("Club key (group pubkey). Its secret travels only in invite links and key wraps"),
  capacity: opt(int(2, MAX_CLUB_MEMBERS)),
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

// The invite token is the secret of the link; the record carries it so that every member can
// check join proofs, which is why invites are always sealed to the club key.
const clubInvite = obj({
  invite: objectId(),
  token: hex(16, "Invite token (secret of the link)"),
  maxUses: int(1, MAX_CLUB_MEMBERS),
  expires: time(),
})

const clubJoin = refine(
  obj({
    invite: opt(objectId()),
    proof: opt(hex(32, "HMAC-SHA256(token, joiner pubkey), see invite.ts")),
    message: opt(shortText()),
  }),
  (v) => ((v.invite === undefined) === (v.proof === undefined) ? null : "invite and proof go together"),
)

const wrap = () => str({ min: 1, max: 1024, description: "NIP-44 payload: the club secret for one member" })

export const CLUB_TYPES = {
  "club.found": { kind: KIND_RECORD, root: "self", sealed: "allowed", schema: clubFound, description: "Founds a club; its id is the club id" },
  "club.update": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: clubUpdate, description: "Changes name, description, picture, visibility, capacity or archive state" },
  "club.invite": { kind: KIND_RECORD, root: "required", sealed: "required", schema: clubInvite, description: "Creates an invite with limited uses and expiry" },
  "club.invite.revoke": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ invite: objectId() }), description: "Ends an invite" },
  "club.join": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: clubJoin, description: "Joins with an invite proof, or asks to join" },
  "club.accept": {
    kind: KIND_RECORD,
    root: "required",
    sealed: "allowed",
    schema: obj({ request: hex(32, "club.join event id"), member: pubkey(), wrap: opt(wrap()) }),
    description: "Accepts a waiting join request",
  },
  "club.decline": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ request: hex(32), reason: opt(shortText()) }), description: "Declines a waiting join request" },
  "club.leave": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ message: opt(shortText()) }), description: "A member leaves" },
  "club.remove": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ member: pubkey(), prev: prev(), reason: opt(shortText()) }), description: "Removes a member" },
  "club.role": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ member: pubkey(), role: oneOf(["admin", "director", "member"]), prev: prev() }), description: "Gives a member a role" },
  "club.owner.offer": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ to: pubkey(), prev: prev() }), description: "Owner offers ownership to a member" },
  "club.owner.cancel": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ offer: hex(32) }), description: "Owner withdraws the open offer" },
  "club.owner.accept": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ offer: hex(32) }), description: "The offered member takes over ownership" },
  "club.key": {
    kind: KIND_RECORD,
    root: "required",
    sealed: "never",
    schema: obj({ epoch: int(1, 100000), key: pubkey("New club key"), wraps: arr(wrap(), { max: MAX_CLUB_MEMBERS }) }),
    description: "Rotates the club key; wraps carry the new secret to each remaining member",
  },
  "club.season": {
    kind: KIND_RECORD,
    root: "required",
    sealed: "allowed",
    schema: refine(obj({ season: objectId(), name: name(), starts: time(), ends: opt(time()), rules: seasonRules }), (v) =>
      v.ends !== undefined && v.ends <= v.starts ? "ends before it starts" : null,
    ),
    description: "Sets up a season with rules version 1",
  },
  "club.season.rules": {
    kind: KIND_RECORD,
    root: "required",
    sealed: "allowed",
    schema: obj({ season: objectId(), version: int(2, 1000), rules: seasonRules, reason: opt(shortText()) }),
    description: "New rules version for a season; after its start only with a reason",
  },
  "club.season.end": { kind: KIND_RECORD, root: "required", sealed: "allowed", schema: obj({ season: objectId() }), description: "Ends a season" },
} satisfies Record<string, RecordSpec>
