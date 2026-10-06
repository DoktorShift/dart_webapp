import { test } from "node:test"
import assert from "node:assert/strict"
import { MESSAGES } from "../lib/i18n/index.ts"
import { PAYMENTS_TEXTS } from "../lib/i18n/features/payments.screens.ts"

// Payments speak plainly (PLAN.md table "Im normalen Produkt": Wallet verbinden, Bezahlen /
// Empfangen; _coordination/NOSTR-DESIGN-RULES.md): no protocol or bitcoin jargon outside the
// "Erweitert" screen. "Zap" and "invoice" ("Rechnung") count as jargon too; "sats" is the unit.

const PROTOCOL = /nostr|\bnip[- ]?\d*\b|relay|npub|nsec|pubkey|\bkeys?\b|\bschlüssel|bunker|nwc|lnurl|event|\bzaps?\b|lud16|bolt ?11|preimage|payment[_ ]hash|invoice|rechnung/i

function texts(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === "string") out.push([path, value])
  else if (typeof value === "function") out.push([path, String(value("Mia", "500 sats", "Tom"))])
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) texts(child, `${path}.${key}`, out)
  return out
}

test("payment texts use no protocol words outside Erweitert", () => {
  for (const locale of ["de", "en"] as const) {
    const { advanced, ...plain } = PAYMENTS_TEXTS[locale]
    assert.ok(advanced.protocolValue.length > 0)
    for (const [path, text] of texts({ start: MESSAGES[locale].payments, screens: plain }, `${locale}.payments`, [])) assert.doesNotMatch(text, PROTOCOL, `${path}: ${text}`)
  }
})

test("one sat, many sats", () => {
  assert.equal(MESSAGES.de.payments.sats("1"), "1 sat")
  assert.equal(MESSAGES.de.payments.sats("1.000"), "1.000 sats")
  assert.equal(MESSAGES.en.payments.sats("21"), "21 sats")
})
