import { readInvitePreview } from "../protocol/invite.ts"
import { parseEnvelope } from "../protocol/seal.ts"
import { encryptionOf } from "../protocol/tags.ts"
import type { ClubView } from "./club.ts"
import type { ClubAddress } from "./links.ts"
import { joinClub } from "./membership.ts"
import { fetchInvite } from "./relays.ts"
import type { Author, Sent } from "./send.ts"
import { loadStoredClub, updateClub } from "./store.ts"

// Opening an invitation link, with or without a profile (PLAN.md: "Informationen ansehen, bevor
// sie ein Profil erstellen"). A closed club's invite carries a preview only the link opens
// (lib/protocol/invite.ts); a public club simply shows its records. What the link brought is
// kept with the club, so the Clubs tab lists the invitation until it is used or turned down.

export type InvitationProblem =
  // No relay answered: the link may be fine.
  | "offline"
  // Relays answered without the invite: deleted, or never sent.
  | "missing"
  // The link doesn't open the invite (a damaged or changed token).
  | "damaged"

export async function openInvitation(address: ClubAddress & { invite: { id: string; token: string } }, reader: string | null): Promise<InvitationProblem | null> {
  const { club, invite, relays } = address
  const fetched = await fetchInvite(club, invite.id, relays)
  const record = fetched.events.find((e) => e.id === invite.id)
  if (!record) return fetched.answered ? "missing" : "offline"
  let preview
  if (encryptionOf(record.tags).form === "seal") {
    try {
      preview = readInvitePreview(parseEnvelope(record.content), invite.token)
    } catch {
      return "damaged"
    }
  }
  await updateClub(club, { events: fetched.events, relays, invite: { invite: invite.id, token: invite.token, ...(preview ? { preview } : {}), openedAt: Date.now() }, loadedAt: Date.now() }, reader)
  return null
}

// Whether the opened invitation still admits: a closed club's preview says its kind and expiry
// (a revocation stays sealed until joining); a public club's records say everything.
export type InvitationState = "open" | "request" | "expired" | "ended" | "used"

export function invitationState(view: ClubView, now: number): InvitationState | null {
  const opened = view.invite
  if (!opened) return null
  const invite = view.state?.invites[opened.invite]
  const kind = invite?.kind ?? opened.preview?.kind
  const expires = invite?.expires ?? opened.preview?.expires
  if (expires !== undefined && expires < now) return "expired"
  if (invite?.ended) return "ended"
  if (invite?.kind === "personal" && invite.uses.length > 0) return "used"
  // A group link admits at once, unless the club has a member limit: then a leader decides. A
  // closed club's records say so only once they open; until then the preview does.
  const limited = view.state ? view.state.info.capacity !== undefined : opened.preview?.limited === true
  return kind === "group" && !limited ? "open" : "request"
}

// Joins with the invitation this profile opened: the proof of its token, dated after the invite.
export async function acceptInvitation(club: string, author: Author): Promise<Sent> {
  const stored = await loadStoredClub(club)
  const opened = stored?.invite
  if (!stored || !opened) throw new Error("no invitation opened for this club")
  const at = stored.events.find((e) => e.id === opened.invite)?.created_at ?? 0
  return joinClub(club, { id: opened.invite, token: opened.token, at }, author)
}
