import { test } from "node:test"
import assert from "node:assert/strict"
import { depthOf, initialNavState, makeEntry, navReducer, type NavState, type StackEntry } from "../lib/shell/nav.ts"

// Expected behaviour follows the iOS tab bar with one navigation stack per tab (HIG: tab bars,
// navigation bars): tabs keep their stacks, tapping the open tab goes back to its root.

const entry = (screen: string, key = screen): StackEntry => ({ key, screen, params: {} })
const screens = (state: NavState, tab = state.tab) => state.stacks[tab].map((e) => e.screen)

test("the app starts on the Play tab with every stack at its root", () => {
  const state = initialNavState()
  assert.equal(state.tab, "play")
  assert.equal(depthOf(state), 0)
  for (const stack of Object.values(state.stacks)) assert.equal(stack.length, 0)
})

test("push and pop work on the open tab and never go below the root", () => {
  let state = navReducer(initialNavState("profile"), { type: "push", entry: entry("settings") })
  state = navReducer(state, { type: "push", entry: entry("about") })
  assert.deepEqual(screens(state), ["settings", "about"])
  state = navReducer(state, { type: "pop" })
  assert.deepEqual(screens(state), ["settings"])
  state = navReducer(state, { type: "pop", count: 5 })
  assert.deepEqual(screens(state), [])
  const same = navReducer(state, { type: "pop" })
  assert.equal(same, state, "popping the root changes nothing")
})

test("pushing onto another tab switches to it", () => {
  const state = navReducer(initialNavState("play"), { type: "push", entry: entry("club.invite"), tab: "clubs" })
  assert.equal(state.tab, "clubs")
  assert.deepEqual(screens(state), ["club.invite"])
  assert.deepEqual(screens(state, "play"), [])
})

test("each tab keeps its own stack while another tab is open", () => {
  let state = navReducer(initialNavState("profile"), { type: "push", entry: entry("settings") })
  state = navReducer(state, { type: "select", tab: "clubs" })
  state = navReducer(state, { type: "push", entry: entry("club.create") })
  state = navReducer(state, { type: "select", tab: "profile" })
  assert.deepEqual(screens(state), ["settings"])
  assert.deepEqual(screens(state, "clubs"), ["club.create"])
})

test("tapping the open tab goes back to its root; at the root nothing changes", () => {
  let state = navReducer(initialNavState("profile"), { type: "push", entry: entry("settings") })
  state = navReducer(state, { type: "push", entry: entry("about") })
  state = navReducer(state, { type: "select", tab: "profile" })
  assert.equal(state.tab, "profile")
  assert.deepEqual(screens(state), [])
  assert.equal(navReducer(state, { type: "select", tab: "profile" }), state)
})

test("popToRoot works on any tab without switching", () => {
  let state = navReducer(initialNavState("clubs"), { type: "push", entry: entry("club.create") })
  state = navReducer(state, { type: "select", tab: "play" })
  state = navReducer(state, { type: "popToRoot", tab: "clubs" })
  assert.equal(state.tab, "play")
  assert.deepEqual(screens(state, "clubs"), [])
})

test("replaceTop swaps the top screen, and pushes on a root", () => {
  let state = navReducer(initialNavState("clubs"), { type: "replaceTop", entry: entry("club.openInvite") })
  assert.deepEqual(screens(state), ["club.openInvite"])
  state = navReducer(state, { type: "replaceTop", entry: entry("club.invite") })
  assert.deepEqual(screens(state), ["club.invite"])
})

test("entries get keys no other entry has, and their own copy of the params", () => {
  const params = { payload: "x" }
  const a = makeEntry("club.invite", params)
  const b = makeEntry("club.invite", params)
  assert.notEqual(a.key, b.key)
  assert.deepEqual(a.params, params)
  assert.notEqual(a.params, params)
})
