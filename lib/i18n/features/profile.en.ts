import type { Messages } from "../index"

// English texts for the profile area. Same shape as profile.de.ts.
export const profileEn: Messages["profile"] = {
  guest: {
    name: "Guest",
    onDevice: "Plays on this device",
    games: (n) => (n === 1 ? "Game" : "Games"),
    mostWins: "Most wins",
    noGames: "No finished games on this device yet.",
    stats: "On this device",
    createText: "Take your results with you and use them on your other devices.",
    create: "Create profile",
    haveProfile: "I already have a profile",
    existingTitle: "Welcome back",
    existingDescription: "How would you like to open your profile?",
    fromDevice: "From my other device",
    fromDeviceHint: "Connect with a code",
    fromBackup: "From my backup",
    fromBackupHint: "Backup file or passkey",
    fromApp: "With another app",
    fromAppHint: "Browser extension or Amber",
  },

  setup: {
    linked: "Linked to a profile",
  },
}
