import { withArchive } from "./archive.ts"
import { kvGet, kvSet } from "./db.ts"
import { randomHex } from "./ids.ts"
import { isPlayerId, isPubkey, parsePlayerRecord, type PlayerRecord } from "./players.ts"

// An append-only, profile-scoped history. Every change has its own encrypted relay slot.
// A removal wins over a concurrent addition; an explicit later addition can link again.
export const LINK_OP_PREFIX = "player-link:"
const KEY_PREFIX = "player-links.v2."
export interface PlayerLinkOp {
  id: string
  source: string
  target: string | null
  seen: string[]
  sourcePlayer?: PlayerRecord
  targetPlayer?: PlayerRecord
}

export function parseLinkOp(value: unknown): PlayerLinkOp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || !/^[0-9a-f]{32}$/.test(v.id) || !isPlayerId(v.source) || (v.target !== null && !isPlayerId(v.target)) || v.source === v.target) return null
  if (!Array.isArray(v.seen) || v.seen.length > 10000 || v.seen.some((id) => typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id) || id === v.id)) return null
  const sourcePlayer = v.sourcePlayer === undefined ? undefined : parsePlayerRecord(v.sourcePlayer)
  const targetPlayer = v.targetPlayer === undefined ? undefined : parsePlayerRecord(v.targetPlayer)
  if ((v.sourcePlayer !== undefined && (!sourcePlayer || sourcePlayer.id !== v.source || sourcePlayer.pubkey)) ||
      (v.targetPlayer !== undefined && (!targetPlayer || targetPlayer.id !== v.target || !targetPlayer.pubkey))) return null
  if (v.target !== null && (!sourcePlayer || !targetPlayer)) return null
  return { id: v.id, source: v.source, target: v.target as string | null, seen: [...new Set(v.seen as string[])].sort(), ...(sourcePlayer ? { sourcePlayer } : {}), ...(targetPlayer ? { targetPlayer } : {}) }
}

export async function loadLinkOps(pubkey: string): Promise<PlayerLinkOp[]> {
  if (!isPubkey(pubkey)) return []
  const value = await kvGet<unknown>(KEY_PREFIX + pubkey)
  if (!Array.isArray(value)) return []
  return value.flatMap((v) => parseLinkOp(v) ?? [])
}

export function resolveLinkState(ops: readonly PlayerLinkOp[]): { links: Record<string, string>; conflicts: Record<string, string[]> } {
  const sourceOf = new Map(ops.map((op) => [op.id, op.source]))
  const superseded = new Set(ops.flatMap((op) => op.seen.filter((id) => sourceOf.get(id) === op.source)))
  const groups = new Map<string, PlayerLinkOp[]>()
  for (const op of ops) if (!superseded.has(op.id)) groups.set(op.source, [...(groups.get(op.source) ?? []), op])
  const links: Record<string, string> = {}
  const conflicts: Record<string, string[]> = {}
  for (const [source, changes] of groups) {
    const targets = new Set(changes.map((op) => op.target))
    if (targets.size === 1 && !targets.has(null)) links[source] = changes[0].target!
    else if (targets.size > 1) conflicts[source] = [...targets].filter((id): id is string => id !== null)
  }
  return { links, conflicts }
}
export const resolveLinkOps = (ops: readonly PlayerLinkOp[]) => resolveLinkState(ops).links

// Caller owns withArchive; the complete history is kept even after sign-out so offline edits
// remain available to that profile and cannot leak into another one's view.
export async function appendLinkOp(pubkey: string, source: string, target: string | null, sourcePlayer?: PlayerRecord, targetPlayer?: PlayerRecord, alive: () => boolean = () => true) {
  const ops = await loadLinkOps(pubkey)
  const op = parseLinkOp({ id: randomHex(16), source, target, seen: ops.filter((o) => o.source === source).map((o) => o.id), ...(sourcePlayer ? { sourcePlayer } : {}), ...(targetPlayer ? { targetPlayer } : {}) })
  if (!op) throw new Error("invalid player association")
  if (!alive()) throw new Error("profile changed while associating players")
  await kvSet(KEY_PREFIX + pubkey, [...ops, op])
}

export async function mergeLinkOps(pubkey: string, incoming: readonly PlayerLinkOp[], alive: () => boolean = () => true): Promise<boolean> {
  if (!isPubkey(pubkey)) return false
  return withArchive(async () => {
    const existing = await loadLinkOps(pubkey)
    const known = new Set(existing.map((op) => op.id))
    const fresh = incoming.flatMap((raw) => {
      const op = parseLinkOp(raw)
      if (!op || known.has(op.id)) return []
      known.add(op.id)
      return [op]
    })
    if (!alive()) return false
    if (fresh.length) await kvSet(KEY_PREFIX + pubkey, [...existing, ...fresh])
    return true
  })
}

export const linkOpsKey = (pubkey: string) => KEY_PREFIX + pubkey
