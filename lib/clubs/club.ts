import type { NostrEvent, Signer } from "../nostr/types.ts"
import type { ClubRole } from "../protocol/club.ts"
import type { ClubState, JoinRequest } from "../protocol/club-state.ts"
import { reduceClub } from "../protocol/club-state.ts"
import { KIND_RECORD } from "../protocol/kinds.ts"
import type { FoundingProblem } from "../protocol/replay.ts"
import { readLabels, tagValue } from "../protocol/tags.ts"
import { closedDates, publicDates, type ClubDate } from "./dates.ts"
import { awaitsVerdict, readGames, type ClubGame } from "./games.ts"
import { openClubRecords, openGameRecords } from "./open.ts"
import type { OpenedInvite, StoredClub } from "./store.ts"
import { belongsTo, countsFor, currentSeason, rulesOf } from "./table.ts"

// A club as this profile sees it, from its local copy: the records replayed
// (lib/protocol/club-state.ts) with everything it can open, its dates and games, and where this
// profile stands. Nothing here talks to relays; sync.ts brings new events first.

export type MemberStatus =
  // In the club.
  | "member"
  // Asked to join (personal invite, no invite, or a group link of a club with a member limit):
  // "Deine Anfrage wartet auf Bestätigung".
  | "request"
  // Joined a closed club whose records this profile can't open yet: a leader's device shares
  // access the next time it opens the club.
  | "joined"
  | "left"
  | "removed"
  | "none"

export interface Membership {
  pubkey: string | null
  role: ClubRole | null
  status: MemberStatus
  request?: JoinRequest
  former?: ClubState["former"][string]
}

export interface ClubInfo {
  name: string
  about?: string
  picture?: string
  visibility: "closed" | "public"
  archived: boolean
}

export interface ClubView {
  id: string
  // null while the founding can't be read: not loaded yet, or sealed for this profile.
  state: ClubState | null
  problem: FoundingProblem | null
  // From the records, or until they can be read, from the invite's preview.
  info: ClubInfo | null
  me: Membership
  dates: ClubDate[]
  games: ClubGame[]
  invite?: OpenedInvite
  tokens: Record<string, string>
  // Relays an invite link named, asked along with the usual ones.
  relays: string[]
  // Own events no relay has confirmed yet.
  unsent: NostrEvent[]
  loadedAt: number | null
}

const isClubRecord = (club: string) => (e: NostrEvent) => e.kind === KIND_RECORD && (e.id === club || tagValue(e.tags, "e") === club)

function membership(state: ClubState | null, events: readonly NostrEvent[], club: string, pubkey: string | null): Membership {
  if (!pubkey) return { pubkey, role: null, status: "none" }
  if (!state) {
    const joined = events.some((e) => e.pubkey === pubkey && readLabels(e.tags)?.type === "club.join" && tagValue(e.tags, "e") === club)
    return { pubkey, role: null, status: joined ? "joined" : "none" }
  }
  const member = state.members[pubkey]
  if (member) return { pubkey, role: member.role, status: "member" }
  const request = state.requests[pubkey]
  if (request) return { pubkey, role: null, status: "request", request }
  const former = state.former[pubkey]
  if (former) return { pubkey, role: null, status: former.how, former }
  return { pubkey, role: null, status: "none" }
}

export async function readClub(
  stored: StoredClub,
  { reader, signer, now }: { reader: string | null; signer: Signer | null; now: number },
): Promise<{ view: ClubView; keys: Record<string, string> }> {
  const club = stored.club
  const records = stored.events.filter(isClubRecord(club))
  const opened = await openClubRecords(records, club, { reader, signer, known: stored.keys })
  const reduced = reduceClub(records, club, { now, open: (e) => opened.plaintexts.get(e.id) ?? null })
  const state = reduced.state
  const games = state ? readGames(state, stored.events, await openGameRecords(stored.events, Object.values(state.games)), now) : []
  const dates = !state ? [] : state.info.visibility === "closed" ? closedDates(state) : await publicDates(stored.events, state)
  const preview = stored.invite?.preview
  const info: ClubInfo | null = state
    ? { name: state.info.name, about: state.info.about, picture: state.info.picture, visibility: state.info.visibility, archived: state.info.archived }
    : preview
      ? { name: preview.name, about: preview.about, picture: preview.picture, visibility: "closed", archived: false }
      : null
  const fresh = Object.fromEntries(Object.entries(opened.keys).filter(([id]) => !(id in stored.keys)))
  return {
    view: {
      id: club,
      state,
      problem: reduced.state ? null : reduced.problem,
      info,
      me: membership(state, records, club, reader),
      dates,
      games,
      ...(stored.invite ? { invite: stored.invite } : {}),
      tokens: stored.tokens,
      relays: stored.relays,
      unsent: stored.events.filter((e) => stored.unsent.includes(e.id)),
      loadedAt: stored.loadedAt,
    },
    keys: fresh,
  }
}

export const isLeader = (role: ClubRole | null) => role === "owner" || role === "admin" || role === "director"
export const isManager = (role: ClubRole | null) => role === "owner" || role === "admin"

// The next club date that hasn't ended or been cancelled.
export const nextDate = (view: ClubView, now: number) => view.dates.find((d) => !d.cancelled && (d.ends ?? d.starts + 4 * 3600) > now) ?? null

// What this profile could do next in the club, most pressing first: the club view shows the
// first one, "Club verwalten" the leaders' ones (PLAN.md: "Offene Aufgaben zuerst").
export type ClubTask =
  | { kind: "ownership" }
  | { kind: "verdict"; game: ClubGame }
  | { kind: "requests"; count: number }
  | { kind: "decide"; game: ClubGame }
  | { kind: "answer"; date: ClubDate }

export function clubTasks(view: ClubView, now: number): ClubTask[] {
  const { state, me } = view
  if (!state || me.status !== "member" || !me.pubkey || state.info.archived) return []
  const tasks: ClubTask[] = []
  const pubkey = me.pubkey
  if (state.offer?.to === pubkey && state.offer.expires > now) tasks.push({ kind: "ownership" })
  for (const game of view.games) if (awaitsVerdict(game, pubkey)) tasks.push({ kind: "verdict", game })
  if (isManager(me.role)) {
    const count = Object.keys(state.requests).length
    if (count > 0) tasks.push({ kind: "requests", count })
  }
  const season = currentSeason(state, now)
  if (season && isLeader(me.role)) {
    const decided = state.results[season.id] ?? {}
    for (const game of view.games) if (belongsTo(season, game) && countsFor(game, rulesOf(season), decided[game.match]) === "disputed") tasks.push({ kind: "decide", game })
  }
  const date = nextDate(view, now)
  if (date && !(pubkey in date.answers)) tasks.push({ kind: "answer", date })
  return tasks
}
