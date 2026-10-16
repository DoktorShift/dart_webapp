import { publish, subscribe } from "./client.ts"
import type { LocalKey } from "./signers.ts"
import { nowSeconds } from "./time.ts"
import type { EventTemplate } from "./types.ts"

// A channel of ephemeral messages between two keys made for the occasion: NIP-44 between the
// two, the recipient in the "p" tag, read from a subscription to this key. Relays keep none of
// them, so a message reaches only a listener that is there already: senders repeat until
// answered (repeat below). What the messages are, and the kind they travel as, comes from the
// flow (lib/protocol): device pairing, a board code, a handoff.

export interface ChannelFlow<M> {
  // The ephemeral kind of the messages.
  kind: number
  plaintext: (message: M) => string
  // The event for an encrypted message (`message` is there for flows whose template depends on it).
  template: (opts: { message: M; recipient: string; ciphertext: string; created_at: number }) => EventTemplate
  parse: (event: unknown, opts: { plaintext?: string | null; now: number }) => { ok: true; message: M; from: string; to: string | null } | { ok: false }
}

export interface Channel<M> {
  key: LocalKey
  send: (to: string, message: M) => Promise<void>
  close: () => void
}

export function openChannel<M>(flow: ChannelFlow<M>, key: LocalKey, relays: readonly string[], onMessage: (message: M, from: string) => void): Channel<M> {
  const sub = subscribe([{ kinds: [flow.kind], "#p": [key.pubkey], since: nowSeconds() - 60 }], relays, {
    onevent: (event) => void receive(event),
  })
  async function receive(event: unknown) {
    const { pubkey, content } = event as { pubkey: string; content: string }
    let plaintext: string | null = null
    try {
      plaintext = await key.signer.nip44!.decrypt(pubkey, content)
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
      await publish(await key.signer.signEvent(flow.template({ message, recipient: to, ciphertext, created_at: nowSeconds() })), relays)
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
