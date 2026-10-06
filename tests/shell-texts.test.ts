import { test } from "node:test"
import assert from "node:assert/strict"
import { MESSAGES } from "../lib/i18n/index.ts"
import { PROFILE_TEXTS } from "../lib/i18n/features/profile.screens.ts"

// Normal views never use protocol words (decision 0002 §1 and §9, PLAN.md "Einfach sprechen");
// technical details belong behind an explicit "Erweitert" / "Advanced" screen only. This checks
// the shell's and the profile's texts in every language; profile.advanced is that screen.

const PROTOCOL = /nostr|\bnip[- ]?\d*\b|relay|npub|nsec|pubkey|\bkeys?\b|schlüssel|bunker|nwc|lnurl|event/i

function texts(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === "string") out.push([path, value])
  else if (typeof value === "function") out.push([path, String(value("Profil", 2))])
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) texts(child, `${path}.${key}`, out)
  return out
}

test("shell and profile texts use no protocol words, except under Erweitert", () => {
  for (const [locale, t] of Object.entries(MESSAGES)) {
    const { advanced, ...screens } = PROFILE_TEXTS[locale as keyof typeof PROFILE_TEXTS]
    assert.ok(advanced, "the technical texts are kept apart")
    for (const [path, text] of [...texts(t.shell, `${locale}.shell`, []), ...texts(t.profile, `${locale}.profile`, []), ...texts(screens, `${locale}.profile.screens`, [])]) {
      assert.doesNotMatch(text, PROTOCOL, `${path}: ${text}`)
    }
  }
})

test("German and English name the five tabs", () => {
  assert.deepEqual(Object.values(MESSAGES.de.shell.tabs), ["Spielen", "Rangliste", "Clubs", "Turniere", "Profil"])
  assert.deepEqual(Object.values(MESSAGES.en.shell.tabs), ["Play", "Leaderboard", "Clubs", "Tournaments", "Profile"])
})
