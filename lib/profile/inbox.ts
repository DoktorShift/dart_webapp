import { subscribe, type Closer } from "../nostr/client.ts"
import { GIFT_WRAP_KIND, unwrapWithSigner, type Rumor } from "../nostr/ext/crypto.ts"
import { generalRelays } from "../nostr/relays.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { NostrEvent, Signer } from "../nostr/types.ts"
import { readLabels } from "../protocol/tags.ts"

// The profile's inbox: the gift wraps (NIP-59) addressed to it at the general relays, opened
// once each and handed to whichever area reads that kind of rumor (club invitations, friend
// messages), by the rumor's record type. Only with a signer that decrypts without asking (a
// key on this device): a signer app would prompt for every wrap, other apps' wraps included.
// An area that registers after a rumor arrived gets it then: the last few unread ones wait.

export interface InboxReader {
  pubkey: string
  signer: Signer
}

export interface Opened {
  rumor: Rumor
  sender: string
  reader: InboxReader
}

export type InboxHandler = (opened: Opened) => void | Promise<void>

const DAY = 24 * 60 * 60
// Wraps carry a time up to two days in the past (NIP-59); a week more for someone who opens the
// app late.
const INBOX_DAYS = 9
// Unread rumors kept per record type for a reader that registers later.
const WAITING_PER_TYPE = 50

const handlers = new Map<string, InboxHandler>()
const waiting: Opened[] = []
let open: { pubkey: string; sub: Closer } | null = null

function dispatch(opened: Opened) {
  const type = readLabels(opened.rumor.tags)?.type
  if (!type) return
  const handler = handlers.get(type)
  if (handler) return void handler(opened)
  const same = waiting.filter((w) => readLabels(w.rumor.tags)?.type === type)
  if (same.length >= WAITING_PER_TYPE) waiting.splice(waiting.indexOf(same[0]), 1)
  waiting.push(opened)
}

// Registers the reader of one record type; what arrived for it meanwhile is handed over now.
export function onInboxRecord(type: string, handler: InboxHandler): () => void {
  handlers.set(type, handler)
  for (let i = waiting.length - 1; i >= 0; i--) {
    const opened = waiting[i]
    if (readLabels(opened.rumor.tags)?.type !== type) continue
    waiting.splice(i, 1)
    void handler(opened)
  }
  return () => {
    if (handlers.get(type) === handler) handlers.delete(type)
  }
}

// Follows the profile's wraps; a second start for the same profile changes nothing, one for
// another profile replaces the first.
export function startInbox(reader: InboxReader) {
  if (open?.pubkey === reader.pubkey) return
  stopInbox()
  const seen = new Set<string>()
  const handle = async (wrap: NostrEvent) => {
    if (seen.has(wrap.id)) return
    seen.add(wrap.id)
    let opened: Awaited<ReturnType<typeof unwrapWithSigner>>
    try {
      opened = await unwrapWithSigner(wrap, reader.signer)
    } catch {
      // Not for this key, or no rumor of ours: other apps' wraps land here too.
      return
    }
    // The profile may have signed out while the wrap was opened.
    if (open?.pubkey === reader.pubkey) dispatch({ ...opened, reader })
  }
  const sub = subscribe([{ kinds: [GIFT_WRAP_KIND], "#p": [reader.pubkey], since: nowSeconds() - INBOX_DAYS * DAY }], generalRelays(), { onevent: (event) => void handle(event) })
  open = { pubkey: reader.pubkey, sub }
}

export function stopInbox() {
  open?.sub.close()
  open = null
  waiting.length = 0
}

export const inboxOpenFor = () => open?.pubkey ?? null
