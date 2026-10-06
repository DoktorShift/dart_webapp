"use client"

import { lazy } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { PAYMENT_SCREENS } from "@/components/payments/screens"
import { acceptWalletReturn } from "@/components/payments/wallet-return"
import { STAKE_EXTRA } from "@/lib/payments/stake"
import { registerLinkHandler, registerScreen, registerSlotItem } from "@/lib/shell/registry"

// The payments area in the app shell (components/shell/extensions.ts). Everything loads when it
// is first shown; the guest path carries only this file.

registerScreen(PAYMENT_SCREENS.home, { title: (t) => t.payments.title, Component: lazyScreen(() => import("@/components/payments/payments-screen")) })
registerScreen(PAYMENT_SCREENS.connect, { title: (t) => t.payments.connect.title, Component: lazyScreen(() => import("@/components/payments/connect")) })
registerScreen(PAYMENT_SCREENS.advanced, { title: (t) => t.payments.advanced.title, Component: lazyScreen(() => import("@/components/payments/advanced-screen")) })

// The stake is kept with the game as config.extras["payments.stake"].
registerSlotItem("setup.extras", STAKE_EXTRA, lazy(() => import("@/components/payments/stake-setup")))
registerSlotItem("result.actions", "payments", lazy(() => import("@/components/payments/result-action")))
registerSlotItem("profile.rows", "payments", lazy(() => import("@/components/payments/payments-row")))
registerSlotItem("profile.actions", "payments.congratulate", lazy(() => import("@/components/payments/congratulate")))

// A wallet app came back with a new connection ("Wallet-App öffnen"). The connection leaves the
// address at once, also when the wallet put it into the query.
registerLinkHandler("wallet-return", (link, nav) => {
  const found = acceptWalletReturn(link.payload, window.location.search)
  if (/[?&]value=/.test(window.location.search)) window.history.replaceState(window.history.state, "", window.location.pathname)
  if (found) nav.push(PAYMENT_SCREENS.connect, { returned: "1" }, { tab: "profile" })
})
