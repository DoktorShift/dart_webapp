// German texts of the sync area, loaded with the screens that show them (useAreaT,
// ./sync.screens.ts). `history` appears in normal views and names no technology (decision 0002
// §1); `advanced` and `relays` appear under Profil › Erweitert only. The English file must have
// the same shape.
export const syncScreensDe = {
  // The profile's list of games while it is empty: this device hasn't looked for the games from
  // the profile's other devices yet, or couldn't (no connection, or the profile didn't open).
  history: {
    loading: "Deine Spiele werden geladen",
    loadingText: "Spiele von deinen anderen Geräten kommen gleich dazu.",
    unavailable: "Deine Spiele konnten noch nicht geladen werden",
    unavailableText: "Spiele von deinen anderen Geräten erscheinen, sobald eine Verbindung besteht.",
    notOpened: "Dein Profil konnte nicht geöffnet werden",
    notOpenedText: "Dein Signer hat nicht geantwortet oder abgelehnt. Spiele von deinen anderen Geräten erscheinen nach einem neuen Versuch.",
    keyText: "Deine Spiele von anderen Geräten lassen sich mit diesem Signer nicht öffnen. Mehr dazu steht unter Erweitert.",
    retry: "Erneut versuchen",
  },

  // Profil › Erweitert: the state of the sync with the profile's relays.
  advanced: {
    title: "Abgleich",
    footer: "Deine Spiele liegen verschlüsselt auf deinen Relays. Lesen kann sie nur dein Profil. Beim Öffnen der App werden fehlende Kopien erneut gesendet.",
    lastSync: "Zuletzt abgeglichen",
    never: "Noch nie",
    notSent: "Noch nicht gesendet",
    notSentHint: "Wird beim nächsten Abgleich gesendet.",
    syncNow: "Jetzt abgleichen",
    syncing: "Wird abgeglichen",
    states: {
      complete: "Vollständig",
      partial: "Teilweise",
      unavailable: "Nicht verfügbar",
    },
    problems: {
      offline: "Kein Relay hat geantwortet.",
      relays: "Nicht jedes Relay hat geantwortet.",
      signer: "Dein Signer hat nicht geantwortet oder abgelehnt.",
      unsupported: "Dein Signer kann nicht ver- und entschlüsseln. Deine Spiele bleiben auf diesem Gerät.",
      key: "Der Datenschlüssel deines Profils lässt sich mit diesem Signer nicht öffnen. Es wurde kein neuer angelegt.",
      records: "Einige Spiele konnten nicht gelesen werden, vielleicht aus einer neueren Version der App.",
      clock: "Die Uhr dieses Geräts geht nach. Stell sie richtig, dann werden deine Änderungen gesendet.",
    },
  },

  // Adding a relay under Profil › Erweitert.
  relays: {
    checking: "Wird geprüft",
    saving: "Wird gespeichert",
    noAnswer: "Unter dieser Adresse antwortet kein Relay.",
  },
}
