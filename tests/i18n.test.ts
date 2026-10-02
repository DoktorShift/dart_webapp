import { test } from "node:test"
import assert from "node:assert/strict"
import { MESSAGES } from "../lib/i18n/index.ts"
import { INSTALL_PICTURES, INSTALL_PLATFORMS } from "../lib/install.ts"

// TypeScript already checks that every language has every entry. These checks cover what it
// can't see: list lengths, and texts left empty.

test("every language has one install step text per picture", () => {
  for (const [locale, t] of Object.entries(MESSAGES)) {
    for (const platform of INSTALL_PLATFORMS) {
      assert.equal(t.install.steps[platform].length, INSTALL_PICTURES[platform].length, `${locale} ${platform}`)
    }
  }
})

test("every language has the same number of facts, questions and author lines", () => {
  const [first, ...others] = Object.values(MESSAGES)
  for (const t of others) {
    assert.equal(t.about.facts.length, first.about.facts.length)
    assert.equal(t.about.faq.length, first.about.faq.length)
    assert.equal(t.about.authorNote.length, first.about.authorNote.length)
    assert.equal(t.meta.features.length, first.meta.features.length)
  }
})

test("no text is left empty", () => {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") assert.ok(value.trim().length > 0, `empty text at ${path}`)
    // Text functions are called with sample arguments; "2" works where numbers or names are expected.
    else if (typeof value === "function") assert.ok(String(value("2", "2", "2")).trim().length > 0, `empty text at ${path}`)
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
  }
  for (const [locale, t] of Object.entries(MESSAGES)) walk(t, locale)
})
