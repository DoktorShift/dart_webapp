// The app's top-level navigation as plain data: five tabs, each with its own stack of screens
// above the tab's root, like a UITabBarController with one navigation controller per tab.
// No React and no browser APIs here, so the rules run in the Node unit tests.

export type TabId = "play" | "leaderboard" | "clubs" | "tournaments" | "profile"

export const TABS: readonly TabId[] = ["play", "leaderboard", "clubs", "tournaments", "profile"]

export const isTabId = (value: unknown): value is TabId => typeof value === "string" && (TABS as readonly string[]).includes(value)

// Screen parameters are short strings (ids, opaque link payloads), so a stack can be compared,
// logged and kept in history state without surprises.
export type ScreenParams = Readonly<Record<string, string>>

// One pushed screen. `key` is unique for the lifetime of the page, so React keeps each screen's
// state (scroll position, form input) while it is covered by another one.
export interface StackEntry {
  key: string
  screen: string
  params: ScreenParams
}

export interface NavState {
  tab: TabId
  // Pushed screens per tab, without the tab's root.
  stacks: Readonly<Record<TabId, readonly StackEntry[]>>
}

export type NavAction =
  // Tapping a tab. Tapping the tab that is already open goes back to its root (iOS behaviour).
  | { type: "select"; tab: TabId }
  | { type: "push"; entry: StackEntry; tab?: TabId }
  // Goes back `count` screens (1 when left out) in the given or current tab; never below the root.
  | { type: "pop"; count?: number; tab?: TabId }
  | { type: "popToRoot"; tab?: TabId }
  // Swaps the top screen for another one, e.g. a scanned invitation for the scanner. On a root
  // it pushes instead.
  | { type: "replaceTop"; entry: StackEntry; tab?: TabId }
  // Merges params into a pushed screen, which stays where it is: a screen opened from a link
  // names what it shows once it has loaded it (its title reads the params).
  | { type: "update"; key: string; params: ScreenParams }

export const initialNavState = (tab: TabId = "play"): NavState => ({
  tab,
  stacks: { play: [], leaderboard: [], clubs: [], tournaments: [], profile: [] },
})

const withStack = (state: NavState, tab: TabId, stack: readonly StackEntry[]): NavState =>
  stack === state.stacks[tab] ? state : { ...state, stacks: { ...state.stacks, [tab]: stack } }

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "select":
      if (action.tab === state.tab) return withStack(state, state.tab, state.stacks[state.tab].length ? [] : state.stacks[state.tab])
      return { ...state, tab: action.tab }
    case "push": {
      const tab = action.tab ?? state.tab
      return { ...withStack(state, tab, [...state.stacks[tab], action.entry]), tab }
    }
    case "pop": {
      const tab = action.tab ?? state.tab
      const stack = state.stacks[tab]
      const count = Math.max(0, Math.min(action.count ?? 1, stack.length))
      return count === 0 ? state : withStack(state, tab, stack.slice(0, stack.length - count))
    }
    case "popToRoot": {
      const tab = action.tab ?? state.tab
      return state.stacks[tab].length === 0 ? state : withStack(state, tab, [])
    }
    case "replaceTop": {
      const tab = action.tab ?? state.tab
      const stack = state.stacks[tab]
      return { ...withStack(state, tab, [...stack.slice(0, Math.max(0, stack.length - 1)), action.entry]), tab }
    }
    case "update": {
      const tab = (Object.keys(state.stacks) as TabId[]).find((id) => state.stacks[id].some((e) => e.key === action.key))
      if (!tab) return state
      return withStack(state, tab, state.stacks[tab].map((e) => (e.key === action.key ? { ...e, params: { ...e.params, ...action.params } } : e)))
    }
  }
}

// How many screens sit above the root of the open tab.
export const depthOf = (state: NavState) => state.stacks[state.tab].length

let entrySeed = 0

// A new stack entry with a key no other entry in this page has.
export function makeEntry(screen: string, params: ScreenParams = {}): StackEntry {
  entrySeed += 1
  return { key: `${screen}#${entrySeed}`, screen, params: { ...params } }
}
