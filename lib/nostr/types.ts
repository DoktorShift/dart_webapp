// Type-only re-exports of nostr-core, so other modules can name Nostr types without importing
// the library itself (only lib/nostr/ loads nostr-core, and only on demand). See docs/decisions/0002.
export type { NostrEvent, EventTemplate, UnsignedEvent, VerifiedEvent, Filter, Signer, RelayMap } from "nostr-core"
