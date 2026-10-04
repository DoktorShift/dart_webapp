// The one place where the areas (profile, devices, clubs, tournaments, live games, payments)
// plug into the app shell, without the shell knowing them:
//
// - Screens: what a pushed screen shows, by id. The shell registers a neutral placeholder for
//   every id it already links to; an area registers the same id again to replace it.
// - Actions: what a button in the shell does ("Profil anlegen"). Without a handler the action
//   pushes the screen with the same id.
// - Links: what an app link opens (/#club=…). Without a handler the link opens the screen in
//   LINK_ROUTES, in its tab.
// - Slots: a whole tab root that an area takes over, e.g. the signed-in profile. The slot gets
//   the shell's own view as `fallback`, to show while nothing area-specific applies.
//
// Areas register from components/shell/extensions.ts at module load, before the first render.
// Registering later (after a lazy import) also works; open screens pick it up.
//
// No React runtime here (types only), so the dispatch rules run in the Node unit tests.

import type { ComponentType, ReactNode } from "react"
import type { Messages } from "../i18n/index.ts"
import type { AppLink, LinkKind } from "./links.ts"
import type { ScreenParams, TabId } from "./nav.ts"

// What screens, actions and link handlers can do with the navigation. Provided by app/page.tsx.
export interface ShellNavigator {
  readonly tab: TabId
  selectTab(tab: TabId): void
  // Pushes onto the given tab (switching to it) or onto the open tab. Unknown ids are ignored.
  push(screen: string, params?: ScreenParams, options?: { tab?: TabId }): void
  // Swaps the top screen of the open tab, e.g. a scanned invitation for the scanner.
  replaceTop(screen: string, params?: ScreenParams): void
  pop(): void
  popToRoot(tab?: TabId): void
  // Opens game setup for X01, Cricket or Around the Clock on top of everything.
  openSetup(type: "x01" | "cricket" | "clock"): void
}

export interface ScreenProps {
  params: ScreenParams
}

export interface ScreenDefinition {
  // Shown as the large title (or in the navigation bar) and as the back button of the next screen.
  title: (t: Messages, params: ScreenParams) => string
  // Large title below the navigation bar (default). Screens with their own big heading turn it off.
  largeTitle?: boolean
  // Pass React.lazy(() => import(…)) to keep the code out of the start page until it is opened.
  Component: ComponentType<ScreenProps>
}

// Ids the shell itself links to. Areas may add their own ids.
export const SCREENS = {
  settings: "settings",
  about: "about",
  profileCreate: "profile.create",
  profileFromDevice: "profile.fromDevice",
  profileFromBackup: "profile.fromBackup",
  profileFromApp: "profile.fromApp",
  profilePublic: "profile.public",
  devicesPair: "devices.pair",
  clubCreate: "club.create",
  clubOpenInvite: "club.openInvite",
  clubInvite: "club.invite",
  tournamentCreate: "tournament.create",
  tournamentOpenInvite: "tournament.openInvite",
  tournamentView: "tournament.view",
  liveWatch: "live.watch",
  liveBoard: "live.board",
} as const

export type ShellAction =
  | typeof SCREENS.profileCreate
  | typeof SCREENS.profileFromDevice
  | typeof SCREENS.profileFromBackup
  | typeof SCREENS.profileFromApp
  | typeof SCREENS.clubCreate
  | typeof SCREENS.clubOpenInvite
  | typeof SCREENS.tournamentCreate
  | typeof SCREENS.tournamentOpenInvite

// Where each action's default screen opens.
const ACTION_TABS: Record<ShellAction, TabId> = {
  "profile.create": "profile",
  "profile.fromDevice": "profile",
  "profile.fromBackup": "profile",
  "profile.fromApp": "profile",
  "club.create": "clubs",
  "club.openInvite": "clubs",
  "tournament.create": "tournaments",
  "tournament.openInvite": "tournaments",
}

// Where a link opens when no area handles it yet; the payload arrives as params.payload. A
// signer answer only makes sense to the flow that asked for it, so without a handler it is dropped.
export const LINK_ROUTES: Record<LinkKind, { tab: TabId; screen: string } | null> = {
  p: { tab: "profile", screen: SCREENS.profilePublic },
  watch: { tab: "play", screen: SCREENS.liveWatch },
  club: { tab: "clubs", screen: SCREENS.clubInvite },
  tournament: { tab: "tournaments", screen: SCREENS.tournamentView },
  pair: { tab: "profile", screen: SCREENS.devicesPair },
  board: { tab: "play", screen: SCREENS.liveBoard },
  "signer-return": null,
}

// How the link arrived: in the page address (opened from outside), or scanned / pasted inside
// the app, where it replaces the scanner screen instead of stacking on top of it.
export type LinkSource = "address" | "scan"

export type ActionHandler = (nav: ShellNavigator) => void
export type LinkHandler = (link: AppLink, nav: ShellNavigator, source: LinkSource) => void
export type SlotComponent = ComponentType<{ fallback: ReactNode }>
export type SlotId = "profile.root" | "profile.tabIcon" | "clubs.root" | "tournaments.root"

const screens = new Map<string, ScreenDefinition>()
const actions = new Map<ShellAction, ActionHandler>()
const linkHandlers = new Map<LinkKind, LinkHandler>()
const slots = new Map<SlotId, SlotComponent>()

// Bumped on every registration; React reads it through useSyncExternalStore (see
// components/nav/use-registry.ts) so screens registered after a lazy import show up.
let version = 0
const listeners = new Set<() => void>()
const changed = () => {
  version += 1
  for (const listener of listeners) listener()
}
export const registryVersion = () => version
export function subscribeRegistry(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function registerScreen(id: string, definition: ScreenDefinition) {
  screens.set(id, definition)
  changed()
}
export const getScreen = (id: string): ScreenDefinition | undefined => screens.get(id)
export const hasScreen = (id: string) => screens.has(id)

export function registerAction(id: ShellAction, handler: ActionHandler) {
  actions.set(id, handler)
  changed()
}

export function runAction(id: ShellAction, nav: ShellNavigator) {
  const handler = actions.get(id)
  if (handler) handler(nav)
  else nav.push(id, {}, { tab: ACTION_TABS[id] })
}

export function registerLinkHandler(kind: LinkKind, handler: LinkHandler) {
  linkHandlers.set(kind, handler)
  changed()
}

// Whether this version can open the link at all (an area handles it, or its default screen exists).
export function canOpenLink(link: AppLink): boolean {
  if (linkHandlers.has(link.kind)) return true
  const route = LINK_ROUTES[link.kind]
  return route !== null && screens.has(route.screen)
}

// Opens a link: through its area's handler, or the default screen for its kind. Returns false
// when nothing in this version can open it (the caller then says so or ignores it).
export function dispatchLink(link: AppLink, nav: ShellNavigator, source: LinkSource): boolean {
  const handler = linkHandlers.get(link.kind)
  if (handler) {
    handler(link, nav, source)
    return true
  }
  const route = LINK_ROUTES[link.kind]
  if (!route || !screens.has(route.screen)) return false
  if (source === "scan" && nav.tab === route.tab) nav.replaceTop(route.screen, { payload: link.payload })
  else nav.push(route.screen, { payload: link.payload }, { tab: route.tab })
  return true
}

export function registerSlot(id: SlotId, component: SlotComponent) {
  slots.set(id, component)
  changed()
}
export const getSlot = (id: SlotId): SlotComponent | undefined => slots.get(id)
