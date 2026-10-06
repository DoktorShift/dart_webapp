import type { EventTemplate, NostrEvent } from "../nostr/types.ts"
import { createdAt } from "../nostr/time.ts"

// Public profile metadata (kind 0). Other apps write many more fields than BlueLine uses (about,
// banner, nip05, lud16, website, their own). Every change starts from the version as read and
// touches only the fields BlueLine edits, so nothing another app wrote is ever lost
// (PLAN.md "Bestehende Profilfelder … bleiben erhalten").

export interface ProfileMetadata {
  // The name people see: display_name, else name. Null when the profile has neither.
  name: string | null
  picture: string | null
  // A Lightning address (lud16), for payments.
  lightningAddress: string | null
  // A NIP-05 address (name@domain), as written: show it only once verified (lib/nostr/ext/nip05.ts).
  nip05: string | null
}

// Room enough for any real name; the 16-character limit of a seat name in setup doesn't apply.
export const MAX_PROFILE_NAME = 50

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)

// The fields as written, or null when the content isn't a JSON object (damaged, another format).
function fields(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readMetadata(event: Pick<NostrEvent, "content"> | null | undefined): ProfileMetadata {
  const f = event ? (fields(event.content) ?? {}) : {}
  return { name: text(f.display_name) ?? text(f.name), picture: text(f.picture), lightningAddress: text(f.lud16), nip05: text(f.nip05) }
}

export interface MetadataChange {
  name?: string
  // null removes the picture.
  picture?: string | null
}

// The kind 0 template for a change, on top of the version it replaces (base). The name goes
// where that profile shows it: display_name when it has one, otherwise name. A new profile
// writes both.
export function metadataTemplate(change: MetadataChange, base?: NostrEvent | null): EventTemplate {
  const content = base ? { ...(fields(base.content) ?? {}) } : {}
  if (change.name !== undefined) {
    const name = change.name.trim()
    if (!base || !text(content.display_name)) content.name = name
    if (!base || text(content.display_name)) content.display_name = name
  }
  if (change.picture === null) delete content.picture
  else if (change.picture !== undefined) content.picture = change.picture
  return { kind: 0, tags: base ? base.tags.map((tag) => [...tag]) : [], content: JSON.stringify(content), created_at: createdAt(base?.created_at) }
}
