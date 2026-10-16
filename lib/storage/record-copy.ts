import type { NostrEvent } from "../nostr/types.ts"

// The part every local copy of signed records shares (a club's, a tournament's): the events
// themselves, each once, and the relays its links named. Both are only ever added to.
export interface RecordCopy {
  events: NostrEvent[]
  relays: string[]
}

export function addToCopy<T extends RecordCopy>(copy: T, added: { events?: readonly NostrEvent[]; relays?: readonly string[] }): T {
  const byId = new Map(copy.events.map((e) => [e.id, e]))
  for (const event of added.events ?? []) if (!byId.has(event.id)) byId.set(event.id, event)
  return { ...copy, events: [...byId.values()], relays: added.relays ? [...new Set([...copy.relays, ...added.relays])] : copy.relays }
}
