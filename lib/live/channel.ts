import { publish, subscribe } from "../nostr/client.ts"
import { nowSeconds } from "../nostr/time.ts"
import type { EventTemplate } from "../nostr/types.ts"
import type { HandshakeParse } from "../protocol/handshake.ts"
import { KIND_EPHEMERAL } from "../protocol/kinds.ts"
import type { SignedEvent } from "../protocol/tags.ts"
import type { MatchKey } from "./keys.ts"

// The messages of a board code or a handoff (kind 21180): NIP-44 between two one-time keys,
// read from a subscription to this key. Relays keep none of them, so a message reaches only a
// listener that is there already: senders repeat until answered (repeat below).

export interface ChannelFlow<M> {
  plaintext: (message: M) => string
  template: (opts: { recipient: string; ciphertext: string; created_at: number }) => EventTemplate
  parse: (event: unknown, opts: { plaintext?: string | null; now: number }) => HandshakeParse<M>
}

export interface Channel<M> {
  key: MatchKey
  send: (to: string, message: M) => Promise<void>
  close: () => void
}

export function openChannel<M>(flow: ChannelFlow<M>, key: MatchKey, relays: readonly string[], onMessage: (message: M, from: string) => void): Channel<M> {
  const sub = subscribe([{ kinds: [KIND_EPHEMERAL], "#p": [key.pubkey], since: nowSeconds() - 60 }], relays, {
    onevent: (event) => void receive(event as SignedEvent),
  })
  async function receive(event: SignedEvent) {
    let plaintext: string | null = null
    try {
      plaintext = await key.signer.nip44!.decrypt(event.pubkey, event.content)
    } catch {
      // Not for this key, or damaged: ignored like any stranger's message.
    }
    const parsed = flow.parse(event, { plaintext, now: nowSeconds() })
    if (parsed.ok && parsed.to === key.pubkey) onMessage(parsed.message, parsed.from)
  }
  return {
    key,
    async send(to, message) {
      const ciphertext = await key.signer.nip44!.encrypt(to, flow.plaintext(message))
      await publish(await key.signer.signEvent(flow.template({ recipient: to, ciphertext, created_at: nowSeconds() })), relays)
    },
    close: () => sub.close(),
  }
}

// How often an unanswered message goes out again.
export const REPEAT_MS = 3000

// Sends now and again every REPEAT_MS until stopped.
export function repeat(send: () => Promise<void>): () => void {
  const fire = () => void send().catch(() => {})
  fire()
  const timer = setInterval(fire, REPEAT_MS)
  return () => clearInterval(timer)
}
