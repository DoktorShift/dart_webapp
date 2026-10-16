// The part of nostr-core the app uses at runtime. Loaded only through loadCore() in ./core.ts
// (a dynamic import), never imported directly, so the guest path never downloads it.
//
// Named imports instead of the whole package: nostr-core 1.0.6 declares no "sideEffects" and
// creates an XML parser at load time, so a namespace import (`import("nostr-core")`) bundles
// everything, RSS and Markdown included: 116 KB gzip. With named imports and
// experimental.optimizePackageImports in next.config.mjs, the lazy chunk is 22 KB gzip
// (docs/implementation/evidence/P0.03/CORE.md, "Bundle-Messung").
// Add a name here when lib/nostr starts using it.
import {
  createAuthEventTemplate,
  createRumor,
  createSecretKeySigner,
  createWrap,
  decodeBolt11,
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  matchFilters,
  nip19,
  nip44,
  Nip07Signer,
  parseConnectionURI,
  parseNip05Address,
  Relay,
  verifiedSymbol,
  verifyEventSignature,
} from "nostr-core"

export {
  createAuthEventTemplate,
  createRumor,
  createSecretKeySigner,
  createWrap,
  decodeBolt11,
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  matchFilters,
  nip19,
  nip44,
  Nip07Signer,
  parseConnectionURI,
  parseNip05Address,
  Relay,
  verifiedSymbol,
  verifyEventSignature,
}
