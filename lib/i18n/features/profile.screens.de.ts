// German texts of the profile area's screens, loaded with them (useAreaT, ./profile.screens.ts).
// Normal views never name the technology (decision 0002 §1); only `advanced` (Profil › Erweitert)
// may say relay, key and the like. The English file must have the same shape.
export const profileScreensDe = {
  // A profile without a name.
  unnamed: "Ohne Namen",
  gamesCount: (n: number) => (n === 1 ? "1 Spiel" : `${n} Spiele`),

  // "Deine Ergebnisse mitnehmen" on the result of a finished game.
  keep: {
    offer: "Deine Ergebnisse mitnehmen",
    later: "Später",
    laterLabel: "Später, nicht für dieses Spiel",
    done: "Dein Profil ist angelegt. Du findest es im Tab Profil.",
    description: "Lege ein Profil an. Deine Spiele bleiben bei dir, auch auf deinem nächsten Handy.",
    seat: "Welcher Spieler bist du?",
    seatHint: "Nur die Spiele dieses Spielers werden Teil deines Profils.",
    boardStays: (name: string) => `Am Board bleibst du „${name}“.`,
  },

  // Name and picture, when a profile is created or changed.
  form: {
    name: "Anzeigename",
    namePlaceholder: "So heißt du in deinem Profil",
    picture: "Bild (optional)",
    picturePlaceholder: "https://beispiel.de/bild.jpg",
    pictureHint: "Die Adresse eines Bildes im Internet. Hochgeladen wird nichts.",
    pictureInvalid: "Nur Adressen von Bildern, die mit https:// beginnen.",
    visible: "Für andere sichtbar: Name und Bild. Deine Spiele bleiben privat.",
    create: "Profil anlegen",
    creating: "Profil wird angelegt",
    failed: "Das Profil konnte nicht angelegt werden. Versuch es noch einmal.",
  },

  // "Profil anlegen" from the Profile tab, without a finished game at hand.
  create: {
    who: "Wer bist du auf diesem Gerät?",
    whoHint: "Die Spiele des gewählten Spielers werden Teil deines Profils.",
    nobody: "Keiner davon",
    nobodyHint: "Du startest ohne bisherige Spiele.",
    boardStays: (name: string) => `Am Board bleibst du „${name}“.`,
    boardShort: (name: string) => `Am Board heißt du „${name}“.`,
  },

  // The signed-in Profile tab.
  home: {
    boardName: (name: string) => `Am Board: ${name}`,
    // In place of the name while it isn't known yet, or couldn't be loaded.
    nameLoading: "Wird geladen",
    nameNotLoaded: "Nicht geladen",
    share: "Profil teilen",
    edit: "Bearbeiten",
    recent: "Letzte Spiele",
    noGames: "Noch keine X01-Spiele. Nach deinem ersten Spiel stehen hier deine Zahlen.",
    signOut: "Abmelden",
  },

  // The three figures on a profile.
  figures: {
    label: "Kennzahlen",
    games: "Spiele",
    won: "Gewonnen",
    average: "Ø Punkte pro 3 Darts",
    ofVersus: (n: number) => `von ${n} gegen andere`,
    allTime: "X01 · Alle Zeiten",
    unknown: "— heißt: noch nicht erfasst.",
    unknownShort: "nicht erfasst",
  },

  // Profil › Statistik, and a player's view on this device.
  stats: {
    mode: "Spielart",
    modes: { x01: "X01", cricket: "Cricket", clock: "Clock" },
    period: "Zeitraum",
    periods: { all: "Gesamt", year: "12 Monate", month: "30 Tage" },
    basis: (games: number, detailed: number) => `aus ${games === 1 ? "1 Spiel" : `${games} Spielen`}${detailed < games ? `, ${detailed} davon mit allen Würfen` : ""}`,
    none: "In diesem Zeitraum gibt es keine Spiele dieser Art.",
    results: "Ergebnisse",
    scoring: "Punkte",
    best: "Bestleistungen",
    winRate: "Siegquote",
    legsWon: "Gewonnene Legs",
    ofTotal: (part: number, whole: number) => `${part} von ${whole}`,
    bestLeg: "Bestes Leg",
    bestLegValue: (darts: number) => `${darts} Darts`,
    unknownNote: "— heißt: nicht erfasst. Manche Zahlen gibt es nur aus Spielen mit allen Würfen; von Ergebnissen der früheren Version sind nur Summen bekannt.",
    checkoutNote: "Die Checkout-Quote zählt nur Spiele, in denen die Darts aufs Doppel bekannt sind.",
  },

  // Profil › Spiele and one game's details.
  games: {
    won: (names: string) => `Gewonnen gegen ${names}`,
    lost: (names: string) => `Verloren gegen ${names}`,
    practice: "Training",
    none: "Noch keine Spiele",
    noneText: "Beende ein Spiel, dann steht es hier.",
    notFound: "Dieses Spiel ist auf diesem Gerät nicht vorhanden.",
    players: "Spieler",
    winner: "Sieger",
    imported: "Aus der früheren Version: Von diesem Spiel sind nur die Summen bekannt.",
    totals: "Summen",
    totalsX01: (darts: string, points: string) => `${darts} Darts, ${points} Punkte`,
    totalsDarts: (darts: string) => `${darts} Darts`,
    visits: "Aufnahmen",
  },

  // A player known only on this device.
  player: {
    onDevice: "Auf diesem Gerät",
    together: "Gegeneinander",
    togetherValue: (mine: number, theirs: number) => `${mine} : ${theirs} Siege`,
  },

  share: {
    title: "Profil teilen",
    description: "Wer den Code scannt oder den Link öffnet, sieht dein öffentliches Profil.",
    caption: "Zum Scannen mit der Kamera",
    label: "QR-Code deines Profils",
  },

  edit: {
    title: "Profil bearbeiten",
    save: "Sichern",
    boardName: "Name im Spiel",
    boardHint: (max: number) => `So stehst du am Board und in der Spielerwahl, höchstens ${max} Zeichen.`,
    publicHint: "So sehen dich andere, auch in anderen Apps.",
    loading: "Dein öffentliches Profil wird geladen.",
    notFound: "Zu deinem Profil wurde nichts gefunden. Speichern legt es neu an.",
    notLoaded: "Dein Profil konnte nicht geladen werden.",
    publicTitle: "Auch im öffentlichen Profil ändern?",
    publicDescription: (name: string) => `Dann heißt du überall „${name}“, auch in anderen Apps. Sonst nur hier in BlueLine.`,
    publicYes: "Auch öffentlich ändern",
    publicNo: "Nur in BlueLine",
  },

  // "So sehen andere dein Profil".
  preview: {
    intro: "So sehen andere gerade dein Profil. Deine Spiele, Gegner und Zahlungen sind nicht dabei.",
    toggle: "Statistik im Profil zeigen",
    toggleHint: "Deine Gesamtzahlen, ohne einzelne Spiele",
    update: "Statistik aktualisieren",
    outdated: "Deine Zahlen haben sich seitdem geändert.",
    noFigures: "Noch keine Spiele. Sobald du spielst, stehen deine Zahlen im Profil.",
  },

  // A public profile.
  public: {
    loading: "Profil wird geladen",
    own: "Das bist du.",
    sharedBy: "Vom Spieler geteilt",
    asOf: (date: string) => `Stand: ${date}`,
    noCard: "Keine freigegebenen Spiele.",
    offline: (date: string) => `Keine Verbindung. Zuletzt geladen: ${date}.`,
    offlineNever: "Keine Verbindung. Das Profil konnte nicht geladen werden.",
    partial: "Nicht alles war erreichbar. Was fehlt, kommt beim nächsten Öffnen.",
    notFound: "Zu diesem Profil wurde nichts gefunden.",
    invalid: "Dieser Profillink ist unvollständig.",
    retry: "Erneut versuchen",
    share: "Profil teilen",
  },

  // Game setup: seats from a profile, saved rounds.
  setup: {
    scan: "Spieler per QR hinzufügen",
    scanDescription: "Scanne den Profilcode deines Mitspielers. Sein Name kommt ins Spiel, seine Ergebnisse gehören ihm.",
    scanManual: "Link oder Code einfügen",
    scanPlaceholder: "Profillink",
    notProfile: "Das ist kein Profilcode.",
    nameLabel: "Name im Spiel",
    nameUnknown: "Zu diesem Profil ist kein Name bekannt. Gib ihn selbst ein.",
    nameShortened: (max: number) => `Im Spiel höchstens ${max} Zeichen. Das Profil behält seinen vollen Namen.`,
    sameName: (id: string) => `Ein anderer Spieler heißt auch so. Dieses Profil: ${id}`,
    alreadyIn: "Dieser Spieler ist schon im Spiel.",
    add: "Zum Spiel hinzufügen",
    full: "Alle sechs Plätze sind belegt.",
    quickPick: "Mit einem Tipp",
    me: "Du",
    rounds: "Deine Runden",
    saveRound: "Runde speichern",
    saveRoundDescription: "Speichere diese Spieler, um sie beim nächsten Mal mit einem Tipp zu wählen.",
    roundName: "Name der Runde",
    roundPlaceholder: "Dienstagsrunde",
    save: "Speichern",
    noNames: "Trag erst Namen ein.",
    guestsNotSaved: "Mit deiner Signer-App werden nur Spieler mit Profil gespeichert.",
    delete: (title: string) => `${title} löschen`,
    deleteTitle: "Runde löschen?",
    deleteDescription: "Die Spieler bleiben, nur die gespeicherte Runde verschwindet.",
    deleteConfirm: "Löschen",
    readOnly: "Diese Runde lässt sich auf diesem Gerät nicht ändern.",
  },

  // "Mit einer anderen App".
  connect: {
    intro: "Nutze das Profil, das du schon in einer anderen App hast. BlueLine fragt diese App, wenn etwas unterschrieben werden muss.",
    extension: "Browser-Erweiterung",
    extensionHint: "Etwa Alby oder nos2x am Computer",
    signerApp: "Signer-App",
    signerAppHint: "Amber oder eine andere App, auch auf einem anderen Gerät",
    android: "Android Signer",
    androidHint: "Eine Signer-App auf diesem Handy, etwa Amber",
    connecting: "Wird verbunden",
    noExtension: "Keine Browser-Erweiterung gefunden. Ist sie installiert und für diese Seite erlaubt?",
    qrCaption: "Scanne den Code mit deiner Signer-App.",
    qrLabel: "QR-Code zum Verbinden",
    openOnPhone: "In der Signer-App auf diesem Gerät öffnen",
    pasteLabel: "Oder Verbindungslink einfügen",
    pastePlaceholder: "Link aus deiner Signer-App",
    pasteInvalid: "Das ist kein Verbindungslink.",
    confirmPage: "Deine Signer-App möchte, dass du auf ihrer Seite bestätigst.",
    openConfirmPage: "Seite öffnen",
    newCode: "Ein anderes Gerät hat denselben Code gescannt. Zur Sicherheit gibt es einen neuen.",
    androidOpen: "Signer-App öffnen",
    androidWaiting: "Bestätige in der Signer-App. Danach geht es hier weiter.",
    accountTitle: "Bist du das?",
    accountHint: "Dieses Profil hat deine App genannt. Prüfe, ob es deins ist.",
    accountLoading: "Name wird geladen",
    accountUnknown: "Zu diesem Profil ist noch kein Name bekannt.",
    accountYes: "Ja, das bin ich",
    accountNo: "Abbrechen",
    claimTitle: "Gehören dir Spiele auf diesem Gerät?",
    claimHint: "Wähle deinen Namen, dann zählen diese Spiele zu deinem Profil.",
    claimNone: "Später",
    done: "Fertig",
  },

  // When a signer doesn't do what was asked.
  signer: {
    confirmPage: "Bestätige die Anfrage auf der Seite deiner Signer-App.",
    openPage: "Seite öffnen",
    rejected: "Die Anfrage wurde abgelehnt.",
    unknown: "Keine Antwort. Vielleicht kommt sie noch; sonst versuch es noch einmal.",
    mismatch: "Die Antwort passt nicht zu deinem Profil. Es wurde nichts geändert.",
    unavailable: "Die App, die für dich unterschreibt, ist gerade nicht erreichbar.",
    unsupported: "Deine Signer-App kann das nicht.",
    unreachable: "Dein Profil konnte nicht geladen werden. Versuch es noch einmal.",
    failed: "Das hat nicht geklappt. Versuch es noch einmal.",
  },

  // Signing in while another profile is signed in on this device.
  replace: {
    title: (name: string) => `Damit wird „${name}“ auf diesem Gerät abgemeldet`,
    description: "Die Spiele auf diesem Gerät bleiben.",
    confirm: "Abmelden und wechseln",
  },

  signOut: {
    title: "Abmelden?",
    description: "Auf einem Gerät, das andere mitbenutzen, kannst du deine Spiele hier gleich mit löschen.",
    localWarning: "Ohne Sicherung oder zweites Gerät kommst du danach nicht mehr an dieses Profil.",
    keep: "Abmelden, Spiele behalten",
    wipe: "Abmelden und alles hier löschen",
  },

  // Profil › Erweitert: the only place with technical words.
  advanced: {
    identity: "Technische Identität",
    access: "Zugang",
    kinds: {
      local: "Schlüssel auf diesem Gerät",
      nip07: "Browser-Erweiterung (NIP-07)",
      nip46: "Signer-App (NIP-46)",
      nip55: "Android Signer (NIP-55)",
    },
    publicKey: "Öffentlicher Schlüssel (npub)",
    fingerprint: "Öffentlicher Schlüssel",
    copy: "Kopieren",
    copied: "Kopiert",
    relays: "Relays (NIP-65)",
    relaysFooter: "Hier veröffentlicht dein Profil, und hier finden andere es.",
    defaultRelays: "Noch keine eigene Liste: das sind die Relays der App. Eine Änderung legt deine Liste an.",
    listLoading: "Deine Liste wird geladen",
    listNotLoaded: "Deine Liste konnte nicht geladen werden.",
    lastRelay: "Ein Relay muss mindestens bleiben.",
    read: "Lesen",
    write: "Schreiben",
    readWrite: "Lesen und Schreiben",
    states: { checking: "Wird geprüft", connected: "Verbunden", slow: "Langsam", unreachable: "Nicht erreichbar" },
    remove: (host: string) => `${host} entfernen`,
    recommended: "Empfohlen",
    addHost: (host: string) => `${host} hinzufügen`,
    add: "Relay hinzufügen",
    addPlaceholder: "relay.beispiel.de",
    addButton: "Hinzufügen",
    invalid: "Das ist keine Relay-Adresse.",
    diagnostics: "Diagnose kopieren",
    diagnosticsCopied: "Diagnose kopiert",
    diagnosticsHint: "Eine Zusammenfassung zum Melden von Problemen: Version, Relays, Zustand. Ohne geheime Daten und ohne deine Spiele.",
  },
}
