// NIP-05 checks from the browser: does an address (name@domain) point back to this key? Used to
// show another player's address only once it does (an address is a hint, never proof of who
// someone is). nostr-core's verifyNip05 follows redirects, which NIP-05 forbids, sends the page
// as referrer and waits without limit; this check doesn't. To be upstreamed to nostr-core.
import { loadCore } from "../core.ts"

const NAME = /^[a-z0-9._-]+$/
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export async function verifyNip05(address: string, pubkey: string, options: { timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<boolean> {
  const core = await loadCore()
  let parts: { name: string; domain: string }
  try {
    parts = core.parseNip05Address(address.trim())
  } catch {
    return false
  }
  const name = parts.name.toLowerCase()
  const domain = parts.domain.toLowerCase()
  if (!NAME.test(name) || !DOMAIN.test(domain)) return false
  try {
    const response = await (options.fetch ?? fetch)(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`, {
      redirect: "error",
      referrerPolicy: "no-referrer",
      credentials: "omit",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    })
    if (!response.ok) return false
    const body = (await response.json()) as { names?: Record<string, unknown> } | null
    return body?.names?.[name] === pubkey
  } catch {
    return false
  }
}

// How an address reads: "_@domain" is the domain's own name.
export const nip05Label = (address: string) => (address.startsWith("_@") ? address.slice(2) : address)
