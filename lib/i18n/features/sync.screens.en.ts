import type { Widen } from "../index"
import type { syncScreensDe } from "./sync.screens.de.ts"

// English texts of the sync area. Same shape as sync.screens.de.ts.
export const syncScreensEn: Widen<typeof syncScreensDe> = {
  history: {
    loading: "Loading your games",
    loadingText: "Games from your other devices are on their way.",
    unavailable: "Your games couldn't be loaded yet",
    unavailableText: "Games from your other devices appear once there is a connection.",
    notOpened: "Your profile couldn't be opened",
    notOpenedText: "Your signer didn't answer or declined. Games from your other devices appear after a new attempt.",
    keyText: "Your games from other devices can't be opened with this signer. Advanced has the details.",
    retry: "Try again",
  },

  advanced: {
    title: "Sync",
    footer: "Your games are stored encrypted on your relays. Only your profile can read them. Missing copies are sent again when the app opens.",
    lastSync: "Last synced",
    never: "Never",
    notSent: "Not sent yet",
    notSentHint: "Sent at the next sync.",
    syncNow: "Sync now",
    syncing: "Syncing",
    states: {
      complete: "Complete",
      partial: "Partial",
      unavailable: "Unavailable",
    },
    problems: {
      offline: "No relay answered.",
      relays: "Not every relay answered.",
      signer: "Your signer didn't answer or declined.",
      unsupported: "Your signer can't encrypt or decrypt. Your games stay on this device.",
      key: "Your profile's data key doesn't open with this signer. No new one was made.",
      records: "Some games couldn't be read, maybe from a newer version of the app.",
      clock: "This device's clock is behind. Set it right and your changes are sent.",
    },
  },

  relays: {
    checking: "Checking",
    saving: "Saving",
    noAnswer: "No relay answers at this address.",
  },
}
