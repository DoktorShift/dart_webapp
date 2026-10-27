"use client"

import { lazy } from "react"
import { lazyScreen } from "@/components/nav/lazy-screen"
import { whenInUse } from "@/components/payments/gate"
import { PAYMENT_SCREENS } from "@/components/payments/screens"
import { acceptWalletReturn, returnedConnection, returnsWatched } from "@/lib/payments/wallet-return"
import { resultOffer, STAKE_EXTRA } from "@/lib/payments/stake"
import { featureOn } from "@/lib/shell/features"
import { registerLinkHandler, registerScreen, registerSlotItem } from "@/lib/shell/registry"

// The payments area in the app shell (components/shell/extensions.ts). Everything loads when it
// is first shown; the guest path carries only this file and ./gate.tsx. Behind the area's
// feature switch (lib/shell/features.ts): off, nothing here is registered.

if (featureOn("payments")) {
  registerScreen(PAYMENT_SCREENS.home, { title: (t) => t.payments.title, Component: lazyScreen(() => import("@/components/payments/payments-screen")) })
  registerScreen(PAYMENT_SCREENS.connect, { title: (t) => t.payments.connectTitle, Component: lazyScreen(() => import("@/components/payments/connect")) })
  registerScreen(PAYMENT_SCREENS.advanced, { title: (t) => t.payments.advancedTitle, Component: lazyScreen(() => import("@/components/payments/advanced-screen")) })
  registerScreen(PAYMENT_SCREENS.settings, { title: (t) => t.payments.settingsTitle, Component: lazyScreen(() => import("@/components/payments/settings-screen")) })
  registerScreen(PAYMENT_SCREENS.history, { title: (t) => t.payments.historyTitle, Component: lazyScreen(() => import("@/components/payments/history-screen")) })

  // The stake is kept with the game as config.extras["payments.stake"].
  registerSlotItem("setup.extras", STAKE_EXTRA, lazy(() => import("@/components/payments/stake-setup")))
  registerSlotItem(
    "result.actions",
    "payments",
    whenInUse(
      () => import("@/components/payments/result-action"),
      (use, { match }) => resultOffer(match, use.wallet) !== null,
    ),
  )
  // Profil › Zahlungen is always there (the Profile tab is not the guest start path), so a wallet
  // can be connected calmly at home; the row says whether one is.
  registerSlotItem("profile.account", "payments", lazy(() => import("@/components/payments/payments-row")))
  registerSlotItem("profile.actions", "payments.congratulate", lazy(() => import("@/components/payments/congratulate")))
  // A game in the archive lists its payments, once there are any on this device.
  registerSlotItem(
    "match.rows",
    "payments",
    whenInUse(
      () => import("@/components/payments/match-rows"),
      (use) => use.payments,
    ),
  )

  // A wallet app came back with a new connection ("Wallet-App öffnen"). It counts only as the
  // answer to this device's own request (lib/payments/wallet-return.ts), and is kept only after the
  // person confirmed it. The connection leaves the address at once, also when the wallet put it
  // into the query. A requested connection is shown where it was asked for: by the connect panel on
  // screen, or by the payment sheet of the game it was asked from, which that game's result opens
  // again. Only otherwise is the connect screen opened for it.
  registerLinkHandler("wallet-return", (link, nav) => {
    const answer = acceptWalletReturn(link.payload, window.location.search)
    if (/[?&]value=/.test(window.location.search)) window.history.replaceState(window.history.state, "", window.location.pathname)
    if (answer === "unrequested") nav.push(PAYMENT_SCREENS.connect, { returned: "unrequested" }, { tab: "profile" })
    else if (answer === "connection" && !returnedConnection()?.from && !returnsWatched()) nav.push(PAYMENT_SCREENS.connect, {}, { tab: "profile" })
  })
}
