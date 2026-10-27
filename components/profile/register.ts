"use client"

import type { ComponentType, ReactNode } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { PROFILE_SCREENS } from "@/components/profile/screens"
import { featureOn } from "@/lib/shell/features"
import type { ScreenProps, SetupPlayersProps, SlotListProps } from "@/lib/shell/registry"
import { SESSION_KEY } from "@/lib/profile/storage-keys"
import { SCREENS, registerLinkHandler, registerScreen, registerSlot, registerSlotItem, registerStartTask } from "@/lib/shell/registry"
import { dbGet, onStorageChange } from "@/lib/storage/db"

// Where the profile area plugs into the shell (imported by components/shell/extensions.ts). Every
// piece loads on demand: the guest path carries this file and nothing of nostr-core. Behind the
// area's feature switch (lib/shell/features.ts): off, nothing here is registered.

const screen = (load: () => Promise<{ default: ComponentType<ScreenProps> }>) => lazyScreen<ScreenProps>(load)

const ProfileRoot = lazyScreen<{ fallback: ReactNode }>(() => import("@/components/profile/profile-root"))
const StatsScreen = screen(() => import("@/components/profile/stats-screen"))
const TrainingScreen = screen(() => import("@/components/profile/training-screen"))
const GamesScreen = screen(() => import("@/components/profile/games-screen"))
const MatchScreen = screen(() => import("@/components/profile/match-screen"))
const PlayerScreen = screen(() => import("@/components/profile/player-screen"))
const AdvancedScreen = screen(() => import("@/components/profile/advanced-screen"))

if (featureOn("profile")) {
  registerSlot("profile.root", ProfileRoot)
  registerSlotItem("result.actions", "profile.keep", lazyScreen<SlotListProps["result.actions"]>(() => import("@/components/profile/keep-results")))
  registerSlotItem("setup.players", "profile.players", lazyScreen<SetupPlayersProps>(() => import("@/components/profile/setup-players")))

  registerScreen(SCREENS.profileCreate, { title: (t) => t.profile.guest.create, Component: screen(() => import("@/components/profile/create-screen")) })
  registerScreen(SCREENS.profileFromApp, { title: (t) => t.profile.guest.fromApp, Component: screen(() => import("@/components/profile/connect-screen")) })
  registerScreen(SCREENS.profilePublic, { title: (t) => t.shell.screens.publicProfile, Component: screen(() => import("@/components/profile/public-screen")) })
  registerScreen(PROFILE_SCREENS.stats, { title: (t) => t.profile.titles.stats, Component: StatsScreen })
  registerScreen(PROFILE_SCREENS.training, { title: (t) => t.profile.titles.training, Component: TrainingScreen })
  registerScreen(PROFILE_SCREENS.games, { title: (t) => t.profile.titles.games, Component: GamesScreen })
  registerScreen(PROFILE_SCREENS.match, { title: (t) => t.profile.titles.game, largeTitle: false, Component: MatchScreen })
  registerScreen(PROFILE_SCREENS.player, { title: (t, params) => params.name || t.profile.titles.player, largeTitle: false, Component: PlayerScreen })
  registerScreen(PROFILE_SCREENS.visibility, { title: (t) => t.profile.titles.visibility, Component: screen(() => import("@/components/profile/visibility-screen")) })
  registerScreen(PROFILE_SCREENS.advanced, { title: (t) => t.profile.titles.advanced, Component: AdvancedScreen })

  registerLinkHandler("signer-return", (link, nav) => {
    void import("@/components/profile/signer-return").then(({ handleSignerReturn }) => handleSignerReturn(link.payload, nav))
  })

  // The profile's inbox (gift wraps to it: club invitations, friend requests), once a profile is
  // stored here, now or when one signs in later; a guest never loads it.
  registerStartTask(() => {
    let started = false
    const start = () => {
      started = true
      void import("@/components/profile/inbox-start").then(({ followSessionInbox }) => followSessionInbox())
    }
    const look = () => void dbGet("kv", SESSION_KEY).then((stored) => stored !== undefined && !started && start(), () => {})
    const stop = onStorageChange((message) => {
      if (started) stop()
      else if (message.type === "change" && message.stores.includes("kv")) look()
    })
    look()
  })
}

// Fetches the screens a signed-in profile can show from this device's data alone, so they open
// offline too, as the shell does for its own tab roots (components/shell/lazy.ts): Statistik,
// Training, Spiele, a game's details, a player here and Erweitert (with "Diagnose kopieren", which is for
// exactly such moments). Called once a profile is here (./profile-root.tsx). The public preview
// and other players' profiles need a connection anyway.
export function warmProfileScreens() {
  return Promise.all([StatsScreen, TrainingScreen, GamesScreen, MatchScreen, PlayerScreen, AdvancedScreen].map((screen) => screen.preload()))
}
