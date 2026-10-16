import { buildListTemplate, parseListSafe, type PrivateStatus, type SafeList } from "../nostr/ext/lists.ts"
import type { EventTemplate, NostrEvent, Signer } from "../nostr/types.ts"
import { kvGet, kvSet } from "../storage/db.ts"
import { randomHex } from "../storage/ids.ts"
import { isPubkey } from "../storage/players.ts"

// "Meine Spielerrunden": the groups someone plays with, saved to pick in setup with one tap.
// Stored as NIP-51 follow sets (kind 30000), so they travel with the profile
// (docs/protocol/families/profile.md):
// - public: "d" = blueline-round-<id>, "title", and one "p" tag per player with a profile;
// - private (encrypted to oneself): every seat in order as ["player", name, pubkey?], guests
//   without a profile included, so their names never become public.
// Entries other apps added (their "p" tags, unknown tags) are kept. A round whose private part
// can't be read here is never written over (lib/nostr/ext/lists.ts refuses). A round is deleted
// by an empty version, which relays keep instead of the old one.

const ROUNDS_KIND = 30000
export const ROUND_D_PREFIX = "blueline-round-"
const PLAYER_TAG = "player"

export interface RoundPlayer {
  // Empty when only the public part could be read: the player is known by their profile.
  name: string
  pubkey?: string
}

export interface Round {
  id: string
  title: string
  players: RoundPlayer[]
  // Anything but "decrypted" or "none": this device can't read the guests and names, and won't
  // change the round.
  privateStatus: PrivateStatus
  event: NostrEvent
}

export const newRoundId = () => randomHex(16)

const roundId = (event: NostrEvent) => {
  const d = event.tags.find((tag) => tag[0] === "d")?.[1] ?? ""
  return event.kind === ROUNDS_KIND && d.startsWith(ROUND_D_PREFIX) && d.length > ROUND_D_PREFIX.length ? d.slice(ROUND_D_PREFIX.length) : null
}

const playerOf = (tag: string[]): RoundPlayer | null => {
  const name = tag[1]?.trim() ?? ""
  if (tag[0] !== PLAYER_TAG || !name) return null
  return isPubkey(tag[2]) ? { name, pubkey: tag[2] } : { name }
}

const profileKeys = (tags: string[][]) => tags.filter((tag) => tag[0] === "p" && isPubkey(tag[1])).map((tag) => tag[1])

// The round in a list event, or null when it isn't one of ours or was deleted.
export async function readRound(event: NostrEvent, signer?: Signer | null): Promise<Round | null> {
  const id = roundId(event)
  if (!id) return null
  const list = await parseListSafe(event, signer)
  const seats = list.privateTags.map(playerOf).filter((p): p is RoundPlayer => p !== null)
  // Without a readable private part (or one written by an app that keeps only the public part),
  // the profiles are the players.
  const players = seats.length > 0 ? seats : [...new Set(profileKeys(list.publicTags))].map((pubkey) => ({ name: "", pubkey }))
  if (players.length === 0) return null
  const title = list.publicTags.find((tag) => tag[0] === "title")?.[1]?.trim() ?? ""
  return { id, title, players, privateStatus: list.privateStatus, event }
}

// The profiles BlueLine itself listed in the base version: the ones it may remove again.
function ourProfiles(base: SafeList): Set<string> {
  const ours = base.privateTags.map(playerOf).flatMap((p) => (p?.pubkey ? [p.pubkey] : []))
  return new Set(ours.length > 0 || base.privateStatus === "decrypted" ? ours : profileKeys(base.publicTags))
}

// The list event for a round, on top of the version it replaces. Without encryption (a signer
// that can't), only the players with a profile are saved.
export async function roundTemplate(
  round: { id: string; title: string; players: readonly RoundPlayer[] },
  base: NostrEvent | null,
  signer: Signer,
): Promise<EventTemplate> {
  const baseList = base ? await parseListSafe(base, signer) : undefined
  const keys = [...new Set(round.players.flatMap((p) => (p.pubkey ? [p.pubkey] : [])))]
  const ours = baseList ? ourProfiles(baseList) : new Set<string>()
  const kept = (baseList?.publicTags ?? []).filter((tag) => (tag[0] === "p" ? !ours.has(tag[1]) && !keys.includes(tag[1]) : tag[0] !== "d" && tag[0] !== "title"))
  const publicTags = [["title", round.title.trim()], ...keys.map((key) => ["p", key]), ...kept]
  const privateTags = signer.nip44
    ? [
        ...round.players.map((p) => (p.pubkey ? [PLAYER_TAG, p.name.trim(), p.pubkey] : [PLAYER_TAG, p.name.trim()])),
        ...(baseList?.privateTags ?? []).filter((tag) => tag[0] !== PLAYER_TAG),
      ]
    : undefined
  return buildListTemplate({ kind: ROUNDS_KIND, identifier: `${ROUND_D_PREFIX}${round.id}`, publicTags, privateTags, base: baseList, signer })
}

// The empty version that deletes a round (refused, like any change, when its private part
// can't be read here).
export async function deletedRoundTemplate(base: NostrEvent, signer: Signer): Promise<EventTemplate> {
  const baseList = await parseListSafe(base, signer)
  return buildListTemplate({ kind: ROUNDS_KIND, identifier: baseList.identifier, publicTags: [], privateTags: [], base: baseList, signer })
}

// ---- On this device --------------------------------------------------------------------------

// What each version of a round said, read once: an external signer then decrypts a round once
// per change, not each time setup opens. Keyed by event id; goes with the profile ("profile.*").
const READ_ROUNDS = "profile.rounds"
type ReadRounds = Record<string, Omit<Round, "event">>

// The profile's rounds, newest first, from its events (lib/profile/own-events.ts). Seats known
// only by their profile get the name this device knows them by. The signer is asked for (once)
// only when a round has to be read for the first time: opening setup doesn't wake a signer app
// or an extension for rounds read before.
export async function savedRounds(
  events: Iterable<NostrEvent>,
  signer: Signer | null | (() => Promise<Signer | null>),
  directory: readonly { pubkey?: string; name: string }[],
): Promise<Round[]> {
  const read = (await kvGet<ReadRounds>(READ_ROUNDS).catch(() => undefined)) ?? {}
  const kept: ReadRounds = {}
  const rounds: Round[] = []
  let opened: Promise<Signer | null> | null = null
  const signerFor = () => (opened ??= typeof signer === "function" ? signer() : Promise.resolve(signer))
  for (const event of events) {
    if (!roundId(event)) continue
    const known = read[event.id]
    const round = known ? { ...known, event } : await readRound(event, await signerFor())
    if (!round) continue
    if (round.privateStatus === "decrypted" || round.privateStatus === "none") kept[event.id] = { id: round.id, title: round.title, players: round.players, privateStatus: round.privateStatus }
    rounds.push({ ...round, players: round.players.map((p) => (p.name || !p.pubkey ? p : { ...p, name: directory.find((d) => d.pubkey === p.pubkey)?.name ?? "" })) })
  }
  // Only the versions still current stay remembered.
  if (JSON.stringify(Object.keys(kept).sort()) !== JSON.stringify(Object.keys(read).sort())) await kvSet(READ_ROUNDS, kept).catch(() => {})
  return rounds.sort((a, b) => b.event.created_at - a.event.created_at)
}
