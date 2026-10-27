"use client"

import { lazyScreen } from "@/components/nav/lazy-screen"
import { FRIENDS_SCREENS } from "@/components/friends/screens"
import { featureOn } from "@/lib/shell/features"
import type { ScreenProps, SetupPlayersProps, SlotListProps } from "@/lib/shell/registry"
import { registerScreen, registerSlotItem } from "@/lib/shell/registry"

// Where the friends area plugs into the shell (imported by components/shell/extensions.ts): the
// line on the own profile card with the requests under it, and the list, the button on another player's profile, the chips in
// game setup, the Rangliste's "Freunde" and the count of open requests on the Profile tab. Everything loads on demand; behind the area's
// feature switch (lib/shell/features.ts).

if (featureOn("friends")) {
  registerScreen(FRIENDS_SCREENS.list, { title: (t) => t.profile.titles.friends, Component: lazyScreen<ScreenProps>(() => import("@/components/friends/friends-screen")) })
  registerSlotItem("profile.card", "friends", lazyScreen<SlotListProps["profile.card"]>(() => import("@/components/friends/profile-line")))
  registerSlotItem("profile.notices", "friends.requests", lazyScreen<SlotListProps["profile.notices"]>(() => import("@/components/friends/request-notice")))
  registerSlotItem("profile.actions", "friends", lazyScreen<SlotListProps["profile.actions"]>(() => import("@/components/friends/friend-button")))
  registerSlotItem("setup.players", "friends.players", lazyScreen<SetupPlayersProps>(() => import("@/components/friends/friend-seats")))
  registerSlotItem("leaderboard.sections", "friends", lazyScreen<SlotListProps["leaderboard.sections"]>(() => import("@/components/friends/friends-section")))
  registerSlotItem("tab.badges", "friends", lazyScreen<SlotListProps["tab.badges"]>(() => import("@/components/friends/tab-badge")))
}
