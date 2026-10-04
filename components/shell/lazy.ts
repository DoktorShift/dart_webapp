"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import type { ScreenProps } from "@/lib/shell/registry"

// The shell's own screens beyond the Play tab load when first opened, so the start page carries
// no more than it did before the tabs were added (docs/implementation/evidence/P0.07/DESIGN.md).

export const GuestProfile = lazyScreen<object>(() => import("@/components/shell/guest-profile").then((m) => ({ default: m.GuestProfile })))
export const SettingsEntry = lazyScreen<ScreenProps>(() => import("@/components/shell/settings-entry"))
export const AboutScreen = lazyScreen<ScreenProps>(() => import("@/components/shell/about-screen"))
export const OpenClubInvite = lazyScreen<ScreenProps>(() => import("@/components/shell/open-link-screen").then((m) => ({ default: m.OpenClubInvite })))
export const OpenTournamentInvite = lazyScreen<ScreenProps>(() =>
  import("@/components/shell/open-link-screen").then((m) => ({ default: m.OpenTournamentInvite })),
)

// Fetches the screens a guest can open without a connection, once the app is idle, so the
// service worker caches them like the old Settings tab and About page. That includes the QR code
// drawing of the install guide (both screens show it). The invitation scanner is left out:
// invitations need a connection anyway.
export function warmOfflineScreens() {
  return Promise.all([GuestProfile.preload(), SettingsEntry.preload(), AboutScreen.preload(), import("@/lib/qr")])
}
