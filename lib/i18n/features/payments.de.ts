// German labels of the payments area that are needed before its screens load (see ../index.ts):
// the titles of its screens ("Zahlungen" is also its row in Profile), and the stake row in game
// setup with its amount. Everything else is in payments.screens.de.ts.
export const paymentsDe = {
  title: "Zahlungen",
  connectTitle: "Wallet verbinden",
  advancedTitle: "Erweitert",
  // `amount` comes formatted ("1.000"); one sat is "1 sat".
  sats: (amount: string) => `${amount} ${amount === "1" ? "sat" : "sats"}`,
  stake: {
    title: "Einsatz",
    none: "Keiner",
    hint: "Der Verlierer zahlt dem Sieger.",
  },
}
