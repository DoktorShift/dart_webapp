import type { RecordSpec } from "./common.ts"
import { shortText } from "./common.ts"
import { KIND_RECORD } from "./kinds.ts"
import { obj, opt } from "./schema.ts"

// Friends (docs/protocol/families/friends.md): three messages between two profiles, each a
// kind-1180 rumor that only ever travels inside a NIP-59 gift wrap to the other person, like a
// club invitation. Who is whose friend is nobody else's business: the list itself is a private
// record of each profile (private-records.md, type "friends"), never a public follow list.
//
//   friend.request  "I'd like to be your friend", with an optional line
//   friend.accept   the answer that makes it mutual
//   friend.remove   one side ends it; the other side's list follows
//
// No root: a friendship is between the seal's author and the "p" tag, which is all a reader
// needs. Relays see neither sender nor message.

export const MAX_FRIEND_MESSAGE = 140

export const FRIEND_TYPES = {
  "friend.request": { kind: KIND_RECORD, root: "self", encryption: "none", schema: obj({ message: opt(shortText(MAX_FRIEND_MESSAGE)) }), description: "Asks the addressed profile to be friends; only ever inside a NIP-59 gift wrap" },
  "friend.accept": { kind: KIND_RECORD, root: "self", encryption: "none", schema: obj({}), description: "Accepts a friend request; only ever inside a NIP-59 gift wrap" },
  "friend.remove": { kind: KIND_RECORD, root: "self", encryption: "none", schema: obj({}), description: "Ends a friendship or withdraws a request; only ever inside a NIP-59 gift wrap" },
} satisfies Record<string, RecordSpec>

export type FriendMessageType = keyof typeof FRIEND_TYPES
