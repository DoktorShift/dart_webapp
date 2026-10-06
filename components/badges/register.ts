"use client"

import type { ComponentType } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { BADGE_SCREENS } from "@/components/badges/screens"
import type { FinishedMatch, ScreenProps } from "@/lib/shell/registry"
import { registerScreen, registerSlotItem } from "@/lib/shell/registry"
import { registerExportSection } from "@/lib/storage/export-sections"

// Where the badges area plugs into the shell (imported by components/shell/extensions.ts). Every
// piece loads on demand: the guest path carries this file and nothing of nostr-core.

const screen = (load: () => Promise<{ default: ComponentType<ScreenProps> }>) => lazyScreen<ScreenProps>(load)

registerSlotItem("result.actions", "badges.earned", lazyScreen<{ match: FinishedMatch }>(() => import("@/components/badges/earned-card")))
registerSlotItem("profile.rows", "badges.row", lazyScreen<Record<string, never>>(() => import("@/components/badges/profile-row")))
registerSlotItem("profile.card", "badges.line", lazyScreen<{ pubkey: string; own: boolean }>(() => import("@/components/badges/profile-line")))

registerScreen(BADGE_SCREENS.list, { title: (t) => t.badges.titles.badges, Component: screen(() => import("@/components/badges/badges-screen")) })
registerScreen(BADGE_SCREENS.badge, { title: (t, params) => params.name || t.badges.titles.badge, largeTitle: false, Component: screen(() => import("@/components/badges/badge-screen")) })
registerScreen(BADGE_SCREENS.arrange, { title: (t) => t.badges.titles.arrange, Component: screen(() => import("@/components/badges/arrange-screen")) })

// The badges in the device's data file (lib/badges/export.ts).
const badgeExport = () => import("@/lib/badges/export")
registerExportSection("badges", { build: () => badgeExport().then((m) => m.buildBadgeSection()), apply: (value) => badgeExport().then((m) => m.applyBadgeSection(value)) })
