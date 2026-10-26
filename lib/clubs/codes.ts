import { tagValue } from "../protocol/tags.ts"
import { codeLookup, normalizeInviteCode, openCodeTag } from "../protocol/invite.ts"
import type { ClubAddress } from "./links.ts"
import { fetchInviteByCode } from "./relays.ts"

// Joining by a short code (docs/protocol/families/club.md, "Kurzcode"): the code names nothing
// by itself. Its lookup value finds the invite record at the usual relays, the record's tag opens
// with the code and gives the token, and from there it is the same invitation as from the link
// (invitation.ts openInvitation).

export type CodeProblem =
  // Not eight letters and digits of the code alphabet.
  | "malformed"
  // No relay answered: the code may be fine.
  | "offline"
  // Relays answered without an invite for this code: mistyped, ended, or never sent.
  | "missing"

export type CodeLookup = { address: ClubAddress & { invite: { id: string; token: string } } } | { problem: CodeProblem }

export async function findInviteByCode(input: string): Promise<CodeLookup> {
  const code = normalizeInviteCode(input)
  if (!code) return { problem: "malformed" }
  const fetched = await fetchInviteByCode(await codeLookup(code))
  for (const event of fetched.events) {
    const club = tagValue(event.tags, "e")
    if (!club) continue
    const token = await openCodeTag(event.tags, code)
    if (token) return { address: { club, invite: { id: event.id, token }, relays: [] } }
  }
  return { problem: fetched.answered ? "missing" : "offline" }
}
