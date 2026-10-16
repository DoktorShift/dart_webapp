import { hexToBytes } from "@noble/hashes/utils"
import { createLocalSigner } from "../nostr/signers.ts"
import type { NostrEvent, Signer } from "../nostr/types.ts"
import { openSealedEvents } from "../protocol/seal.ts"
import { encryptionOf, readLabels, tagValue } from "../protocol/tags.ts"

// Opening what a club keeps encrypted (docs/protocol/families/club.md):
// - a closed club's sealed records, through this profile's own wraps (one decryption by the
//   signer per record, then never again: the content keys are kept, lib/clubs/store.ts) and
//   through the keys leaders share with club.keys;
// - the club's private games, with the match keys club.game records carry.

export interface OpenedRecords {
  plaintexts: Map<string, string>
  // Content keys that opened them, by event id: what store.ts keeps.
  keys: Record<string, string>
}

// People who ever acted in the club in the clear (its founder, everyone who joined or left):
// only their sealed records are worth a signer call. Anyone can address sealed events to
// anyone; with a signer app every try is a round trip (lib/protocol/seal.ts, `trust`).
function actors(events: readonly NostrEvent[], club: string) {
  const people = new Set<string>()
  for (const event of events) {
    const type = readLabels(event.tags)?.type
    if (event.id === club || ((type === "club.join" || type === "club.leave") && encryptionOf(event.tags).form === "none")) people.add(event.pubkey)
  }
  return people
}

export async function openClubRecords(
  events: readonly NostrEvent[],
  club: string,
  { reader, signer, known }: { reader: string | null; signer: Signer | null; known: Readonly<Record<string, string>> },
): Promise<OpenedRecords> {
  if (!reader) return { plaintexts: new Map(), keys: {} }
  const nip44 = signer?.nip44
  const trusted = actors(events, club)
  const opened = await openSealedEvents(events, {
    reader,
    known: new Map(Object.entries(known)),
    unwrap: async (author, payload) => (nip44 ? nip44.decrypt(author, payload) : null),
    trust: (author) => trusted.has(author),
  })
  return { plaintexts: opened.plaintexts, keys: Object.fromEntries(opened.keys) }
}

// Records of the club's private games, decrypted with each game's match key: the content is
// NIP-44 between the author and the match key (lib/protocol/records.ts encryptForLinkKey).
export async function openGameRecords(events: readonly NostrEvent[], games: readonly { match: string; key?: string }[]): Promise<Map<string, string>> {
  const plaintexts = new Map<string, string>()
  for (const game of games) {
    if (!game.key) continue
    const signer = await createLocalSigner(hexToBytes(game.key))
    const linkKey = await signer.getPublicKey()
    for (const event of events) {
      const enc = encryptionOf(event.tags)
      if (enc.form !== "link" || enc.key !== linkKey || (event.id !== game.match && tagValue(event.tags, "e") !== game.match)) continue
      try {
        plaintexts.set(event.id, await signer.nip44!.decrypt(event.pubkey, event.content))
      } catch {
        // Damaged or meant for another key: the record stays closed and the reducer says so.
      }
    }
  }
  return plaintexts
}
