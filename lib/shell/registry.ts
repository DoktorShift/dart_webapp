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
// - Slot lists: places in the game flow where several areas each add a small piece. Pieces show
//   in registration order; with none registered the place shows nothing at all, so the guest
//   path looks exactly as before. A piece that throws or fails to load is left out.
//     "result.actions"  On the result of a finished game, below the result and above its
//                       buttons. Gets the finished game and where the piece stands
//                       ({ match: FinishedMatch, placement }). One row each (one element, 48 pt,
//                       44 pt on short screens), or nothing when there is nothing to show for
//                       this game: the result is one fixed screen. The row is a ResultRow
//                       (components/shell/result-row.tsx: icon, one line that shrinks to fit,
//                       tone, a trailing "Später", X or chevron), which carries the look and the
//                       placements; a row put away per game remembers that with useDismissedFor
//                       (components/shell/use-dismissed-for.ts). On a short phone in portrait
//                       (heights up to 740 pt, Tailwind's `short`) the key numbers can spare one
//                       row: the first piece shows as its row, and with more a count ("+1") at
//                       its end opens a sheet with every piece as its row (placement "row"). On a
//                       phone in landscape (heights up to 500 pt, `xshort`) there is no row to
//                       spare: a single piece sits in the free middle of the top bar as a bar
//                       button (placement "bar": no border or background, no icon or trailing
//                       part, text in the primary colour, one short line that shrinks to fit);
//                       two or more become one button with their count there, which opens the
//                       same sheet. The pieces live in that sheet while it is open, so it stays
//                       under whatever a piece opens from it (its own sheet) until Fertig.
//     "setup.extras"    At the end of game setup's options, before Start. Gets the game as it
//                       would start now, plus the area's own value and onChange. The value is
//                       saved with the started game as config.extras[id] (JSON only). Rematch and
//                       "Play again" copy the config, extras included: keep settings there, not
//                       references that only fit one game.
//     "setup.players"   Right below setup's player list: ways to fill seats (a profile's QR code,
//                       saved rounds). Gets the seats and can add one or replace them all; a seat
//                       may carry the pubkey of the profile it was filled from.
//     "profile.rows"    Rows about the player's game in the Profile tab's list: signed in with
//                       Statistik and Spiele, as a guest above Einstellungen. Auszeichnungen. No
//                       props; each piece is one ListRow (components/ui/list-row.tsx) that pushes
//                       its area's screen. Rendered for guests and signed-in players alike: a row
//                       that needs a profile renders nothing while useSession()
//                       (lib/profile/session.ts) is null.
//     "profile.account" Rows about the account, in the Profile tab's "Konto" group below the
//                       game: Geräte, Sicherung, Zahlungen. Same rules as "profile.rows"; each
//                       row carries its state in its subtitle, so nobody has to open it to know.
//     "leaderboard.sections" The areas of the Rangliste tab beside the shell's own "Hier
//                       gespielt": the clubs' season tables (piece id "clubs") and the player's
//                       tournament placings (piece id "tournaments"). No props; the tab shows the
//                       piece whose id matches the chosen area, and its own empty state for an
//                       area without a piece (the area is switched off).
//     "tab.badges"      On a tab bar symbol: the count of what waits for the person under that
//                       tab (open friend requests on Profil), as a CountBadge
//                       (components/ui/count-badge.tsx). Gets { tab, id }: the id the tab's
//                       button names as its description, for the words that say what waits, so
//                       the tab keeps its name. A piece renders nothing for the other tabs and
//                       while nothing waits.
//     "profile.card"    On a profile (own or someone else's), below its figures: the own friends
//                       line, badges, a club hint. Gets { pubkey, own }. Keep it to one line.
//     "profile.notices" On the own profile, below the sports card and before the form: one
//                       card per note that asks for something (a friend request, the backup hint), as iOS Settings
//                       puts "Finish setting up" below the Apple Account row. Gets { pubkey }.
//                       Nothing while there is nothing to say.
//     "profile.actions" On another player's public profile, below "Profil teilen": e.g.
//                       "Gratulieren". Gets { pubkey, name } (the name as that profile shows it).
//     "profile.advanced" In Profil › Erweitert, below the technical identity: diagnostics.
//                        Gets { pubkey }.
//     "game.attachments" With the running game, from its first dart to its result: pieces that add
//                       nothing to the screen itself, only sheets and dialogs they open (from
//                       their game menu item, say) and effects that follow the game (sending it
//                       to spectators). Gets { match, close }: the game as saved, and a way to
//                       leave it for good without keeping it here (it went on on another device).
//     "play.rows"       On the Play tab, between the last game's card and the kinds of game: a
//                       game that goes on elsewhere and still concerns this device (a seat at a
//                       board). No props. One Group of rows, or nothing at all; the practice
//                       board above gives way to it. Nothing here may slow the tab down: read
//                       the device's database once, and load the rest only when there is
//                       something to show.
//     "club.tournaments" A club's tournaments (the tournaments area): in the club's overview
//                        (compact: a running or next tournament, one row at most) and in
//                        "Termine & Turniere" (the list, and for leaders a way to create one).
//                        Gets { club (its id), name, leader, compact }. Renders nothing when the
//                        club has none and the person can't create one.
// - Game menu items: entries at the end of the running game's options menu (the "…" button), each
//   { id, label, icon?, onSelect }. onSelect gets the running game; the menu closes first.
//   Nothing else on the game screen can be changed from outside.
// - Result primaries: what the result of a game an area owns leads to instead of Revanche and
//   Neues Spiel, each { id, owns(match), label, icon?, pieces? }; the first registered that owns
//   the finished game (FinishedMatch) wins. Its one big button leaves the result the way Fertig
//   does, back to the screen the game was started from (a tournament game: "Zurück zum Board", as
//   a rematch there would be an untracked friendly). `pieces` lists the "result.actions" piece ids
//   that show for such a game, in their registration order; the others stay away (a shared board
//   device shows the tournament's own row, no offer to keep the game in a profile). Without
//   `pieces` every piece shows; without a primary the result is as it always was.
// - Start tasks: work an area does once per page, after the first screen is up and the browser is
//   idle (the shell picks the moment): resuming a queue, catching up with relays. Load the code
//   behind an import() inside the task, so the start page carries only the call.
//
//   registerSlotItem("result.actions", "profile.keep", KeepResultCard)
//   registerSlotItem("setup.extras", "live", LiveSwitch)
//   registerGameMenuItem({ id: "live.watchers", label: (t) => t.live.invite, icon: Radio, onSelect: ({ match }) => … })
//
// Slot items and game menu items return a function that removes them again (e.g. on sign-out).
//
// Areas register from components/shell/extensions.ts at module load, before the first render.
// Registering later (after a lazy import) also works; open screens pick it up. Each area's
// register module wraps all its registrations in `if (featureOn("<area>"))` (lib/shell/features.ts,
// the build-time switch NEXT_PUBLIC_BLUELINE_FEATURES): switched off, the area registers nothing,
// so its tab shows the shell's own view, its links "can't be opened yet", and its data on the
// device stays as it is.
//
// Screens and slots stay mounted while hidden (another tab, a screen pushed over them, or setup and
// the game over all tabs), so they keep their state. Under setup and the game the tabs are frozen:
// updates from live data are rendered only when idle or when the tabs show again, so pausing a
// subscription there is optional. Work that must stop while a screen can't be seen (the camera)
// watches the screen's own element, as QRScanner does (components/common/qr-scanner.tsx).
//
// No React runtime here (types only), so the dispatch rules run in the Node unit tests.

import type { ComponentType, ReactNode } from "react"
import type { MatchConfig, MatchPlayer, SavedMatch, Throw } from "../game/types.ts"
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
  // Opens game setup for X01, Cricket or Around the Clock on top of everything. Back in setup,
  // and leaving or finishing the game, return to the screen it was opened from. An area may hand
  // over the players and its extras (a club game: the chosen members and the club).
  openSetup(type: "x01" | "cricket" | "clock", preset?: SetupPreset): void
  // Goes on with a game that arrived from another device, on the game screen. It replaces the
  // game kept here (a paused one): ask first.
  resumeMatch(match: SavedMatch): void
}

// Game setup as an area opens it: these seats instead of the last game's players, and initial
// values of config.extras by area id ("setup.extras" below). Players can change both in setup.
export interface SetupPreset {
  players?: readonly SetupSeat[]
  extras?: Readonly<Record<string, unknown>>
  // What setup's back button says: the screen it was opened from (a club's name).
  backLabel?: string
}

export interface ScreenProps {
  params: ScreenParams
  // Merges params into this screen's entry, which stays on screen: a screen opened from a link
  // names what it shows once it has loaded it (its title reads them).
  setParams: (params: ScreenParams) => void
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
  liveHandoff: "live.handoff",
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
// signer's or wallet's answer only makes sense to the flow that asked for it, so without a
// handler it is dropped.
export const LINK_ROUTES: Record<LinkKind, { tab: TabId; screen: string } | null> = {
  p: { tab: "profile", screen: SCREENS.profilePublic },
  watch: { tab: "play", screen: SCREENS.liveWatch },
  club: { tab: "clubs", screen: SCREENS.clubInvite },
  tournament: { tab: "tournaments", screen: SCREENS.tournamentView },
  pair: { tab: "profile", screen: SCREENS.devicesPair },
  board: { tab: "play", screen: SCREENS.liveBoard },
  handoff: { tab: "play", screen: SCREENS.liveHandoff },
  "signer-return": null,
  "wallet-return": null,
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

// A finished game, as "result.actions" gets it.
export interface FinishedMatch {
  id: string
  config: MatchConfig
  players: readonly MatchPlayer[]
  // Index into players; in a solo game the one player.
  winner: number
  // One player: practice, no one to beat and not on the leaderboard.
  solo: boolean
  throws: readonly Throw[]
}

export interface SetupExtraProps {
  // The game as it would start now: players, rules and every area's extras. The players still
  // carry setup's seat ids; Start swaps in the ids known players already have.
  config: MatchConfig
  // This area's value in config.extras, undefined until it sets one.
  value: unknown
  // Sets the value; undefined removes it. JSON values only, the game is saved as JSON.
  onChange: (value: unknown) => void
}

// A seat in game setup, as "setup.players" sees and fills it.
export interface SetupSeat {
  name: string
  // The profile the seat was filled from (a scanned profile, a saved round); hex.
  pubkey?: string
}

export interface SetupPlayersProps {
  players: readonly SetupSeat[]
  // False once all six seats are taken.
  canAdd: boolean
  // Fills the first empty seat, or adds one.
  addPlayer: (seat: SetupSeat) => void
  replacePlayers: (seats: readonly SetupSeat[]) => void
}

export interface SlotListProps {
  "result.actions": { match: FinishedMatch; placement: "row" | "bar" }
  "game.attachments": { match: SavedMatch; close: () => void }
  "play.rows": Record<string, never>
  "setup.extras": SetupExtraProps
  "setup.players": SetupPlayersProps
  "profile.rows": Record<string, never>
  "profile.account": Record<string, never>
  "leaderboard.sections": Record<string, never>
  "profile.card": { pubkey: string; own: boolean }
  "profile.notices": { pubkey: string }
  "profile.actions": { pubkey: string; name: string }
  "profile.advanced": { pubkey: string }
  "club.tournaments": { club: string; name: string; leader: boolean; compact: boolean }
  "tab.badges": { tab: TabId; id: string }
}
export type SlotListId = keyof SlotListProps
export interface SlotItem<K extends SlotListId> {
  id: string
  Component: ComponentType<SlotListProps[K]>
}

const slotLists: { [K in SlotListId]: Map<string, ComponentType<SlotListProps[K]>> } = {
  "result.actions": new Map(),
  "game.attachments": new Map(),
  "play.rows": new Map(),
  "setup.extras": new Map(),
  "setup.players": new Map(),
  "profile.rows": new Map(),
  "profile.account": new Map(),
  "leaderboard.sections": new Map(),
  "profile.card": new Map(),
  "profile.notices": new Map(),
  "profile.actions": new Map(),
  "profile.advanced": new Map(),
  "club.tournaments": new Map(),
  "tab.badges": new Map(),
}

// Adds a piece to a slot list. The same id again replaces the piece in its place.
export function registerSlotItem<K extends SlotListId>(list: K, id: string, component: ComponentType<SlotListProps[K]>) {
  const items: Map<string, ComponentType<SlotListProps[K]>> = slotLists[list]
  items.set(id, component)
  changed()
  return () => {
    if (items.get(id) !== component) return
    items.delete(id)
    changed()
  }
}

// The pieces of a slot list in registration order.
export function getSlotItems<K extends SlotListId>(list: K): SlotItem<K>[] {
  const items: Map<string, ComponentType<SlotListProps[K]>> = slotLists[list]
  return Array.from(items, ([id, Component]) => ({ id, Component }))
}

export interface GameMenuContext {
  // The running game as saved: id, config (with extras), the throws so far.
  match: SavedMatch
}

export interface GameMenuItem {
  id: string
  label: (t: Messages) => string
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  onSelect: (context: GameMenuContext) => void
}

const gameMenu = new Map<string, GameMenuItem>()

// Adds an entry to the game's options menu. The same id again replaces the entry in its place.
export function registerGameMenuItem(item: GameMenuItem) {
  gameMenu.set(item.id, item)
  changed()
  return () => {
    if (gameMenu.get(item.id) !== item) return
    gameMenu.delete(item.id)
    changed()
  }
}

// The game menu's entries from areas, in registration order.
export const getGameMenuItems = (): GameMenuItem[] => [...gameMenu.values()]

export interface ResultPrimary {
  id: string
  // Whether the finished game is one of the area's (its config.extras say so).
  owns: (match: FinishedMatch) => boolean
  label: (t: Messages) => string
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  // The "result.actions" pieces that show for the area's games; every piece when left out.
  pieces?: readonly string[]
}

const resultPrimaries = new Map<string, ResultPrimary>()

// Adds a result primary. The same id again replaces it in its place.
export function registerResultPrimary(item: ResultPrimary) {
  resultPrimaries.set(item.id, item)
  changed()
  return () => {
    if (resultPrimaries.get(item.id) !== item) return
    resultPrimaries.delete(item.id)
    changed()
  }
}

// The result primary for a finished game: the first registered that owns it, or null.
export const resultPrimaryFor = (match: FinishedMatch): ResultPrimary | null => [...resultPrimaries.values()].find((item) => item.owns(match)) ?? null

const startTasks = new Set<() => void>()

export function registerStartTask(task: () => void) {
  startTasks.add(task)
}

// Runs every area's start task once; a task that throws stops no other.
export function runStartTasks() {
  const tasks = [...startTasks]
  startTasks.clear()
  for (const task of tasks) {
    try {
      task()
    } catch {
      // The area's own problem; the app goes on.
    }
  }
}
