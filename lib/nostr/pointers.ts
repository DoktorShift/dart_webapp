// Public profile codes of other Nostr apps (NIP-19), for interop: a profile QR from another app
// ("nostr:npub1…", "nprofile1…") is accepted wherever a BlueLine profile link is. The app's own
// links use its versioned format (lib/protocol/links.ts); the npub is shown only under "Erweitert".
import { loadCore } from "./core.ts"
import { mergeRelays } from "./relays.ts"

export interface ProfilePointer {
  pubkey: string
  relays: string[]
}

const isHexKey = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)

// The public key as npub, as other apps show it.
export async function npubOf(pubkey: string): Promise<string> {
  const core = await loadCore()
  return core.nip19.npubEncode(pubkey)
}

// A pubkey and relay hints from an npub or nprofile, with or without "nostr:"; null for anything
// else (secret keys included: an nsec is never taken for a profile).
export async function decodeProfilePointer(text: string): Promise<ProfilePointer | null> {
  const code = text.trim().replace(/^nostr:/i, "")
  if (!/^(npub|nprofile)1[02-9ac-hj-np-z]+$/i.test(code)) return null
  const core = await loadCore()
  try {
    const decoded = core.nip19.decode(code.toLowerCase())
    if (decoded.type === "npub" && isHexKey(decoded.data)) return { pubkey: decoded.data, relays: [] }
    if (decoded.type === "nprofile" && isHexKey(decoded.data.pubkey)) return { pubkey: decoded.data.pubkey, relays: mergeRelays(decoded.data.relays ?? []) }
  } catch {
    // A typo or a damaged code.
  }
  return null
}
