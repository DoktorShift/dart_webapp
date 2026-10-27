import { publish } from "../nostr/client.ts"
import { giftWrapWithSigner } from "../nostr/ext/crypto.ts"
import { generalRelays, mergeRelays } from "../nostr/relays.ts"
import { nowSeconds } from "../nostr/time.ts"
import { onInboxRecord, type Opened } from "../profile/inbox.ts"
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
// like a scanned link (through the profile's inbox, lib/profile/inbox.ts), and the invitation
// appears under "Einladungen" in their Clubs tab.

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

// Opens every invitation the profile's inbox hands over, once; `onOpened` gets the club.
export function watchInvitations(onOpened: (club: string, reader: Opened["reader"]) => void): () => void {
  return onInboxRecord("club.invitation", async ({ rumor, sender, reader }) => {
    const invitation = readInvitation(rumor, sender, reader.pubkey)
    if (!invitation) return
    const stored = await loadStoredClub(invitation.club).catch(() => null)
    if (stored?.invite?.invite === invitation.invite) return
    const problem = await openInvitation({ club: invitation.club, invite: { id: invitation.invite, token: invitation.token }, relays: invitation.relays }, reader.pubkey).catch(() => "offline" as const)
    if (!problem) onOpened(invitation.club, reader)
  })
}
