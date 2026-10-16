// The part of nostr-core the app uses at runtime. Loaded only through loadCore() in ./core.ts
// (a dynamic import), never imported directly, so the guest path never downloads it.
//
// Named imports instead of the whole package: nostr-core 1.0.6 declares no "sideEffects" and
// creates an XML parser at load time, so a namespace import (`import("nostr-core")`) bundles
// everything, RSS and Markdown included: 116 KB gzip. With named imports and
// experimental.optimizePackageImports in next.config.mjs, the lazy chunk is 22 KB gzip
// (docs/implementation/evidence/P0.03/CORE.md, "Bundle-Messung").
// Add a name here when lib/nostr starts using it.
//
// Import, then export, on purpose: the shorter `export { … } from "nostr-core"` defeats the
// optimizePackageImports rewrite and pulls in the whole package (measured 2026-10-16: lazy
// chunk 17.9 KB gzip with this form, 49.1 KB with the re-export form).
import {
  buildCalendarEventAddress,
  createAuthEventTemplate,
  createCalendarEventRSVPTemplate,
  createRumor,
  createSecretKeySigner,
  createTimeBasedCalendarEventTemplate,
  createWrap,
  createZapRequestEventTemplate,
  decodeBolt11,
  encodeLnurl,
  fetchPayRequest,
  fetchRelayInfo,
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getExchangeRate,
  getPublicKey,
  matchFilters,
  nip19,
  nip44,
  Nip07Signer,
  NWC,
  NWCConnectionError,
  NWCWalletError,
  parseCalendarEventRSVP,
  parseConnectionURI,
  parseLightningAddress,
  parseNip05Address,
  parseTimeBasedCalendarEvent,
  Relay,
  requestLnurlInvoice,
  verifiedSymbol,
  verifyEventSignature,
} from "nostr-core"

// jscpd:ignore-start (the list above, exported: see the header)
export {
  buildCalendarEventAddress,
  createAuthEventTemplate,
  createCalendarEventRSVPTemplate,
  createRumor,
  createSecretKeySigner,
  createTimeBasedCalendarEventTemplate,
  createWrap,
  createZapRequestEventTemplate,
  decodeBolt11,
  encodeLnurl,
  fetchPayRequest,
  fetchRelayInfo,
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getExchangeRate,
  getPublicKey,
  matchFilters,
  nip19,
  nip44,
  Nip07Signer,
  NWC,
  NWCConnectionError,
  NWCWalletError,
  parseCalendarEventRSVP,
  parseConnectionURI,
  parseLightningAddress,
  parseNip05Address,
  parseTimeBasedCalendarEvent,
  Relay,
  requestLnurlInvoice,
  verifiedSymbol,
  verifyEventSignature,
}
// jscpd:ignore-end
