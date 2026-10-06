// Relative .ts paths: this also runs in the Node tests (tests/profile-publish.test.ts).
import { addProfilePlayer, claimPlayer, claimSeat } from "../../lib/profile/claim.ts"
import { metadataTemplate } from "../../lib/profile/metadata.ts"
import { newRelayList, relayListTemplate } from "../../lib/profile/relay-list.ts"
import { startLocalProfile } from "../../lib/profile/session.ts"
import { safeImageUrl } from "../../lib/shell/avatar.ts"
import { publishOwn } from "../../lib/sync/publish.ts"

// Whose games become the new profile's: one seat of a finished game, a player of this device,
// or nobody (a fresh start).
export type Claim = { matchId: string; seat: number } | { playerId: string } | null

// "Profil anlegen": a new key kept on this device, the chosen player linked to it (only their
// games), then name, picture and relay list published. Only these two public events leave the
// device; games, opponents and earlier guests stay here (PLAN.md "Nutzerwege"). A relay that
// can't be reached doesn't stop anything: the profile is complete on this device first.
export async function createProfile({ name, picture, claim }: { name: string; picture: string; claim: Claim }) {
  const { pubkey } = await startLocalProfile()
  const claimed = claim === null ? false : "matchId" in claim ? await claimSeat(claim.matchId, claim.seat, pubkey, name) : await claimPlayer(claim.playerId, pubkey, name)
  if (!claimed) await addProfilePlayer(pubkey, name)
  const url = safeImageUrl(picture)
  await publishOwn([relayListTemplate(newRelayList()), metadataTemplate({ name: name.trim(), ...(url ? { picture: url } : {}) })])
}
