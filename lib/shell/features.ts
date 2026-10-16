// Feature switches (PLAN.md "Ausrollen"): every area stands behind its own switch, so a build can
// ship with some of them off while the guest game stays as it is. A switch only decides whether
// the area registers with the shell at all (components/<area>/register.ts wraps its registrations
// in `if (featureOn("<area>"))`): switched off, its tab shows the shell's own view, its links
// can't be opened yet, and the device's data stays untouched for the build that turns it on.
//
// NEXT_PUBLIC_BLUELINE_FEATURES names the areas that are on, comma separated ("profile,live");
// unset, every area is on. No React and no browser APIs: the rule runs in the Node unit tests.

export type Feature = "profile" | "payments" | "live" | "sync" | "clubs" | "badges" | "devices" | "tournaments"

// What an area can't work without: everything but live games and payments builds on the profile
// (its session, keys and relays), so with the profile off they are off too. Devices also carry
// the sync area's data key, device list record and history pull to the new device.
const REQUIRES: Partial<Record<Feature, readonly Feature[]>> = {
  sync: ["profile"],
  clubs: ["profile"],
  badges: ["profile"],
  devices: ["profile", "sync"],
  tournaments: ["profile"],
}

// The variable spelled out literally, so Next.js inlines it at build time (as lib/nostr/relays.ts
// does); the try covers a browser bundle without a `process` object.
function configured(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_BLUELINE_FEATURES
  } catch {
    return undefined
  }
}

// Whether the area is on in this build: named in the list (or no list set), and everything it
// requires on as well. `raw` is the list as the environment gives it; the tests pass their own.
export function featureOn(feature: Feature, raw: string | undefined = configured()): boolean {
  const named = raw === undefined || raw.split(",").map((name) => name.trim()).includes(feature)
  return named && (REQUIRES[feature] ?? []).every((required) => featureOn(required, raw))
}
