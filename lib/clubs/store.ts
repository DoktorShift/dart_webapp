import type { NostrEvent } from "../nostr/types.ts"
import { CLUB_OBJECT_PREFIX } from "../profile/session.ts"
import type { InvitePreview } from "../protocol/invite.ts"
import { dbGet, dbKeys, dbWrite, type Keyed } from "../storage/db.ts"

// The clubs as this profile knows them: one object per club in the "objects" store
// ("club:<club id>"), deleted with the profile (lib/profile/session.ts). The local copy comes
// first (decision 0002 §1): a club shows at once and offline, relays add what is new. Kept are
// the signed events themselves (club records, its games' match records, public dates and
// answers), never a state derived from them, so every reader replays the same records.

// An invitation this profile opened and has not acted on yet: what the link said and showed.
export interface OpenedInvite {
  invite: string
  token: string
  // A closed club's preview, read with the link (lib/protocol/invite.ts); public clubs show
  // their records instead.
  preview?: InvitePreview
  openedAt: number
}

export interface StoredClub extends Keyed {
  club: string
  events: NostrEvent[]
  // Content keys of sealed records this profile opened, by event id: the signer is asked once.
  keys: Record<string, string>
  // Tokens of the invite links made on this device, by invite id. Only the maker's devices know
  // a link (docs/protocol/families/club.md); the records never carry it.
  tokens: Record<string, string>
  invite?: OpenedInvite
  // Relays the invite link named, read along with the usual ones.
  relays: string[]
  // Games played on this device that were recorded for the club: the local match id and the
  // match it became, so a result shown again (a reload) is never recorded twice.
  recorded: Record<string, string>
  // When relays last answered a fetch of this club (ms); null if never. What this device still
  // has to send is the outbox's to say (send.ts waitingEvents).
  loadedAt: number | null
}

const clubObjectId = (club: string) => `${CLUB_OBJECT_PREFIX}${club}`

const empty = (club: string): StoredClub => ({ id: clubObjectId(club), club, events: [], keys: {}, tokens: {}, relays: [], recorded: {}, loadedAt: null })

export async function loadStoredClub(club: string): Promise<StoredClub | null> {
  const stored = await dbGet<StoredClub>("objects", clubObjectId(club))
  // A copy written before a field existed gets the field's empty value.
  return stored ? { ...empty(club), ...stored } : null
}

export async function storedClubs(): Promise<StoredClub[]> {
  const ids = (await dbKeys("objects")).filter((id) => id.startsWith(CLUB_OBJECT_PREFIX))
  const clubs = await Promise.all(ids.map((id) => loadStoredClub(id.slice(CLUB_OBJECT_PREFIX.length))))
  return clubs.filter((c): c is StoredClub => c !== null)
}

export interface ClubChange {
  events?: readonly NostrEvent[]
  keys?: Readonly<Record<string, string>>
  token?: { invite: string; token: string }
  invite?: OpenedInvite | null
  relays?: readonly string[]
  recorded?: Readonly<Record<string, string>>
  // Relays answered.
  loadedAt?: number
}

// Changes of one club, one after another within this tab, so two quick writes never lose each
// other. Another tab writing at the same moment can only drop events, which the next load
// brings back from relays: events are only ever added.
const queues = new Map<string, Promise<unknown>>()

export function updateClub(club: string, change: ClubChange): Promise<StoredClub> {
  const run = (queues.get(club) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const stored = (await loadStoredClub(club)) ?? empty(club)
    const next = merge(stored, change)
    await dbWrite([{ store: "objects", put: next }])
    return next
  })
  queues.set(club, run)
  return run
}

function merge(stored: StoredClub, change: ClubChange): StoredClub {
  const byId = new Map(stored.events.map((e) => [e.id, e]))
  for (const event of change.events ?? []) if (!byId.has(event.id)) byId.set(event.id, event)
  return {
    ...stored,
    events: [...byId.values()],
    keys: { ...stored.keys, ...change.keys },
    tokens: change.token ? { ...stored.tokens, [change.token.invite]: change.token.token } : stored.tokens,
    invite: change.invite === null ? undefined : (change.invite ?? stored.invite),
    relays: change.relays ? [...new Set([...stored.relays, ...change.relays])] : stored.relays,
    recorded: { ...stored.recorded, ...change.recorded },
    loadedAt: change.loadedAt ?? stored.loadedAt,
  }
}

// Forgets a club this profile only looked at (an invitation it turned down).
export const forgetClub = (club: string) => dbWrite([{ store: "objects", delete: clubObjectId(club) }])
