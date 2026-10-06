import type { Messages } from "../index"

// English labels of the payments area that are needed before its screens load. Same shape as
// payments.de.ts.
export const paymentsEn: Messages["payments"] = {
  title: "Payments",
  connectTitle: "Connect Wallet",
  advancedTitle: "Advanced",
  sats: (amount: string) => `${amount} ${amount === "1" ? "sat" : "sats"}`,
  stake: {
    title: "Stake",
    none: "None",
    hint: "The loser pays the winner.",
  },
}
