// The relay catalog (docs/decisions/0002, section 5). No network code here: just which relays
// to use for what, and how to tell independent copies apart.
//
// Two roles: "profile" relays carry kinds 0, 10002 and 10008 (purplepag.es only accepts
// kinds 0, 3 and 10000-range lists); "general" relays carry everything else (BlueLine events,
// private records, NIP-51 sets, live games, badges). NWC never uses this catalog: a wallet
// connection brings its own relays.

export type RelayRole = "profile" | "general"

interface CatalogEntry {
  url: string
  // Relays run by the same people count as one copy: an outage or a policy change hits both.
  operator: string
  roles: readonly RelayRole[]
}

const CATALOG: readonly CatalogEntry[] = [
  { url: "wss://nos.lol", operator: "nos.lol", roles: ["profile", "general"] },
  { url: "wss://relay.primal.net", operator: "primal", roles: ["profile", "general"] },
  { url: "wss://nostr-01.yakihonne.com", operator: "yakihonne", roles: ["profile", "general"] },
  { url: "wss://nostr.oxtr.dev", operator: "oxtr", roles: ["profile", "general"] },
  { url: "wss://purplepag.es", operator: "purplepages", roles: ["profile"] },
]

// Known operators of relays outside the default set, so a player's own relay list doesn't count
// two relays of one operator as two independent copies.
const KNOWN_OPERATORS: Record<string, string> = {
  "nos.lol": "nos.lol",
  "nostr.mom": "nos.lol",
  "relay.primal.net": "primal",
  "nostr-01.yakihonne.com": "yakihonne",
  "nostr.oxtr.dev": "oxtr",
  "purplepag.es": "purplepages",
}

// A copy counts as "published" once this many relays of different operators confirmed it.
export const PUBLISHED_MIN_OPERATORS = 2

// Relay URLs in one spelling, so the same relay is never counted twice: scheme and host in
// lower case, no default port, no trailing slash, no query or fragment. Only ws:// and wss://
// are relays; plain ws:// only for this machine (tests, local previews). Returns null for
// anything else.
export function normalizeRelayUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `wss://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") return null
  if (url.protocol === "ws:" && !isLocalHost(url.hostname)) return null
  if (url.username || url.password || !url.hostname) return null
  // A public relay has a domain name or an address; a bare word is a typo.
  if (!isLocalHost(url.hostname) && !url.hostname.includes(".") && !url.hostname.startsWith("[")) return null
  const port = url.port && !((url.protocol === "wss:" && url.port === "443") || (url.protocol === "ws:" && url.port === "80")) ? `:${url.port}` : ""
  const path = url.pathname.replace(/\/+/g, "/").replace(/\/$/, "")
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}`
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

// The build-time override (NEXT_PUBLIC_BLUELINE_RELAYS, comma separated) replaces every default
// relay in both roles, for tests and previews, e.g. "ws://localhost:10547" from `nak serve`.
// Next.js inlines the variable only when it is spelled out literally like this; the try covers
// a browser bundle without it and without a `process` object.
function override(): string[] | null {
  let raw: string | undefined
  try {
    raw = process.env.NEXT_PUBLIC_BLUELINE_RELAYS
  } catch {
    raw = undefined
  }
  if (!raw) return null
  const urls = unique(raw.split(",").map(normalizeRelayUrl))
  return urls.length ? urls : null
}

function unique(urls: (string | null)[]): string[] {
  return [...new Set(urls.filter((url): url is string => url !== null))]
}

// The default relays for a role, in catalog order.
export function defaultRelays(role: RelayRole): string[] {
  return override() ?? CATALOG.filter((entry) => entry.roles.includes(role)).map((entry) => entry.url)
}

export const profileRelays = () => defaultRelays("profile")
export const generalRelays = () => defaultRelays("general")

// Which operator runs a relay. Unknown public relays are grouped by their registrable domain
// (approximated by the last two host labels), local and IP relays by host and port.
export function operatorOf(url: string): string {
  const normalized = normalizeRelayUrl(url)
  if (!normalized) return url
  const host = new URL(normalized).host
  const hostname = new URL(normalized).hostname
  if (KNOWN_OPERATORS[hostname]) return KNOWN_OPERATORS[hostname]
  if (isLocalHost(hostname) || /^[\d.]+$/.test(hostname) || hostname.startsWith("[")) return host
  return hostname.split(".").slice(-2).join(".")
}

// How many independent operators the given relays represent.
export function countOperators(urls: readonly string[]): number {
  return new Set(urls.map(operatorOf)).size
}

// True once relays of at least two different operators confirmed a copy (OK true). Fully
// distributed is a separate question: every target confirmed.
export function isPublished(confirmedUrls: readonly string[]): boolean {
  return countOperators(confirmedUrls) >= PUBLISHED_MIN_OPERATORS
}

// Merges relay lists (defaults, a player's own list, hints from a link) into one list without
// duplicates or invalid entries, keeping the first spelling's order.
export function mergeRelays(...lists: readonly (readonly string[])[]): string[] {
  return unique(lists.flat().map(normalizeRelayUrl))
}
