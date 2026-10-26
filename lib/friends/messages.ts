import { generalRelays, mergeRelays } from "../nostr/relays.ts"
import { cachedProfile } from "../profile/public-profile.ts"
import { relaySettings } from "../profile/relay-list.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { Signer } from "../nostr/types.ts"
import { GIFT_WRAP_KIND, giftWrapWithSigner, type Rumor } from "../nostr/ext/crypto.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import type { FriendMessageType } from "../protocol/friend.ts"
import { FRIEND_TYPES } from "../protocol/friend.ts"
import { buildRecord } from "../protocol/records.ts"
import { readLabels, tagValues } from "../protocol/tags.ts"
import { deliverNow, enqueue, withdraw } from "../sync/outbox.ts"

// The three friend messages (lib/protocol/friend.ts) on their way: a rumor by the profile,
// sealed and gift-wrapped (NIP-59) to the other person, handed to the outbox for the general
// relays, the ones the person's profile link named and the read relays of their profile as last
// seen here, sent now and again until a relay has it.
// Reading: what a wrap must hold to count as a friend message to `me`, by the seal's author.

export interface FriendMessage {
  type: FriendMessageType
  message?: string
}

const MESSAGE_TYPES = Object.keys(FRIEND_TYPES) as FriendMessageType[]
const MAX_THEIR_RELAYS = 4

export async function sendFriendMessage(type: FriendMessageType, to: { pubkey: string; relays?: readonly string[] }, signer: Signer, content: { message?: string } = {}): Promise<{ published: boolean; id: string }> {
  const rumor = buildRecord(type, type === "friend.request" ? content : {}, { created_at: nowSeconds() })
  const { wrap } = await giftWrapWithSigner({ ...rumor, tags: [...rumor.tags, ["p", to.pubkey]] }, signer, to.pubkey)
  const theirs = relaySettings((await cachedProfile(to.pubkey).catch(() => null))?.relayList).read.slice(0, MAX_THEIR_RELAYS)
  const relays = mergeRelays(generalRelays(), [...(to.relays ?? []), ...theirs])
  await enqueue([{ event: wrap, relays }], { coalesce: true })
  const [status] = await deliverNow([wrap.id])
  return { published: status?.state === "delivered", id: wrap.id }
}

// Takes a queued message back, when what it announced didn't happen after all.
export const unsendFriendMessage = (id: string) => withdraw((event) => event.id === id)

export const isWrapKind = (kind: number) => kind === GIFT_WRAP_KIND

export function readFriendMessage(rumor: Rumor, sender: string, me: string): FriendMessage | null {
  if (rumor.kind !== KIND_RECORD || rumor.pubkey !== sender || sender === me) return null
  const type = readLabels(rumor.tags)?.type as FriendMessageType | undefined
  if (!type || !MESSAGE_TYPES.includes(type) || !tagValues(rumor.tags, "p").includes(me)) return null
  try {
    const content = FRIEND_TYPES[type].schema.check(JSON.parse(rumor.content), "") as { message?: string }
    return { type, ...(content.message?.trim() ? { message: content.message.trim() } : {}) }
  } catch {
    return null
  }
}
