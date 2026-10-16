import { query } from "../nostr/client.ts"

// How the profile's relays answer right now, for Profil › Erweitert and the diagnostics: one
// small question each (the profile's metadata), timed.

export type RelayState = "connected" | "slow" | "unreachable"

export interface RelayStatus {
  url: string
  state: RelayState
  // How long the answer took; null without one.
  ms: number | null
  // Why there was no answer (a relay's prefix, "timeout", "unreachable"); null with one.
  problem: string | null
}

// Slower than this to answer one small question counts as slow.
const SLOW_MS = 1500

export async function probeRelays(urls: readonly string[], pubkey: string): Promise<RelayStatus[]> {
  return Promise.all(
    urls.map(async (url): Promise<RelayStatus> => {
      const started = Date.now()
      const result = await query([{ kinds: [0], authors: [pubkey], limit: 1 }], [url], { timeoutMs: 6000 })
      const ms = Date.now() - started
      if (result.answered.length === 0) return { url, state: "unreachable", ms: null, problem: result.failed[0]?.code || "timeout" }
      return { url, state: ms > SLOW_MS ? "slow" : "connected", ms, problem: null }
    }),
  )
}

// A relay as people read it: its host, without "wss://".
export const relayHost = (url: string) => url.replace(/^wss?:\/\//, "")
