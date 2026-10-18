import { generalRelays, mergeRelays, profileRelays } from "../nostr/relays.ts"
import { decodeLinkPayload, encodeLinkPayload } from "../protocol/links.ts"
import { buildLink, parseAppLink } from "../shell/links.ts"

// Profile links and QR codes: /#p=U1.<pubkey>.<relays> (docs/protocol/families/pairing.md). They
// carry only what is public. Relay hints name only relays readers wouldn't look at anyway, so
// the code stays small enough to scan from across a table.

export interface ProfileAddress {
  pubkey: string
  relays: string[]
}

const MAX_HINTS = 2

export function profileLink(site: string, pubkey: string, writeRelays: readonly string[] = []): string {
  const usual = new Set(mergeRelays(profileRelays(), generalRelays()))
  const relays = mergeRelays(writeRelays).filter((url) => !usual.has(url)).slice(0, MAX_HINTS)
  return buildLink(site, "p", encodeLinkPayload({ type: "profile", pubkey, relays }))
}

// The profile a /#p= payload names, or null for a damaged one.
export function readProfilePayload(payload: string): ProfileAddress | null {
  try {
    const { pubkey, relays } = decodeLinkPayload("profile", decodeURIComponent(payload))
    return { pubkey, relays: mergeRelays(relays) }
  } catch {
    return null
  }
}

// A scanned or pasted profile code: a BlueLine profile link of this app, or a profile code of
// another Nostr app (npub, nprofile). Null for anything else.
export async function readProfileCode(text: string, origins: readonly string[]): Promise<ProfileAddress | null> {
  const link = parseAppLink(text, origins)
  if (link) return link.kind === "p" ? readProfilePayload(link.payload) : null
  const { decodeProfilePointer } = await import("../nostr/pointers.ts")
  return decodeProfilePointer(text)
}
