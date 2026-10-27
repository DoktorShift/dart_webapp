import type { Messages } from "../index"

// English labels of the payments area that are needed before its screens load. Same shape as
// payments.de.ts.
export const paymentsEn: Messages["payments"] = {
  title: "Payments",
  connectTitle: "Connect Wallet",
  advancedTitle: "Advanced",
  settingsTitle: "Settings",
  historyTitle: "All Payments",
  rateFrom: (time: string) => `Rate from ${time}`,
  rateMissing: "Rate not available right now",
  stake: {
    title: "Stake",
    none: "None",
    hint: "The loser pays the winner.",
  },
}
