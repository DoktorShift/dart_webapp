import { nowSeconds } from "../nostr/time.ts"
import type { Signer } from "../nostr/types.ts"
import { readClub, isManager, type ClubView } from "./club.ts"
import { limitMembers, needsCapacity, shareAccess, shareTokens, waitingTokens } from "./membership.ts"
import { fetchClub, fetchOwnClubs, type ClubExtras } from "./relays.ts"
import type { Author, Sent } from "./send.ts"
import { loadStoredClub, storedClubs, updateClub, type StoredClub } from "./store.ts"

// Bringing clubs up to date: what relays have is added to the local copy, then the club is read
// again. A leader's device also does the club's upkeep while it is open: sharing access to
// earlier records with members who joined a closed club since, and setting the member limit of
// a closed club near 100 (docs/protocol/families/club.md). By itself only with a key on this
// device; a signer app would ask for every encryption, so the club shows the upkeep as a task
// instead (grantAccess).

export interface Reader {
  pubkey: string | null
  signer: Signer | null
  // The key is on this device and signs without asking the person.
  automatic: boolean
}

export async function viewClub(stored: StoredClub, reader: Pick<Reader, "pubkey" | "signer">): Promise<ClubView> {
  const { view, keys } = await readClub(stored, { reader: reader.pubkey, signer: reader.signer, now: nowSeconds() })
  if (Object.keys(keys).length > 0) await updateClub(stored.club, { keys }, reader.pubkey)
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
  const known = (await loadStoredClub(club)) ?? (await updateClub(club, {}, reader.pubkey))
  const first = await fetchClub(club, known.relays)
  let stored = await updateClub(club, { events: first.events, ...(first.answered ? { loadedAt: Date.now() } : {}) }, reader.pubkey)
  let view = await viewClub(stored, reader)
  const extras = extrasOf(view)
  if (first.answered && (extras.matches.length > 0 || extras.dates.length > 0)) {
    const more = await fetchClub(club, stored.relays, extras)
    stored = await updateClub(club, { events: more.events, ...(more.answered ? { loadedAt: Date.now() } : {}) }, reader.pubkey)
    view = await viewClub(stored, reader)
  }
  return first.answered ? maintainClub(club, reader) : view
}

// The club's upkeep from its local copy as it is, without asking relays: after a refresh, and
// when a membership change arrives while the club is open. Returns the club as read afterwards.
export async function maintainClub(club: string, reader: Reader): Promise<ClubView> {
  const stored = (await loadStoredClub(club)) ?? (await updateClub(club, {}, reader.pubkey))
  const view = await viewClub(stored, reader)
  if (!reader.pubkey || !reader.signer || !reader.automatic) return view
  if (!(await upkeep(view, stored, { pubkey: reader.pubkey, signer: reader.signer }))) return view
  return viewClub((await loadStoredClub(club)) ?? stored, reader)
}

async function upkeep(view: ClubView, stored: StoredClub, author: Author): Promise<boolean> {
  const { state, me } = view
  if (!state || state.info.archived || me.status !== "member" || !author.signer.nip44) return false
  let changed = false
  // Whoever holds a link's secret gives it to the leaders who lack it (club.md, "Geteilter Link").
  const tokens = waitingTokens(state, stored.events, stored.tokens, nowSeconds())
  if (tokens.length > 0) {
    await shareTokens(state, tokens, stored.tokens, stored.codes, author)
    changed = true
  }
  if (!isManager(me.role)) return changed
  if (view.access.length > 0) {
    await shareAccess(state, stored.events, stored.keys, author, view.access)
    changed = true
  }
  if (needsCapacity(state)) {
    await limitMembers(state, author)
    changed = true
  }
  return changed
}

// Shares access with the members still waiting for it, on the person's tap ("Zugang
// freigeben"): with a signer app, or after the automatic upkeep could not.
export async function grantAccess(club: string, author: Author): Promise<Sent> {
  const stored = await loadStoredClub(club)
  if (!stored) throw new Error("this club is not kept here")
  const view = await viewClub(stored, author)
  if (!view.state) throw new Error("the club's records can't be read here")
  await shareTokens(view.state, waitingTokens(view.state, stored.events, stored.tokens, nowSeconds()), stored.tokens, stored.codes, author)
  return shareAccess(view.state, stored.events, stored.keys, author, view.access)
}

// The clubs this profile has here, after asking relays for clubs it founded or joined on other
// devices. Returns whether relays answered.
export async function discoverClubs(pubkey: string): Promise<boolean> {
  const found = await fetchOwnClubs(pubkey)
  const known = new Set((await storedClubs()).map((c) => c.club))
  for (const club of found.clubs) if (!known.has(club)) await updateClub(club, {}, pubkey)
  return found.answered
}
