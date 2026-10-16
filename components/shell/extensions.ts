"use client"

// Where the areas plug into the app shell. Each area adds one import line here for a module that
// calls the registry (lib/shell/registry.ts) at load time:
//
//   registerScreen("club.create", { title: (t) => t.clubs.createTitle, Component: lazyScreen(() => import("@/components/clubs/create")) })
//   registerLinkHandler("club", (link, nav, source) => …)
//   registerAction("profile.create", (nav) => …)
//   registerSlot("profile.root", SignedInProfileOrGuest)
//
// Keep these modules small and load real screens with lazyScreen(), so the start page (guest
// play) never carries an area's code, and nostr-core only ever arrives on demand.

import "@/components/shell/builtin-screens"
import "@/components/profile/register"
import "@/components/live/register"
import "@/components/tournaments/register"
