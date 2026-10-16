import { generalRelays, mergeRelays } from "../nostr/relays.ts"
import { decodeLinkPayload, encodeLinkPayload, MAX_LINK_RELAYS } from "../protocol/links.ts"
import { buildLink } from "../shell/links.ts"

// Club links (docs/protocol/families/pairing.md): /#club=C1.<club>.<invite>.<token>.<relays>.
// The token is the secret of an invitation: it lives in the fragment, which never reaches a
// server, and on the devices of the person who made the link. Relay hints name only relays a
// reader wouldn't ask anyway, so the QR code stays easy to scan.

export interface ClubAddress {
  club: string
  invite?: { id: string; token: string }
  relays: string[]
}

export function clubLink(site: string, address: ClubAddress): string {
  const usual = new Set(generalRelays())
  const relays = mergeRelays(address.relays).filter((url) => !usual.has(url)).slice(0, MAX_LINK_RELAYS)
  const invite = address.invite ? { invite: address.invite.id, token: address.invite.token } : {}
  return buildLink(site, "club", encodeLinkPayload({ type: "club", club: address.club, ...invite, relays }))
}

// The club a /#club= payload names, or null for a damaged one.
export function readClubPayload(payload: string): ClubAddress | null {
  try {
    const p = decodeLinkPayload("club", decodeURIComponent(payload))
    return { club: p.club, ...(p.invite && p.token ? { invite: { id: p.invite, token: p.token } } : {}), relays: mergeRelays(p.relays) }
  } catch {
    return null
  }
}
