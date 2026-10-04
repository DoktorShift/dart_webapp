// App links: everything after "#" in a BlueLine address, so invitations, profile cards,
// pairing codes and signer answers never reach the web server or its logs (decision 0001, F6).
//
//   https://blueline21.netlify.app/#club=<payload>
//
// The payload is an opaque string here; each area defines and checks its own format. No React
// and no browser APIs, so the rules run in the Node unit tests.

export type LinkKind = "p" | "watch" | "club" | "tournament" | "pair" | "board" | "signer-return"

export const LINK_KINDS: readonly LinkKind[] = ["p", "watch", "club", "tournament", "pair", "board", "signer-return"]

export interface AppLink {
  kind: LinkKind
  // Exactly as it appeared after "<kind>=" (still percent-encoded where the sender encoded it).
  payload: string
}

// Longer fragments are not links this app writes; a QR code holds about 4,000 characters at most.
export const MAX_PAYLOAD_LENGTH = 4096

// Whitespace and control characters never belong in a payload; their presence means the text was
// mangled on the way (a line break in a pasted message, a scanned label next to the code).
const INVALID_PAYLOAD = /[\s\u0000-\u001f\u007f]/

function parseFragment(fragment: string): AppLink | null {
  const body = fragment.startsWith("#") ? fragment.slice(1) : fragment
  // A signer app appends its answer to the callback address it was given, which ends in
  // "#signer-return=" (NIP-55). Whatever follows is passed on unchanged, without that "=".
  if (body.startsWith("signer-return")) {
    const rest = body.slice("signer-return".length)
    if (rest !== "" && !"=?&/".includes(rest[0])) return null
    const payload = rest.startsWith("=") ? rest.slice(1) : rest
    return payload.length <= MAX_PAYLOAD_LENGTH && !INVALID_PAYLOAD.test(payload) ? { kind: "signer-return", payload } : null
  }
  const split = body.indexOf("=")
  if (split <= 0) return null
  const kind = body.slice(0, split)
  const payload = body.slice(split + 1)
  if (!(LINK_KINDS as readonly string[]).includes(kind)) return null
  if (payload.length === 0 || payload.length > MAX_PAYLOAD_LENGTH || INVALID_PAYLOAD.test(payload)) return null
  return { kind: kind as LinkKind, payload }
}

// The link in the fragment of the page's own address (location.hash), or null for anything else.
export const parseHash = (hash: string): AppLink | null => (hash ? parseFragment(hash) : null)

// A link that was scanned, pasted or typed: a full address, an address without "https://", or
// just the part from "#" on. Full addresses count only when they point at this app (`origins`,
// for example the current origin and the published site), so a code from another site is never
// taken for an invitation.
export function parseAppLink(input: string, origins: readonly string[]): AppLink | null {
  const text = input.trim()
  if (!text || text.length > MAX_PAYLOAD_LENGTH + 200) return null
  if (text.startsWith("#")) return parseFragment(text)
  const allowed = new Set(origins.map(originOf).filter((o): o is string => o !== null))
  for (const candidate of [text, `https://${text}`]) {
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      continue
    }
    // "localhost:3000/#club=…" parses with "localhost:" as its scheme; try it with https:// too.
    if (url.protocol !== "https:" && url.protocol !== "http:") continue
    if (!allowed.has(url.origin)) return null
    // Links point at the start page; other pages never carry app links.
    if (url.pathname !== "/" && url.pathname !== "") return null
    return url.hash ? parseFragment(url.hash) : null
  }
  return null
}

function originOf(address: string): string | null {
  try {
    const origin = new URL(address).origin
    return origin === "null" ? null : origin
  } catch {
    return null
  }
}

// The address for a link, on the given site ("https://blueline21.netlify.app").
export function buildLink(site: string, kind: LinkKind, payload: string): string {
  if (kind !== "signer-return" && payload.length === 0) throw new Error("An app link needs a payload")
  if (payload.length > MAX_PAYLOAD_LENGTH || INVALID_PAYLOAD.test(payload)) throw new Error("Invalid app link payload")
  const origin = originOf(site)
  if (!origin) throw new Error(`Not an address: ${site}`)
  return `${origin}/#${kind}=${payload}`
}
