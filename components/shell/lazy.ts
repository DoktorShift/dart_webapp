"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import type { ScreenProps } from "@/lib/shell/registry"

// The shell's own screens beyond the Play tab load when first opened, so the start page carries
// little more than the Play tab (docs/implementation/evidence/P0.07/DESIGN.md §6).

// The content of the Clubs, Tournaments and Profile tabs (one chunk).
const tabHomes = () => import("@/components/shell/tab-homes")
export const ClubsHome = lazyScreen<object>(() => tabHomes().then((m) => ({ default: m.ClubsHome })))
export const TournamentsHome = lazyScreen<object>(() => tabHomes().then((m) => ({ default: m.TournamentsHome })))
export const ProfileHome = lazyScreen<object>(() => tabHomes().then((m) => ({ default: m.ProfileHome })))
// The Rangliste tab's content (its own chunk: the standings and their rows).
export const LeaderboardHome = lazyScreen<object>(() => import("@/components/leaderboard/home"))
export const SettingsEntry = lazyScreen<ScreenProps>(() => import("@/components/shell/settings-entry"))
export const AboutScreen = lazyScreen<ScreenProps>(() => import("@/components/shell/about-screen"))
// The one scanner for every BlueLine code (scan-screen.tsx), opened from the Clubs and the
// Tournaments tab.
export const ScanScreen = lazyScreen<ScreenProps>(() => import("@/components/shell/scan-screen"))

// Fetches the screens a guest can open without a connection, once the app is idle, so the
// service worker caches them like the old Settings tab and About page: the Clubs, Tournaments
// and Profile tabs, Settings, About, and the QR code drawing of the install guide (both of the
// last two show it). The scanner is left out: what it opens needs a connection anyway.
export function warmOfflineScreens() {
  return Promise.all([tabHomes(), LeaderboardHome.preload(), SettingsEntry.preload(), AboutScreen.preload(), import("@/lib/qr")])
}
