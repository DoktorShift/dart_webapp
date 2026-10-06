"use client"

import type { ComponentType, ReactNode } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import type { FinishedMatch, ScreenProps, SetupPlayersProps } from "@/lib/shell/registry"
import { SCREENS, registerLinkHandler, registerScreen, registerSlot, registerSlotItem } from "@/lib/shell/registry"

// Where the profile area plugs into the shell (imported by components/shell/extensions.ts). Every
// piece loads on demand: the guest path carries this file and nothing of nostr-core.

const screen = (load: () => Promise<{ default: ComponentType<ScreenProps> }>) => lazyScreen<ScreenProps>(load)

registerSlot("profile.root", lazyScreen<{ fallback: ReactNode }>(() => import("@/components/profile/profile-root")))
registerSlotItem("result.actions", "profile.keep", lazyScreen<{ match: FinishedMatch }>(() => import("@/components/profile/keep-results")))
registerSlotItem("setup.players", "profile.players", lazyScreen<SetupPlayersProps>(() => import("@/components/profile/setup-players")))

registerScreen(SCREENS.profileCreate, { title: (t) => t.profile.guest.create, Component: screen(() => import("@/components/profile/create-screen")) })
registerScreen(SCREENS.profileFromApp, { title: (t) => t.profile.guest.fromApp, Component: screen(() => import("@/components/profile/connect-screen")) })
registerScreen(SCREENS.profilePublic, { title: (t) => t.shell.screens.publicProfile, Component: screen(() => import("@/components/profile/public-screen")) })
registerScreen(PROFILE_SCREENS.stats, { title: (t) => t.profile.titles.stats, Component: screen(() => import("@/components/profile/stats-screen")) })
registerScreen(PROFILE_SCREENS.games, { title: (t) => t.profile.titles.games, Component: screen(() => import("@/components/profile/games-screen")) })
registerScreen(PROFILE_SCREENS.match, { title: (t) => t.profile.titles.game, largeTitle: false, Component: screen(() => import("@/components/profile/match-screen")) })
registerScreen(PROFILE_SCREENS.player, { title: (t, params) => params.name || t.profile.titles.player, largeTitle: false, Component: screen(() => import("@/components/profile/player-screen")) })
registerScreen(PROFILE_SCREENS.preview, { title: (t) => t.profile.titles.preview, Component: screen(() => import("@/components/profile/preview-screen")) })
registerScreen(PROFILE_SCREENS.advanced, { title: (t) => t.profile.titles.advanced, Component: screen(() => import("@/components/profile/advanced-screen")) })

registerLinkHandler("signer-return", (link, nav) => {
  void import("@/components/profile/signer-return").then(({ handleSignerReturn }) => handleSignerReturn(link.payload, nav))
})
