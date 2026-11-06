// Where this build runs: the website (and the PWA installed from it), or the iOS app, which is
// the same pages exported as static files inside a Capacitor shell (ios/, docs/ios.md).
//
// NEXT_PUBLIC_BLUELINE_PLATFORM is set at build time by `npm run build:ios`; unset, the build is
// the website. Spelled out literally so Next.js inlines it (as lib/shell/features.ts does), and
// no browser APIs, so the rules run in the Node unit tests.

export type Platform = "web" | "ios"

function configured(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_BLUELINE_PLATFORM
  } catch {
    return undefined
  }
}

export function platform(raw: string | undefined = configured()): Platform {
  return raw === "ios" ? "ios" : "web"
}

// The native app: no service worker, no "add to home screen", no browser downloads, and pages
// are served from capacitor://localhost rather than the website's address.
export const isNativeApp = (raw?: string) => platform(raw ?? configured()) === "ios"
