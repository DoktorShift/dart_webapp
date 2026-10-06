// German texts of the sync area, loaded with the screens that show them (useAreaT,
// ./sync.screens.ts). `history` appears in normal views and names no technology (decision 0002
// §1); `advanced` and `relays` appear under Profil › Erweitert only. The English file must have
// the same shape.
export const syncScreensDe = {
  // The profile's list of games while it is empty: this device hasn't looked for the games from
  // the profile's other devices yet, or couldn't.
  history: {
    loading: "Deine Spiele werden geladen",
    loadingText: "Spiele von deinen anderen Geräten kommen gleich dazu.",
    unavailable: "Deine Spiele konnten noch nicht geladen werden",
    unavailableText: "Spiele von deinen anderen Geräten erscheinen, sobald eine Verbindung besteht.",
    retry: "Erneut versuchen",
  },

  // Profil › Erweitert: the state of the sync with the profile's relays.
  advanced: {
    title: "Abgleich",
    footer: "Deine Spiele liegen verschlüsselt auf deinen Relays. Lesen kann sie nur dein Profil. Beim Öffnen der App werden fehlende Kopien erneut gesendet.",
    lastSync: "Zuletzt abgeglichen",
    lastCheck: "Kopien zuletzt geprüft",
    never: "Noch nie",
    waiting: "Wartende Übertragungen",
    fewCopies: "Weniger als zwei bestätigte Kopien",
    syncNow: "Jetzt abgleichen",
    syncing: "Wird abgeglichen",
    states: {
      complete: "Vollständig",
      partial: "Teilweise",
      unavailable: "Nicht verfügbar",
    },
    problems: {
      offline: "Kein Relay hat geantwortet.",
      signer: "Dein Signer hat nicht geantwortet oder abgelehnt.",
      unsupported: "Dein Signer kann nicht ver- und entschlüsseln. Deine Spiele bleiben auf diesem Gerät.",
      unreadable: "Der Datenschlüssel deines Profils lässt sich mit diesem Signer nicht öffnen. Es wurde kein neuer angelegt.",
    },
  },

  // Adding a relay under Profil › Erweitert.
  relays: {
    checking: "Wird geprüft",
    saving: "Wird gespeichert",
    noAnswer: "Unter dieser Adresse antwortet kein Relay.",
  },
}
