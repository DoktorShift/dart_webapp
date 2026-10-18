import type { EventTemplate } from "../nostr/types.ts"
import { STATS_CARD_D, type StatsCard } from "./profile.ts"
import { buildRecord, parseRecord, type BlueLineRecord } from "./records.ts"

// Writing and reading the stats card (./profile.ts, docs/protocol/families/profile.md).

export function statsCardTemplate(card: StatsCard, created_at: number): EventTemplate {
  return buildRecord("profile.stats", card, { created_at, d: STATS_CARD_D })
}

// The card in a signed event by `pubkey`, or null when it is none (another d, another author,
// a newer format, invalid content).
export function readStatsCard(event: unknown, pubkey: string, now?: number): { card: StatsCard; createdAt: number } | null {
  const parsed = parseRecord(event, { now })
  if (parsed.status !== "ok" || parsed.record.type !== "profile.stats") return null
  const record = parsed.record as BlueLineRecord<"profile.stats">
  if (record.d !== STATS_CARD_D || record.pubkey !== pubkey) return null
  return { card: record.content, createdAt: record.created_at }
}
