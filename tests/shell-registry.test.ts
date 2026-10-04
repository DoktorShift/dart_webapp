import { test } from "node:test"
import assert from "node:assert/strict"
import {
  LINK_ROUTES,
  canOpenLink,
  dispatchLink,
  registerAction,
  registerLinkHandler,
  registerScreen,
  runAction,
  type ShellNavigator,
} from "../lib/shell/registry.ts"
import type { ScreenParams, TabId } from "../lib/shell/nav.ts"

// A navigator that records calls instead of rendering.
function recorder(tab: TabId = "play") {
  const calls: string[] = []
  const nav: ShellNavigator = {
    tab,
    selectTab: (t) => calls.push(`select ${t}`),
    push: (screen, params?: ScreenParams, options?) => calls.push(`push ${screen} ${JSON.stringify(params ?? {})} ${options?.tab ?? "-"}`),
    replaceTop: (screen, params?: ScreenParams) => calls.push(`replace ${screen} ${JSON.stringify(params ?? {})}`),
    pop: () => calls.push("pop"),
    popToRoot: () => calls.push("popToRoot"),
    openSetup: (type) => calls.push(`setup ${type}`),
  }
  return { nav, calls }
}

const Dummy = () => null
for (const route of Object.values(LINK_ROUTES)) if (route) registerScreen(route.screen, { title: () => "x", Component: Dummy })

test("an action without a handler opens its screen in its own tab", () => {
  const { nav, calls } = recorder("play")
  runAction("profile.create", nav)
  runAction("club.create", nav)
  assert.deepEqual(calls, ['push profile.create {} profile', 'push club.create {} clubs'])
})

test("a registered action handler replaces the default", () => {
  const { nav, calls } = recorder()
  registerAction("tournament.create", (n) => n.push("tournament.wizard", { step: "1" }))
  runAction("tournament.create", nav)
  assert.deepEqual(calls, ['push tournament.wizard {"step":"1"} -'])
})

test("a link without a handler opens its default screen with the payload", () => {
  const { nav, calls } = recorder("play")
  assert.equal(dispatchLink({ kind: "club", payload: "c1" }, nav, "address"), true)
  assert.deepEqual(calls, ['push club.invite {"payload":"c1"} clubs'])
})

test("a scanned link replaces the scanner when it opens in the same tab", () => {
  const { nav, calls } = recorder("clubs")
  dispatchLink({ kind: "club", payload: "c1" }, nav, "scan")
  assert.deepEqual(calls, ['replace club.invite {"payload":"c1"}'])
})

test("a signer answer without a handler is not opened", () => {
  const { nav, calls } = recorder()
  assert.equal(dispatchLink({ kind: "signer-return", payload: "x" }, nav, "address"), false)
  assert.deepEqual(calls, [])
})

test("a registered link handler gets the link and how it arrived", () => {
  const { nav, calls } = recorder()
  registerLinkHandler("pair", (link, n, source) => n.push("devices.pairing", { code: link.payload, source }))
  dispatchLink({ kind: "pair", payload: "k.s" }, nav, "address")
  assert.deepEqual(calls, ['push devices.pairing {"code":"k.s","source":"address"} -'])
})

test("canOpenLink tells handled links from ones this version can't open", () => {
  assert.equal(canOpenLink({ kind: "club", payload: "c1" }), true)
  assert.equal(canOpenLink({ kind: "signer-return", payload: "" }), false)
  registerLinkHandler("signer-return", () => {})
  assert.equal(canOpenLink({ kind: "signer-return", payload: "" }), true)
})
