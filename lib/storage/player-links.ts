import { withArchive } from "./archive.ts"
import { dbGetAll, kvGet, kvSet } from "./db.ts"
import type { ArchivedMatch } from "./archive.ts"
import { importedAliases, type PlayerRecord } from "./players.ts"
import { playerKey } from "./stats.ts"

// Local, reversible associations. Archived records and public profiles are never rewritten.
const KEY = "leaderboard.player-links"
export type PlayerLinks = Record<string, string>

export async function loadPlayerLinks(): Promise<PlayerLinks> {
  const value = await kvGet<unknown>(KEY)
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([source, target]) => typeof target === "string" && source !== target)) as PlayerLinks
}

// Collapse an explicit link onto the profile's canonical player where one is already known.
export function playerLinkAliases(links: PlayerLinks, base?: ReadonlyMap<string, string>, matches: readonly ArchivedMatch[] = [], imported?: Map<string, string>, players?: readonly PlayerRecord[]): Map<string, string> {
  const result = new Map(base)
  const destinations = new Map(Object.entries(links).map(([source, target]) => [source, base?.get(target) ?? target]))
  for (const [source, target] of destinations) {
    if (players) {
      const guest = players.find((p) => p.id === source)
      const profile = players.find((p) => p.id === links[source])
      if (!guest || guest.pubkey || !profile?.pubkey) continue
    }
    const targetPubkey = players?.find((p) => p.id === links[source])?.pubkey
    const group = new Set([target])
    for (const [id, canonical] of base ?? []) if (canonical === target) group.add(id)
    for (const [id, canonical] of destinations) if (canonical === target && id !== source) group.add(id)
    const conflicts = matches.some((match) => {
      const ids = match.players.map((p) => playerKey(match, p, imported)?.replace(/^id:/, ""))
      return ids.includes(source) && match.players.some((player, i) => ids[i] !== source && ((ids[i] !== undefined && group.has(ids[i]!)) || (!!targetPubkey && player.pubkey === targetPubkey)))
    })
    if (!conflicts) result.set(source, target)
  }
  return result
}

export type LinkResult = "linked" | "invalid" | "conflict"
export function linkLocalPlayer(source: string, target: string): Promise<LinkResult> {
  return withArchive(async () => {
    const [players, matches, links] = await Promise.all([dbGetAll<PlayerRecord>("players"), dbGetAll<ArchivedMatch>("matches"), loadPlayerLinks()])
    const guest = players.find((p) => p.id === source)
    const profile = players.find((p) => p.id === target)
    if (!guest || guest.pubkey || !profile?.pubkey || source === target || links[source]) return "invalid"
    // A profile may have multiple local ids; include existing associations when checking games.
    const targetIds = new Set(players.filter((p) => p.pubkey === profile.pubkey).map((p) => p.id))
    for (const [id, mapped] of Object.entries(links)) if (targetIds.has(mapped)) targetIds.add(id)
    const imported = importedAliases(players)
    if (matches.some((match) => {
      const ids = match.players.map((p) => playerKey(match, p, imported)?.replace(/^id:/, ""))
      return ids.includes(source) && match.players.some((p, i) => p.pubkey === profile.pubkey || (ids[i] && targetIds.has(ids[i]!)))
    })) return "conflict"
    await kvSet(KEY, { ...links, [source]: target })
    return "linked"
  })
}

export function unlinkLocalPlayer(source: string): Promise<void> {
  return withArchive(async () => {
    const links = await loadPlayerLinks()
    if (!(source in links)) return
    delete links[source]
    await kvSet(KEY, links)
  })
}
