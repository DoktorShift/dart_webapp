// German texts of the profile area the start page needs: the guest view, the titles of the
// area's screens (registered at start, components/profile/register.ts) and setup's mark for a
// seat filled from a profile. Everything else loads with the screens (profile.screens.de.ts).
// The English file must have the same shape (see ../index.ts).
export const profileDe = {
  // The Profile tab without a profile: this device's results and an offer, never a sign-in wall.
  guest: {
    name: "Gast",
    onDevice: "Spielt auf diesem Gerät",
    games: (n: number) => (n === 1 ? "Spiel" : "Spiele"),
    mostWins: "Meiste Siege",
    noGames: "Noch keine beendeten Spiele auf diesem Gerät.",
    stats: "Auf diesem Gerät",
    createText: "Nimm deine Ergebnisse mit und nutze sie auf deinen anderen Geräten.",
    create: "Profil anlegen",
    haveProfile: "Ich habe schon ein Profil",
    existingTitle: "Willkommen zurück",
    existingDescription: "Wie möchtest du dein Profil öffnen?",
    fromDevice: "Von meinem anderen Gerät",
    fromDeviceHint: "Mit einem Code verbinden",
    fromBackup: "Aus meiner Sicherung",
    fromBackupHint: "Sicherungsdatei oder Passkey",
    fromApp: "Mit einer anderen App",
    fromAppHint: "Browser-Erweiterung oder Amber",
  },

  titles: {
    stats: "Statistik",
    games: "Spiele",
    game: "Spiel",
    player: "Spieler",
    training: "Training",
    visibility: "Sichtbarkeit",
    advanced: "Erweitert",
  },

  // Game setup: a seat filled from a profile.
  seatLinked: "Mit Profil verbunden",
}
