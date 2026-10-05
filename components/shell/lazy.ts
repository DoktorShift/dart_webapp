"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import type { ScreenProps } from "@/lib/shell/registry"

// The shell's own screens beyond the Play tab load when first opened, so the start page carries
// no more than it did before the tabs were added (docs/implementation/evidence/P0.07/DESIGN.md).

// The content of the Clubs, Tournaments and Profile tabs (one chunk).
const tabHomes = () => import("@/components/shell/tab-homes")
export const ClubsHome = lazyScreen<object>(() => tabHomes().then((m) => ({ default: m.ClubsHome })))
export const TournamentsHome = lazyScreen<object>(() => tabHomes().then((m) => ({ default: m.TournamentsHome })))
export const ProfileHome = lazyScreen<object>(() => tabHomes().then((m) => ({ default: m.ProfileHome })))
export const SettingsEntry = lazyScreen<ScreenProps>(() => import("@/components/shell/settings-entry"))
export const AboutScreen = lazyScreen<ScreenProps>(() => import("@/components/shell/about-screen"))
export const OpenClubInvite = lazyScreen<ScreenProps>(() => import("@/components/shell/open-link-screen").then((m) => ({ default: m.OpenClubInvite })))
export const OpenTournamentInvite = lazyScreen<ScreenProps>(() =>
  import("@/components/shell/open-link-screen").then((m) => ({ default: m.OpenTournamentInvite })),
)

// Fetches the screens a guest can open without a connection, once the app is idle, so the
// service worker caches them like the old Settings tab and About page: the Clubs, Tournaments
// and Profile tabs, Settings, About, and the QR code drawing of the install guide (both of the
// last two show it). The invitation scanner is left out: invitations need a connection anyway.
export function warmOfflineScreens() {
  return Promise.all([tabHomes(), SettingsEntry.preload(), AboutScreen.preload(), import("@/lib/qr")])
}
