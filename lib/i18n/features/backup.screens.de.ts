// German texts of the backup area's screens, loaded with them (useAreaT, ./backup.screens.ts):
// Profil › Sicherung, the hint on the own profile, "Aus meiner Sicherung" on a new device, and
// what the history says while it arrives. Plain words only (decision 0002 §1). The English file
// must have the same shape.
export const backupScreensDe = {
  // The second line of the row in Profile.
  row: {
    secured: "Gesichert",
    notSecured: "Noch nicht gesichert",
    passkeyOnly: "Passkey eingerichtet",
    signer: "In deiner Signer-App",
  },

  // One line on the own profile while nothing secures it.
  hint: {
    text: "Dein Profil ist noch nicht gesichert.",
    action: "Jetzt sichern",
    laterLabel: "Hinweis für 30 Tage ausblenden",
  },

  // Profil › Sicherung.
  screen: {
    securedTitle: "Dein Profil ist gesichert.",
    securedText: (date: string) => `Sicherungsdatei vom ${date}. Bewahre Datei und Kennwort gut auf.`,
    notSecuredTitle: "Dein Profil ist noch nicht gesichert.",
    notSecuredText: "Geht dieses Gerät verloren, ist dein Profil weg. Eine Sicherungsdatei bringt es zurück.",
    passkeyOnlyText: "Dein Passkey allein reicht nicht: Geht er verloren, ist dein Profil weg. Lege zusätzlich eine Sicherungsdatei an.",
    signerTitle: "Dein Zugang liegt in deiner Signer-App.",
    signerText: "Sichere ihn dort. BlueLine braucht dafür keine eigene Sicherung.",
    methods: "Sicherungen",
    file: "Sicherungsdatei",
    fileNew: "Sicherungsdatei erstellen",
    fileAgain: "Neue Sicherungsdatei erstellen",
    fileHint: "Eine Datei und ein Kennwort für deinen Passwortmanager",
    fileDate: (date: string) => `Erstellt am ${date}`,
    passkey: "Passkey",
    passkeyNew: "Passkey einrichten",
    passkeyHint: "Mit Face ID, Touch ID oder deinem Passwortmanager",
    passkeyDate: (date: string) => `Eingerichtet am ${date}`,
    passkeyUnconfirmed: "Noch nicht bestätigt",
    footer: "Eine Sicherung enthält deinen Zugang. Deine Spiele kommen auf einem neuen Gerät von selbst dazu.",
  },

  // The sheet that makes the backup file.
  fileSheet: {
    title: "Sicherungsdatei",
    preparing: "Wird vorbereitet",
    passwordLabel: "Dein Kennwort",
    passwordHint: "Speichere es jetzt in deinem Passwortmanager. Es wird nirgends sonst aufbewahrt; ohne Kennwort ist die Datei wertlos.",
    copy: "Kennwort kopieren",
    copied: "Kopiert",
    save: "Datei speichern",
    share: "Datei teilen",
    saved: "Datei gespeichert",
    savedHint: "Bewahre die Datei dort auf, wo du sie wiederfindest, etwa in deiner Cloud oder als Mail an dich selbst.",
    passwordCheck: "Kennwort gespeichert? Ohne Kennwort hilft die Datei nicht.",
    noted: "Ich habe das Kennwort notiert",
    failed: "Die Sicherung konnte nicht erstellt werden. Versuch es noch einmal.",
    retry: "Erneut versuchen",
    done: "Fertig",
  },

  // The sheet that sets up the passkey.
  passkeySheet: {
    title: "Passkey",
    text: "Dein Gerät fragt gleich nach Face ID, Touch ID oder deinem Passwortmanager. Mit dem Passkey öffnest du dein Profil später auf einem neuen Gerät.",
    note: "Ein Passkey allein ist keine vollständige Sicherung: Geht er verloren, ist dein Profil weg.",
    start: "Passkey einrichten",
    working: "Wird eingerichtet",
    done: "Passkey eingerichtet.",
    doneUnconfirmed: "Passkey eingerichtet. Die Sicherung ist noch nicht bestätigt; sie wird beim nächsten Öffnen noch einmal geprüft.",
    unsupported: "Auf diesem Gerät geht das leider nicht. Nutze die Sicherungsdatei.",
    cancelled: "Abgebrochen. Du kannst es jederzeit noch einmal versuchen.",
    failed: "Das hat nicht geklappt. Versuch es noch einmal oder nutze die Sicherungsdatei.",
    close: "Schließen",
  },

  // "Aus meiner Sicherung" on a new device.
  restore: {
    intro: "Mit deiner Sicherungsdatei und ihrem Kennwort, oder mit deinem Passkey.",
    fileTitle: "Sicherungsdatei",
    chooseFile: "Datei wählen",
    passwordLabel: "Kennwort",
    passwordPlaceholder: "xxxxx-xxxxx-xxxxx-xxxxx",
    open: "Profil öffnen",
    opening: "Wird geöffnet",
    passkeyTitle: "Passkey",
    passkey: "Mit Passkey öffnen",
    wrongPassword: "Das Kennwort passt nicht zu dieser Datei.",
    notBackup: "Das ist keine Sicherungsdatei von BlueLine.",
    newer: "Diese Sicherung stammt aus einer neueren Version der App. Aktualisiere die App.",
    damaged: "Die Datei ist beschädigt oder unvollständig.",
    notFound: "Zu diesem Passkey wurde keine Sicherung gefunden.",
    offline: "Die Sicherung konnte nicht geladen werden. Prüfe die Verbindung.",
    passkeyUnsupported: "Mit diesem Gerät geht das nicht. Nutze deine Sicherungsdatei.",
    cancelled: "Abgebrochen.",
    failed: "Das hat nicht geklappt. Versuch es noch einmal.",
  },

  // Once the profile is here (from a backup or another device).
  arrived: {
    done: (name: string) => `${name} ist dabei.`,
    doneUnnamed: "Dein Profil ist dabei.",
    doneText: "Du bist jetzt auch auf diesem Gerät angemeldet.",
    signerTitle: "Fast geschafft",
    signerText: "Dein Profil liegt in einer Signer-App. Verbinde sie jetzt auch auf diesem Gerät; dein Zugang bleibt dort.",
    signerConnect: "Signer-App verbinden",
    finish: "Fertig",
  },

  // The history from the profile's other devices, while it arrives.
  history: {
    loading: "Deine Spiele werden geladen",
    complete: (games: number) => (games === 1 ? "Dein Spiel ist da." : `Deine ${games} Spiele sind da.`),
    partial: "Nicht alle Spiele konnten geladen werden.",
    unavailable: "Deine Spiele konnten noch nicht geladen werden.",
    retry: "Erneut versuchen",
  },
}
