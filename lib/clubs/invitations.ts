import { publish, subscribe, type Closer } from "../nostr/client.ts"
import { GIFT_WRAP_KIND, giftWrapWithSigner, unwrapWithSigner } from "../nostr/ext/crypto.ts"
import { generalRelays, mergeRelays } from "../nostr/relays.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { NostrEvent, Signer } from "../nostr/types.ts"
import type { ClubState } from "../protocol/club-state.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import { buildRecord, RECORD_TYPES } from "../protocol/records.ts"
import { HEX64, readLabels, tagValue, tagValues } from "../protocol/tags.ts"
import { openInvitation } from "./invitation.ts"
import { loadStoredClub } from "./store.ts"
import type { Author } from "./send.ts"

// A personal invitation sent to one player (docs/protocol/families/club.md, "Einladung an ein
// Profil"): the link's parts as a club.invitation rumor, sealed and gift-wrapped (NIP-59) to the
// player, so only they can read it and relays see neither sender nor club. Their app opens it
// like a scanned link, and the invitation appears under "Einladungen" in their Clubs tab.

const DAY = 24 * 60 * 60
// Wraps carry a time up to two days in the past (NIP-59); a week more for someone who opens the
// app late.
const INBOX_DAYS = 9

export async function sendInvitation(
  state: ClubState,
  code: { invite: string; token: string },
  to: { pubkey: string; relays: readonly string[] },
  extras: { relays: readonly string[]; hostName?: string },
  author: Author,
): Promise<{ published: boolean }> {
  const content = {
    invite: code.invite,
    token: code.token,
    relays: [...extras.relays].slice(0, 4),
    name: state.info.name,
    ...(extras.hostName?.trim() ? { hostName: extras.hostName.trim().slice(0, 60) } : {}),
  }
  const rumor = buildRecord("club.invitation", content, { created_at: nowSeconds(), root: state.id })
  const { wrap } = await giftWrapWithSigner({ ...rumor, tags: [...rumor.tags, ["p", to.pubkey]] }, author.signer, to.pubkey)
  const results = await publish(wrap, mergeRelays(generalRelays(), to.relays))
  return { published: results.some((r) => r.ok) }
}

// What a wrap must hold to count as an invitation to `me`: a club.invitation rumor by the seal's
// author, addressed to me, naming a club.
function readInvitation(rumor: { pubkey: string; kind: number; tags: string[][]; content: string }, sender: string, me: string) {
  if (rumor.kind !== KIND_RECORD || rumor.pubkey !== sender) return null
  if (readLabels(rumor.tags)?.type !== "club.invitation" || !tagValues(rumor.tags, "p").includes(me)) return null
  const club = tagValue(rumor.tags, "e")
  if (!club || !HEX64.test(club)) return null
  try {
    return { club, ...RECORD_TYPES["club.invitation"].schema.check(JSON.parse(rumor.content), "") }
  } catch {
    return null
  }
}

// Watches the profile's gift wraps at the usual relays and opens every invitation among them,
// once. Only with a signer that decrypts without asking (a key on this device): a signer app
// would prompt for every wrap, invitations or not.
export function watchInvitations(reader: { pubkey: string; signer: Signer }, onOpened: (club: string) => void): Closer {
  const seen = new Set<string>()
  const handle = async (wrap: NostrEvent) => {
    if (seen.has(wrap.id)) return
    seen.add(wrap.id)
    let opened: Awaited<ReturnType<typeof unwrapWithSigner>>
    try {
      opened = await unwrapWithSigner(wrap, reader.signer)
    } catch {
      // Not for this key, or no BlueLine rumor: other apps' wraps land here too.
      return
    }
    const invitation = readInvitation(opened.rumor, opened.sender, reader.pubkey)
    if (!invitation) return
    const stored = await loadStoredClub(invitation.club).catch(() => null)
    if (stored?.invite?.invite === invitation.invite) return
    const problem = await openInvitation({ club: invitation.club, invite: { id: invitation.invite, token: invitation.token }, relays: invitation.relays }, reader.pubkey).catch(() => "offline" as const)
    if (!problem) onOpened(invitation.club)
  }
  return subscribe([{ kinds: [GIFT_WRAP_KIND], "#p": [reader.pubkey], since: nowSeconds() - INBOX_DAYS * DAY }], generalRelays(), { onevent: (event) => void handle(event) })
}
