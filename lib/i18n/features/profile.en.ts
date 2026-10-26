import type { Messages } from "../index"

// English texts of the profile area the start page needs. Same shape as profile.de.ts.
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

  titles: {
    stats: "Statistics",
    games: "Games",
    game: "Game",
    player: "Player",
    training: "Training",
    visibility: "Visibility",
    advanced: "Advanced",
  },

  seatLinked: "Linked to a profile",
}
