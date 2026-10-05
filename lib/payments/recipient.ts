// How a player can be paid without showing an invoice: the Lightning address in their public
// profile (lud16), if they have one and its service answers. Otherwise the payer scans an invoice
// the other player's device shows ("Rechnung scannen").
import { fetchPayEndpoint, type PayEndpoint } from "../nostr/ext/lnurl.ts"
import { readMetadata } from "../profile/metadata.ts"
import { loadPublicProfile, type LoadStatus } from "../profile/public-profile.ts"

export interface RecipientAddress {
  address: string
  // Null when the address's service didn't answer (offline, or it can't be reached from a web
  // page): then this address can't be used right now.
  endpoint: PayEndpoint | null
}

export interface RecipientLookup {
  // Null when the profile, as far as it could be loaded, has no Lightning address.
  address: RecipientAddress | null
  // "partial" or "offline": the profile may have an address this device couldn't load.
  status: LoadStatus
}

export async function lookupRecipient(pubkey: string): Promise<RecipientLookup> {
  const { profile, status } = await loadPublicProfile(pubkey).catch(() => ({ profile: null, status: "offline" as const }))
  const address = readMetadata(profile?.metadata).lightningAddress
  if (!address) return { address: null, status }
  const endpoint = await fetchPayEndpoint(address).catch(() => null)
  return { address: { address, endpoint }, status }
}
