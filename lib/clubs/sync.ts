import { nowSeconds } from "../nostr/time.ts"
import type { Signer } from "../nostr/types.ts"
import { readClub, isManager, type ClubView } from "./club.ts"
import { limitMembers, needsAccess, needsCapacity, shareAccess } from "./membership.ts"
import { fetchClub, fetchOwnClubs, type ClubExtras } from "./relays.ts"
import type { Author } from "./send.ts"
import { loadStoredClub, storedClubs, updateClub, type StoredClub } from "./store.ts"

// Bringing clubs up to date: what relays have is added to the local copy, then the club is read
// again. A leader's device also does the club's upkeep while it is open: sharing access to
// earlier records with members who joined a closed club since, and setting the member limit of
// a closed club near 100 (docs/protocol/families/club.md).

export interface Reader {
  pubkey: string | null
  signer: Signer | null
}

export async function viewClub(stored: StoredClub, reader: Reader): Promise<ClubView> {
  const { view, keys } = await readClub(stored, { reader: reader.pubkey, signer: reader.signer, now: nowSeconds() })
  if (Object.keys(keys).length > 0) await updateClub(stored.club, { keys })
  return view
}

// The matches of the club's games and the addresses of its public dates: asked for next.
const extrasOf = (view: ClubView): ClubExtras => ({
  matches: view.state ? Object.keys(view.state.games) : [],
  dates: view.dates.filter((d) => d.calendar).map((d) => d.id),
})

const inFlight = new Map<string, Promise<ClubView>>()

// One refresh per club at a time: the home list and an open club ask together.
export function refreshClub(club: string, reader: Reader): Promise<ClubView> {
  const running = inFlight.get(club)
  if (running) return running
  const run = refresh(club, reader).finally(() => inFlight.delete(club))
  inFlight.set(club, run)
  return run
}

async function refresh(club: string, reader: Reader): Promise<ClubView> {
  const known = (await loadStoredClub(club)) ?? (await updateClub(club, {}))
  const first = await fetchClub(club, known.relays)
  let stored = await updateClub(club, { events: first.events, ...(first.answered ? { loadedAt: Date.now() } : {}) })
  let view = await viewClub(stored, reader)
  const extras = extrasOf(view)
  if (first.answered && (extras.matches.length > 0 || extras.dates.length > 0)) {
    const more = await fetchClub(club, stored.relays, extras)
    stored = await updateClub(club, { events: more.events, ...(more.answered ? { loadedAt: Date.now() } : {}) })
    view = await viewClub(stored, reader)
  }
  if (first.answered && reader.pubkey && reader.signer) {
    // With the keys reading the club just opened.
    const latest = (await loadStoredClub(club)) ?? stored
    if (await upkeep(view, latest, { pubkey: reader.pubkey, signer: reader.signer })) view = await viewClub((await loadStoredClub(club)) ?? latest, reader)
  }
  return view
}

async function upkeep(view: ClubView, stored: StoredClub, author: Author): Promise<boolean> {
  const { state, me } = view
  if (!state || state.info.archived || !isManager(me.role) || !author.signer.nip44) return false
  let changed = false
  if (needsAccess(state, author.pubkey)) {
    await shareAccess(state, stored.events, stored.keys, author)
    changed = true
  }
  if (needsCapacity(state)) {
    await limitMembers(state, author)
    changed = true
  }
  return changed
}

// The clubs this profile has here, after asking relays for clubs it founded or joined on other
// devices. Returns whether relays answered.
export async function discoverClubs(pubkey: string): Promise<boolean> {
  const found = await fetchOwnClubs(pubkey)
  const known = new Set((await storedClubs()).map((c) => c.club))
  for (const club of found.clubs) if (!known.has(club)) await updateClub(club, {})
  return found.answered
}
