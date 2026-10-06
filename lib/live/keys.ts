import { bytesToHex, hexToBytes } from "@noble/hashes/utils"
import { createLocalKey, createLocalSigner } from "../nostr/signers.ts"
import type { EventTemplate, Signer } from "../nostr/types.ts"
import { MAX_LINK_RELAYS } from "../protocol/links.ts"
import { encryptForLinkKey } from "../protocol/records.ts"
import type { SignedEvent } from "../protocol/tags.ts"
import { generalRelays } from "../nostr/relays.ts"

// The keys of a live match: all made on the device for this one match, none of them a profile
// key. The authority founds the match and connects seats, the session key writes snapshots and
// the result, the match key reads it (it travels in the watch link), and the one-time keys of a
// board code or a handoff carry the handshake messages.

export interface MatchKey {
  secret: Uint8Array
  pubkey: string
  signer: Signer
}

export async function newKey(): Promise<MatchKey> {
  const { secretKey } = await createLocalKey()
  return keyOf(secretKey)
}

export async function keyOf(secret: Uint8Array): Promise<MatchKey> {
  const signer = await createLocalSigner(secret)
  return { secret, pubkey: await signer.getPublicKey(), signer }
}

export const toHex = bytesToHex
export const fromHex = hexToBytes

// Where a live match and its handshakes travel: the first general relays, as many as a link
// can name, so the link alone is enough to find the match.
export const liveRelays = () => generalRelays().slice(0, MAX_LINK_RELAYS)

// Every record of a private match is NIP-44 encrypted to the match key. Its conversation key is
// the same from both ends, so whoever holds the match key encrypts on behalf of any author:
// a player's own signer only signs, which an Android signer without NIP-44 can do too.
export async function sealToMatch(template: EventTemplate, author: string, matchKey: MatchKey): Promise<EventTemplate> {
  const ciphertext = await matchKey.signer.nip44!.encrypt(author, template.content)
  return encryptForLinkKey(template, matchKey.pubkey, ciphertext)
}

export async function openFromMatch(event: SignedEvent, matchKey: MatchKey): Promise<string | null> {
  try {
    return await matchKey.signer.nip44!.decrypt(event.pubkey, event.content)
  } catch {
    return null
  }
}
