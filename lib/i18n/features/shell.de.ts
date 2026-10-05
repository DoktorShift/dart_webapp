// German texts for the shell area: tabs, navigation, shared building blocks and the screens other
// areas fill in later. The English file must have the same shape (see ../index.ts).
export const shellDe = {
  tabs: {
    play: "Spielen",
    leaderboard: "Rangliste",
    clubs: "Clubs",
    tournaments: "Turniere",
    profile: "Profil",
  },

  backTo: (screen: string) => `Zurück zu ${screen}`,

  // Screens the shell already links to. Areas replace their content later.
  screens: {
    clubCreate: "Club gründen",
    clubInvite: "Einladung",
    openInvite: "Einladung öffnen",
    tournamentCreate: "Turnier erstellen",
    tournament: "Turnier",
    publicProfile: "Spielerprofil",
    pair: "Gerät verbinden",
    watch: "Zuschauen",
    board: "Am Board mitspielen",
  },
  comingSoon: "Dieser Bereich kommt mit einer der nächsten Versionen.",
  linkNotYet: "Diesen Link kann diese Version noch nicht öffnen.",
  loadFailed: "Dieser Bereich konnte nicht geladen werden. Prüfe die Verbindung.",
  retry: "Erneut versuchen",
  loading: "Wird geladen",

  clubs: {
    emptyTitle: "Noch kein Club",
    emptyText: "Gründe einen Club für eure Dartabende oder tritt mit einer Einladung bei.",
    create: "Club gründen",
    openInvite: "Einladung öffnen",
  },

  tournaments: {
    emptyTitle: "Noch kein Turnier",
    emptyText: "Erstelle ein Turnier oder melde dich mit einer Einladung an.",
    create: "Turnier erstellen",
    openInvite: "Einladung öffnen",
  },

  // Opening an invitation by scanning its code or pasting its link.
  openLink: {
    intro: "Scanne den Code der Einladung oder füge den Link ein.",
    manualLabel: "Link einfügen",
    manualPlaceholder: "Link der Einladung",
    invalid: "Das ist kein BlueLine-Link. Prüfe, ob er vollständig ist.",
    notClub: "Das ist keine Club-Einladung.",
    notTournament: "Das ist keine Turnier-Einladung.",
  },

  scanner: {
    start: "Code scannen",
    starting: "Kamera wird gestartet",
    hint: "Richte die Kamera auf den Code.",
    stop: "Scannen beenden",
    viewfinder: "Kamerabild zum Scannen",
    deniedTitle: "Kein Zugriff auf die Kamera",
    deniedText: "Erlaube den Kamerazugriff in den Einstellungen deines Browsers oder nutze das Feld unten.",
    noCameraTitle: "Keine Kamera gefunden",
    noCameraText: "Nutze das Feld unten.",
    unavailableTitle: "Scannen ist hier nicht möglich",
    unavailableText: "Dieser Browser gibt die Kamera nicht frei. Nutze das Feld unten.",
    errorTitle: "Die Kamera ließ sich nicht starten",
    errorText: "Vielleicht nutzt eine andere App sie gerade.",
    tryAgain: "Erneut versuchen",
    manualLabel: "Code eingeben",
    manualPlaceholder: "Code oder Link",
    submit: "Öffnen",
  },

  qr: {
    label: "QR-Code",
    share: "Teilen",
    copy: "Link kopieren",
    copied: "Kopiert",
    loadFailed: "Der Code konnte nicht geladen werden. Prüfe die Verbindung.",
    copyFailed: "Kopieren war nicht möglich. Halte den Link gedrückt, um ihn zu kopieren.",
  },
}
