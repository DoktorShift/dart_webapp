import { loadCore } from "./core.ts"

// Whether an address is a relay that answers, before it goes on a profile's relay list: its
// NIP-11 information document (nostr-core's fetchRelayInfo), within a time limit. No answer in
// time, an HTTP error or something that isn't such a document all count as "doesn't answer".
export async function relayAnswers(url: string, timeoutMs = 6000): Promise<boolean> {
  const { fetchRelayInfo } = await loadCore()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)))
  try {
    const info = await Promise.race([fetchRelayInfo(url).catch(() => null), late])
    return typeof info === "object" && info !== null && !Array.isArray(info)
  } finally {
    clearTimeout(timer)
  }
}
