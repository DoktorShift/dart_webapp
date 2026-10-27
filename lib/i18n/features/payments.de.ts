// German labels of the payments area that are needed before its screens load (see ../index.ts):
// the titles of its screens ("Zahlungen" is also its row in Profile), and the stake row in game
// setup (its amount is formatted by lib/payments/money.ts, without texts). Everything else is in payments.screens.de.ts.
export const paymentsDe = {
  title: "Zahlungen",
  connectTitle: "Wallet verbinden",
  advancedTitle: "Erweitert",
  settingsTitle: "Einstellungen",
  historyTitle: "Alle Zahlungen",
  // The rate behind an amount in the currency: its time, or that there is none right now. Here
  // and not with the area's texts, so the stake row in setup can say its amount without them.
  rateFrom: (time: string) => `Kurs von ${time}`,
  rateMissing: "Kurs gerade nicht verfügbar",
  stake: {
    title: "Einsatz",
    none: "Keiner",
    hint: "Der Verlierer zahlt dem Sieger.",
  },
}
