// German, the app's standard language. This catalog defines the shape every other language
// must match (see ./index.ts). Texts that contain numbers or names are functions, so word
// order and plurals stay right in each language.

import type { ModeId } from "@/types/game-modes"

// The options picked in setup that a game's rules text mentions.
export interface RuleOptions {
  doubleIn?: boolean
  doubleOut?: boolean
  bullFinish?: boolean
}

// Every game's texts have this shape.
export interface ModeTexts {
  name: string
  short: string
  description: string
  rules: (options: RuleOptions) => string
}

const darts = (n: number) => (n === 1 ? "1 Dart" : `${n} Darts`)

const PERFECT_LEGS: Record<number, string> = { 6: "Sechs-Darter", 9: "Neun-Darter", 12: "Zwölf-Darter" }

const X01_BASICS = "Zähle genau auf null herunter. Wirfst du mehr, als du noch hast, ist die Aufnahme überworfen und zählt nicht."

const x01Rules = ({ doubleIn = false, doubleOut = true }: RuleOptions) =>
  [X01_BASICS, doubleIn && "Gezählt wird erst ab dem ersten Double.", doubleOut && "Der letzte Dart muss ein Double oder das Bull treffen."]
    .filter(Boolean)
    .join(" ")

export const de = {
  lang: "de",
  // For dates and times.
  intl: "de-DE",

  common: {
    undo: "Rückgängig",
    undoLastDart: "Letzten Dart rückgängig machen",
    back: "Zurück",
    cancel: "Abbrechen",
    done: "Fertig",
    next: "Weiter",
    continue: "Weiterspielen",
    darts,
    dartWord: (n: number) => (n === 1 ? "Dart" : "Darts"),
    bull: "Bull",
    miss: "Daneben",
  },

  nav: {
    sections: "Bereiche",
    play: "Spielen",
    leaderboard: "Rangliste",
    settings: "Einstellungen",
    about: "Über die App",
  },

  modes: {
    "301": { name: "301", short: "Kurzes Leg", description: "Kurzes Leg, gut zum Einwerfen", rules: x01Rules },
    "501": { name: "501", short: "Standardspiel", description: "Das Standardspiel, runter auf null", rules: x01Rules },
    "701": { name: "701", short: "Langes Leg", description: "Langes Leg für größere Gruppen", rules: x01Rules },
    clock: {
      name: "Around the Clock",
      short: "1 bis 20 der Reihe nach",
      description: "Triff 1 bis 20 der Reihe nach",
      rules: ({ bullFinish }) =>
        `Triff die 1, dann die 2 und so weiter bis 20${bullFinish ? " und zum Schluss das Bull" : ""}, drei Darts pro Aufnahme. Jeder Teil der Zahl zählt. Wer zuerst durch ist, gewinnt.`,
    },
    cricket: {
      name: "Cricket",
      short: "15–20 und Bull schließen",
      description: "Schließe 15 bis 20 und das Bull",
      rules: () =>
        "Drei Treffer schließen eine Zahl: 15 bis 20 und das Bull. Weitere Treffer bringen Punkte, bis alle die Zahl geschlossen haben. Wer alles schließt und die meisten Punkte hat, gewinnt.",
    },
    cutthroat: {
      name: "Cut Throat Cricket",
      short: "Punkte für die Gegner",
      description: "Cricket, bei dem Punkte den Gegnern schaden",
      rules: () =>
        "Wie Cricket, aber deine weiteren Treffer geben allen Punkte, die die Zahl noch nicht geschlossen haben. Wer alles schließt und die wenigsten Punkte hat, gewinnt.",
    },
  } as Record<ModeId, ModeTexts>,

  // The games on the Play tab: X01 is 301, 501 or 701, and Cut Throat is a Cricket rule.
  families: {
    x01: { name: "X01", short: "301, 501, 701" },
    cricket: { name: "Cricket", short: "15 bis 20, Bull" },
    clock: { name: "Around the Clock", short: "1 bis 20" },
  },

  play: {
    practiceBoard: "Übungsscheibe",
    practiceBoardLabel: "Übungsscheibe. Tippe irgendwo auf die Scheibe, um einen Dart zu werfen.",
    hit: {
      bull: "Bullseye, 50",
      outerBull: "Single Bull, 25",
      miss: "Scheibe verfehlt",
      triple: (n: number, score: number) => `Triple ${n}, ${score}`,
      double: (n: number, score: number) => `Double ${n}, ${score}`,
    },
    visitTotal: (total: number) => `Aufnahme gesamt ${total}.`,
    newGame: "Neues Spiel",
    again: { title: "Letztes Spiel", start: "Nochmal spielen", change: "Ändern" },
    resumeTitle: (title: string) => `Laufendes Spiel: ${title}`,
    resumeLeg: (mode: string, leg: string) => `${mode}, ${leg}`,
    resumeOn: (name: string, target: string) => `${name} auf ${target}`,
    discard: "Verwerfen",
  },

  setup: {
    title: "Neues Spiel",
    players: "Spieler in Wurfreihenfolge",
    shuffle: "Mischen",
    move: (name: string) => `${name} verschieben`,
    remove: (name: string) => `${name} entfernen`,
    placeholder: (n: number) => `Spieler ${n}`,
    addPlayer: "Spieler hinzufügen",
    duplicate: "Zwei Spieler heißen gleich. Ändere einen der Namen.",
    solo: "Allein: üben und Statistik verfolgen.",
    order: "Ziehen, um die Reihenfolge zu ändern.",
    recent: "Zuletzt gespielt",
    rules: "Regeln",
    startScore: "Startpunkte",
    doubleIn: "Double In",
    doubleInHint: "Gezählt wird ab dem ersten Double oder Bull",
    doubleOut: "Double Out",
    doubleOutHint: "Mit einem Double oder dem Bull beenden",
    cutThroat: "Cut Throat",
    cutThroatHint: "Weitere Treffer bringen den Gegnern Punkte, die wenigsten gewinnen",
    bullFinish: "Mit dem Bull beenden",
    bullFinishHint: "Nach der 20 das Bull treffen, um zu gewinnen",
    legsToWin: "Legs zum Sieg",
    legsPerSet: "Legs pro Satz",
    legsHint: (n: number) => (n === 1 ? "Ein Leg entscheidet das Spiel" : `Wer zuerst ${n} Legs gewinnt, gewinnt das Spiel`),
    legsSetHint: (n: number) => `Wer zuerst ${n} Legs gewinnt, gewinnt den Satz`,
    sets: "Sätze",
    noSets: "Keine",
    setsHint: (n: number) => (n === 1 ? "Gespielt wird nur in Legs" : `Wer zuerst ${n} Sätze gewinnt, gewinnt das Spiel`),
    nextLeg: "Nächstes Leg beginnt",
    alternate: "Abwechselnd",
    loser: "Verlierer",
    alternateHint: "Die Spieler beginnen abwechselnd",
    loserHint: "Mugs away: Wer das Leg verloren hat, beginnt",
    start: "Spiel starten",
  },

  game: {
    leave: "Spiel verlassen",
    allVisits: "Alle Aufnahmen",
    options: "Spieloptionen",
    scores: "Spielstand",
    scoreEntry: "Punkteingabe",
    entry: "Eingabe",
    perDart: "Pro Dart",
    perVisit: "Pro Aufnahme",
    legOf: (leg: number, toWin: number) => `Leg ${leg}, First to ${toWin}`,
    // A leg by its place in the game: "Leg 3", or "Satz 2, Leg 1" when the game has sets.
    legName: ({ set, leg }: { set: number | null; leg: number }) => (set ? `Satz ${set}, Leg ${leg}` : `Leg ${leg}`),
    formatLegs: (n: number) => `First to ${n} Legs`,
    formatSets: (sets: number, legs: number) => `First to ${sets} Sätze à ${legs} Legs`,
    withBull: "mit Bull",
    doubleIn: "Double In",
    doubleOut: "Double Out",
    singleOut: "Single Out",
    cutThroat: "Punkte gehen an die Gegner",
    cricket: "15 bis 20 und Bull schließen",
    clockBull: "1 bis 20, dann das Bull",
    clock: "1 bis 20 der Reihe nach",
  },

  board: {
    legs: (n: number) => (n === 1 ? "1 Leg" : `${n} Legs`),
    legsWon: (won: number, needed: number) => `${won} von ${needed} Legs gewonnen`,
    sets: (n: number) => (n === 1 ? "1 Satz" : `${n} Sätze`),
    setsWon: (won: number, needed: number) => `${won} von ${needed} Sätzen gewonnen`,
    avg: (value: string) => `Ø ${value}`,
    last: (total: number) => `Zuletzt ${total}`,
    bust: "Überworfen",
    left: (score: number) => `noch ${score}`,
    throwing: "ist dran",
    leftGame: "hat das Spiel verlassen",
    points: (n: number) => `${n} Punkte`,
    pointsHeader: "Punkte",
    marks: (n: number) => (n === 1 ? "1 Treffer" : `${n} Treffer`),
    noMarks: "keine Treffer",
    closed: "zu",
    closedList: (targets: string) => `${targets} zu`,
    partial: (n: number, target: string) => `${n} auf ${target}`,
    and: " und ",
    aimFor: (name: string) => `Ziel für ${name}`,
    on: (target: string) => `auf ${target}`,
    finished: "Fertig",
  },

  visit: {
    toThrow: (name: string) => `${name} ist dran`,
    toThrowIn: (name: string, leg: string) => `${name} ist dran, ${leg}`,
    needsDouble: (name: string) => `${name} ist dran, braucht ein Double`,
    legPrefix: (leg: string) => `${leg}: `,
    correctDart: (n: number) => `Dart ${n}: den richtigen Wert tippen`,
    correctTotal: (name: string) => `Richtige Summe für ${name} eingeben`,
    whichDart: (name: string) => `Welcher Dart von ${name} war falsch?`,
    summary: (name: string, result: string) => `${name}: ${result}`,
    noScoreResult: "0 Punkte",
    hitsOf: (hits: number, thrown: number) => `${hits} von ${thrown} getroffen`,
    correctThis: (summary: string) => `${summary}. Diese Aufnahme korrigieren`,
    dartSlot: (n: number, label: string) => `Dart ${n}, ${label}. Zum Korrigieren tippen`,
    total: "Aufnahme",
    correctedTotal: "Korrigierte Summe",
    checkout: "Checkout",
    checkoutRoute: (route: string) => `Checkout ${route}`,
    typedBust: (score: number) => `Überworfen, bleibt bei ${score}`,
    typedNoFinish: (score: number) => `Kein Finish von ${score}`,
  },

  keypad: {
    double: "Double",
    triple: "Triple",
    // The rest of the visit missed: "2×" over the word for a miss.
    restCount: (n: number) => `${n}×`,
    restLabel: (n: number) => `Rest der Aufnahme daneben: ${darts(n)} mit 0 Punkten`,
    missLabel: "Daneben, 0 Punkte",
    bullLabel: "Bull, 50",
    outerBullLabel: "Single Bull, 25",
    deleteDigit: "Ziffer löschen",
    enter: (typed: string) => (typed ? `${typed} eintragen` : "Eintragen"),
    quickTotal: (n: number) => `${n} eintragen`,
    zeroOrBust: ["0 Punkte", "oder überworfen"],
    zeroOrBustLabel: "Null Punkte oder überworfen",
    checkoutQuestion: (score: string) => `Checkout ${score}! Wie viele Darts?`,
    atDoubleQuestion: "Wie viele Darts aufs Double?",
    closedByAll: ", von allen geschlossen",
    closedScores: ", geschlossen, bringt Punkte",
    hit: "Treffer",
    hitTarget: (target: number) => (target === 25 ? "Bull getroffen" : `${target} getroffen`),
    missTarget: (target: number) => (target === 25 ? "Bull verfehlt" : `${target} verfehlt`),
  },

  callout: { bust: "Überworfen", nineMarks: "9 Treffer" },

  leg: {
    wins: (name: string) => `${name} gewinnt das Leg`,
    winsSet: (name: string) => `${name} gewinnt den Satz`,
    // A leg won in the fewest darts possible: the nine-darter in 501.
    perfect: (dartsUsed: number) => PERFECT_LEGS[dartsUsed] ?? "Perfektes Leg",
    perfectDetail: (name: string, dartsUsed: number, dart: string | null) =>
      `${name} gewinnt das Leg mit ${darts(dartsUsed)}${dart ? `, Checkout auf ${dart}` : ""}`,
    checkedOut: (score: number, dart: string | null, dartsUsed: number) =>
      `Checkout ${score}${dart ? ` auf ${dart}` : ""} mit ${darts(dartsUsed)}`,
    closedBoard: (dartsUsed: number) => `Alles geschlossen mit ${darts(dartsUsed)}`,
    aroundBoard: (dartsUsed: number) => `Einmal rum mit ${darts(dartsUsed)}`,
    next: (name: string) => `Nächstes Leg, ${name} beginnt`,
    nextSet: (name: string) => `Nächster Satz, ${name} beginnt`,
    setsHeader: "Sätze",
    legsHeader: "Legs",
    review: "Aufnahmen ansehen",
  },

  result: {
    complete: "Spiel beendet",
    wins: (name: string) => `${name} gewinnt`,
    legScore: (a: number, b: number) => `${a} – ${b} in Legs`,
    setScore: (a: number, b: number) => `${a} – ${b} in Sätzen`,
    perfect: (name: string, by: string | null, leg: string | null) => `${name}${by ? ` von ${by}` : ""}${leg ? ` in ${leg}` : ""}!`,
    statistic: "Statistik",
    stats: {
      average: "3-Dart-Average",
      first9: "First-9-Average",
      highestVisit: "Beste Aufnahme",
      highestCheckout: "Bestes Checkout",
      checkoutRate: "Checkout-Quote",
      tons180: "180er",
      tons140: "140+",
      tons100: "100+",
      setsWon: "Gewonnene Sätze",
      legsWon: "Gewonnene Legs",
      maxes: "180 / 140+ / 100+",
      darts: "Geworfene Darts",
      marksPerRound: "Treffer pro Runde",
      points: "Punkte",
      hitRate: "Trefferquote",
    },
    // Column heads where every player has a row: the full name is read out with each.
    short: {
      average: "Ø",
      first9: "First 9",
      highestCheckout: "Finish",
      checkoutRate: "Quote",
      marksPerRound: "MPR",
      points: "Punkte",
      darts: "Darts",
      hitRate: "Quote",
      legsWon: "Legs",
      setsWon: "Sätze",
    },
    rematch: "Revanche",
    newGame: "Neues Spiel",
    undoDart: "Rückgängig",
    visits: "Aufnahmen",
    visitsLabel: "Alle Aufnahmen ansehen",
    share: "Teilen",
    shareText: (line: string) => `${line}. Gezählt mit BlueLine Darts.`,
    imageFooter: "Gezählt mit BlueLine Darts",
    allStats: "Statistik",
    allStatsDescription: "Alle Werte dieses Spiels.",
  },

  sheets: {
    leave: {
      title: "Spiel verlassen?",
      description: "Der Spielstand bleibt auf diesem Gerät gespeichert. Unter Spielen kannst du später weitermachen.",
      save: "Speichern und verlassen",
      discard: "Spiel beenden ohne Speichern",
      stay: "Weiterspielen",
    },
    history: {
      title: "Aufnahmen",
      description: "Tippe auf eine Aufnahme, um sie zu korrigieren. Alles danach wird neu berechnet.",
      empty: "Noch keine Aufnahmen.",
      leg: (leg: string, winner: string | null) => (winner ? `${leg}, gewonnen von ${winner}` : `${leg}, läuft`),
      totalOf: (dartsUsed: number) => `Summe, ${darts(dartsUsed)}`,
      corrected: "Korrigiert",
      kept: "Ergebnis wie gespielt",
    },
    thrower: {
      title: (name: string) => `${name} jetzt werfen lassen?`,
      legStart: "Wenn jemand anderes dieses Leg beginnt, zum Beispiel nach dem Ausbullen.",
      wrongPlayer: "Wenn der falsche Spieler dran war. Danach geht es der Reihe nach weiter.",
      confirm: (name: string) => `${name} wirft jetzt`,
    },
    correction: {
      changesLeg: (leg: string) => `Das ändert ${leg}`,
      apply: "Korrektur übernehmen?",
      keptDescription: (leg: string, winner: string) =>
        `Mit dem korrigierten Wert würde ${leg} nicht so enden, wie es gespielt wurde. Nach den Darts-Regeln bleibt ein beendetes Leg bestehen: ${winner} kann Sieger bleiben, nur die Statistik wird korrigiert.`,
      droppedDescription: (dropped: number) =>
        `Die Aufnahme endet jetzt früher, deshalb zählen ${darts(dropped)} danach nicht mehr und werden entfernt. Rückgängig holt sie zurück.`,
      keepWinner: (name: string) => `${name} bleibt Sieger`,
      rescore: (leg: string, dropped: number) => `${leg} neu werten${dropped > 0 ? `, entfernt ${darts(dropped)} danach` : ""}`,
      applyButton: "Korrektur übernehmen",
    },
    options: {
      title: "Spieloptionen",
      leavingTitle: "Wer hört auf?",
      restartTitle: (leg: string) => `${leg} neu starten?`,
      leavingDescription: "Die Punkte bleiben in der Statistik und die anderen spielen weiter. Rückgängig holt den Spieler zurück.",
      restartDescription: "Alle Darts dieses Legs werden gelöscht und das Leg beginnt neu. Rückgängig holt sie zurück.",
      restartLeg: "Dieses Leg neu starten",
      playerLeaves: "Ein Spieler hört auf",
      restartButton: "Leg neu starten",
      tip: "Falscher Dart? Antippen und korrigieren. Falscher Spieler? Seinen Spielstand antippen.",
    },
  },

  preferences: {
    sounds: "Töne",
    soundsHint: "Ein Klack pro Dart, eine Fanfare beim Checkout",
    caller: "Ansager",
    callerHint: "Sagt Punkte und Rest an, auf Englisch wie im Profi-Darts",
    askAtDouble: "Darts aufs Double abfragen",
    askAtDoubleHint: "Für eine genaue Checkout-Quote",
  },

  leaderboard: {
    title: "Rangliste",
    subtitle: "Sortiert nach Siegen, dann Siegquote. Auf diesem Gerät gespeichert.",
    filter: "Spielart",
    filters: { all: "Alle", x01: "X01", cricket: "Cricket", clock: "Clock" },
    today: (time: string) => `Heute, ${time}`,
    yesterday: (time: string) => `Gestern, ${time}`,
    won: (name: string, mode: string) => `${name} gewinnt ${mode}`,
    against: (names: string) => `gegen ${names}`,
    emptyTitle: "Noch keine Ergebnisse",
    emptyAll: "Beende ein Spiel mit zwei oder mehr Spielern, dann stehen alle in der Rangliste.",
    emptyFilter: "Auf diesem Gerät wurde diese Spielart noch nicht beendet.",
    topThree: "Die besten drei",
    wins: (n: number) => (n === 1 ? "1 Sieg" : `${n} Siege`),
    allPlayers: "Alle Spieler",
    player: "Spieler",
    avg: "Ø",
    winsHeader: "Siege",
    games: (n: number, rate: string) => `${n === 1 ? "1 Spiel" : `${n} Spiele`}, ${rate} Siege`,
    emptyAction: "Spiel starten",
    avgNote: "Ø ist der 3-Dart-Average in X01-Spielen.",
    recent: "Letzte Spiele",
  },

  settings: {
    title: "Einstellungen",
    duringGame: "Im Spiel",
    scoreEntry: "Eingabe bei 301, 501 und 701",
    scoreEntryHint: "Auch im Spiel unter ••• umstellbar",
    askAtDoubleHint: "Nach Aufnahmen auf ein Finish, für eine genaue Checkout-Quote",
    app: "App",
    homeScreenApp: "App auf dem Home-Bildschirm",
    installed: "Installiert",
    installHint: "Öffnet im Vollbild und funktioniert offline",
    install: "Installieren",
    iosShare: ["Tippe in Safari auf", "Teilen."],
    iosAdd: ["Wähle", "„Zum Home-Bildschirm“."],
    manual: "Wähle im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“.",
    guide: "Schritt-für-Schritt-Anleitung",
    appInstalledFooter: "Spiele und Rangliste sind auf diesem Gerät gespeichert und funktionieren ohne WLAN.",
    appFooter: "Installiere die App, damit Spiele und Rangliste auf diesem Gerät bleiben. Browser löschen Website-Daten oft nach einigen Wochen ohne Besuch.",
    language: "Sprache",
    languageSystem: "Automatisch",
    appearance: "Darstellung",
    themes: { dark: "Dunkel", light: "Hell", system: "Automatisch" },
    leaderboard: "Rangliste",
    leaderboardFooter: "Ergebnisse werden nur auf diesem Gerät gespeichert.",
    savedGames: "Gespeicherte Spiele",
    reset: "Rangliste zurücksetzen",
    resetTitle: "Rangliste zurücksetzen?",
    resetDescription: (n: number) =>
      `Das löscht ${n === 1 ? "das gespeicherte Spiel" : `alle ${n} gespeicherten Spiele`} auf diesem Gerät. Das lässt sich nicht rückgängig machen.`,
    resetConfirm: "Zurücksetzen",
    about: "Über die App",
    aboutApp: (name: string) => `Über ${name}`,
  },

  undoBanner: { ended: "Spiel beendet" },

  fallback: {
    errorTitle: "Bounce-out",
    errorMessage: "Da ist etwas danebengegangen. Dein Spiel ist gespeichert.",
    backToGame: "Zurück zum Spiel",
    newGame: "Neues Spiel starten",
    notFoundTitle: "Daneben",
    notFoundMessage: "Diese Seite gibt es nicht. Zum Spiel ist es nur ein Tipp.",
    goTo: (name: string) => `Zu ${name}`,
    unsupportedTitle: "Neuerer Browser nötig",
    unsupportedMessage: (name: string) =>
      `${name} läuft auf iPhone und iPad ab iOS 16 und in aktuellen Versionen von Chrome, Edge und Firefox.`,
  },

  meta: {
    title: "BlueLine Darts: kostenloser Darts-Zähler für 501 & Cricket",
    tagline: "Kostenloser Darts-Zähler für Handy und Tablet",
    description:
      "Kostenlose Darts-App für Handy und Tablet: 501, 301, Cricket und Around the Clock für 1 bis 6 Spieler. Mit Checkout-Wegen, Statistik und Rangliste. Offline nutzbar.",
    keywords: [
      "Darts Zähler",
      "Darts App",
      "Darts Punkte zählen",
      "Darts Rechner",
      "501 Darts",
      "Darts Checkout Tabelle",
      "Cricket Darts",
      "Around the Clock Darts",
      "Darts Scoreboard",
      "kostenlose Darts App",
      "Darts App Tablet",
      "dart scorer",
      "darts scoring app",
    ],
    features: [
      "501, 301 und 701 mit Double In und Double Out",
      "Cricket und Cut Throat Cricket",
      "Around the Clock",
      "1 bis 6 Spieler, Legs und Sätze",
      "Checkout-Wege für jedes Finish",
      "Eingabe pro Dart oder pro Aufnahme",
      "Korrigieren und Rückgängig",
      "3-Dart-Average, First-9-Average, Checkout-Quote",
      "Rangliste",
      "Offline nutzbar, installierbar",
    ],
    freelance: (name: string) => `${name} ist offen für Freelance-Aufträge, vom kleinen privaten Projekt bis zu größeren Vorhaben.`,
    jobTitle: "Freelance-Entwickler",
    imageAlt:
      "BlueLine Darts auf dem Handy vor einer leuchtenden Dartscheibe: ein 501-Spiel mit Mia auf 81 und dem Checkout-Weg T19, D12.",
  },

  about: {
    title: "Über die App",
    back: "Zähler",
    metaTitle: "Über die App, Regeln und FAQ",
    metaDescription:
      "So funktioniert BlueLine Darts: Regeln für 501, Cricket, Cut Throat Cricket und Around the Clock, die App installieren und offline spielen, und wer sie gemacht hat.",
    install: "Installieren und offline spielen",
    installCaption: "Öffnet im Vollbild wie eine App und zählt auch ohne WLAN. Dauert nur ein paar Taps.",
    openScorer: "Zum Zähler",
    howItWorks: "So geht’s Schritt für Schritt",
    installedNote: "Alles bereit: Öffne BlueLine vom Home-Bildschirm, mit oder ohne WLAN.",
    facts: ["Kostenlos, ohne Konto", "Funktioniert offline", "1 bis 6 Spieler"],
    howToPlay: "So wird gespielt",
    // The X01 games share one entry; the other games use their rules from `modes`.
    x01: {
      name: "501, 301 und 701",
      rules: `${X01_BASICS} Mit Double Out muss der letzte Dart ein Double oder das Bull treffen, mit Double In zählt erst das erste Double. 301 ist das kurze Spiel, 701 das lange für größere Gruppen.`,
    },
    questions: "Fragen",
    faq: [
      { q: "Ist BlueLine Darts kostenlos?", a: "Ja. Kein Konto, keine Werbung und keine In-App-Käufe." },
      { q: "Funktioniert es offline?", a: "Ja. Auf dem Home-Bildschirm installiert, öffnet es und zählt auch ohne WLAN." },
      { q: "Wie installiere ich es?", a: "iPhone und iPad: in Safari auf Teilen, dann „Zum Home-Bildschirm“. Android: im Menü „App installieren“. Computer: das Installieren-Symbol in der Adressleiste." },
      {
        q: "Wo werden meine Spiele gespeichert?",
        a: "Nur auf deinem Gerät. Das laufende Spiel wird nach jedem Dart gespeichert, ein geschlossener Tab oder ein leerer Akku verliert nichts.",
      },
      {
        q: "Wie korrigiere ich einen falschen Wert?",
        a: "Tippe den falschen Dart in der Aufnahme an und wähle den richtigen Wert. Alle früheren Aufnahmen findest du hinter dem Uhr-Symbol oben, und Rückgängig geht immer einen Schritt zurück.",
      },
      { q: "Wie viele können mitspielen?", a: "Eins bis sechs. Allein ist es ein Training mit deiner Statistik." },
    ],
    madeBy: (name: string) => `Gemacht von ${name}`,
    authorNote: [
      "Hi, ich bin DrShift. Ich habe BlueLine Darts entworfen und gebaut.",
      "Ich bin offen für Freelance-Aufträge, vom kleinen privaten Projekt bis zu größeren Vorhaben. Du hast eine Idee für eine App oder Website? Melde dich.",
    ],
    contact: (name: string) => `${name} auf GitHub kontaktieren`,
    source: "Quellcode auf GitHub",
  },

  install: {
    title: "App installieren",
    description: "Danach öffnet BlueLine im Vollbild und zählt ohne WLAN.",
    device: "Gerät",
    thisDevice: "Dieses Gerät",
    platforms: { ios: "iPhone, iPad", android: "Android", desktop: "Computer" },
    guideFor: (platform: string) => `Installieren auf ${platform}`,
    step: (n: number, of: number) => `Schritt ${n} von ${of}`,
    installed: "Installiert",
    offlineReady: "Offline bereit",
    qrTitle: "Am Board spielen?",
    qrText: (name: string) => `Scanne den Code mit der Handykamera, um ${name} dort zu öffnen. Dann den Schritten für dein Handy folgen.`,
    qrLabel: "QR-Code, der BlueLine Darts öffnet",
    steps: {
      ios: [
        { title: "Auf Teilen tippen", text: "Tippe in Safari auf Teilen. Unter iOS 26 steckt es im •••-Menü neben der Adressleiste, auf dem iPad oben rechts." },
        { title: "„Zum Home-Bildschirm“ tippen", text: "Scrolle in der Liste nach unten, falls du es nicht gleich siehst." },
        { title: "„Hinzufügen“ tippen", text: "Lass den Namen BlueLine. Falls „Als Web-App öffnen“ erscheint, lass es eingeschaltet." },
        { title: "Vom Home-Bildschirm spielen", text: "Öffne BlueLine über das Symbol: im Vollbild und auch ohne WLAN." },
      ],
      android: [
        { title: "Menü öffnen", text: "Tippe in Chrome oben rechts auf ⋮. In Samsung Internet unten auf ≡." },
        { title: "„App installieren“ tippen", text: "Auf manchen Handys heißt es „Zum Startbildschirm hinzufügen“." },
        { title: "„Installieren“ tippen", text: "BlueLine landet auf dem Startbildschirm und in der App-Übersicht." },
        { title: "Vom Startbildschirm spielen", text: "Öffne BlueLine über das Symbol: im Vollbild und auch ohne WLAN." },
      ],
      desktop: [
        {
          title: "Installieren in der Adressleiste",
          text: "In Chrome oder Edge rechts in der Adressleiste auf das Installieren-Symbol klicken. In Safari auf dem Mac: Ablage, dann „Zum Dock hinzufügen“.",
        },
        { title: "„Installieren“ klicken", text: "BlueLine öffnet sich in einem eigenen Fenster, wie jede App." },
        { title: "Wie jede App starten", text: "BlueLine findest du im Dock, im Startmenü oder im Launchpad. Funktioniert auch ohne Internet." },
      ],
    },
    // Words inside the step pictures, as the phone or browser would show them in this language.
    picture: {
      copy: "Kopieren",
      cancel: "Abbrechen",
      addBookmark: "Lesezeichen",
      addToHome: "Zum Home-Bildschirm",
      addToFavourites: "Zu Favoriten",
      add: "Hinzufügen",
      homeScreenName: "Name auf dem Home-Bildschirm",
      openAsWebApp: "Als Web-App öffnen",
      worksOffline: "Offline nutzbar",
      newTab: "Neuer Tab",
      history: "Verlauf",
      installApp: "App installieren",
      settings: "Einstellungen",
      installQuestion: "App installieren?",
      install: "Installieren",
      labels: {
        "ios-share": "Safari auf dem iPhone, der Teilen-Knopf ist markiert",
        "ios-add": "Das Teilen-Menü, „Zum Home-Bildschirm“ ist markiert",
        "ios-confirm": "Der Bildschirm „Zum Home-Bildschirm“, der Knopf „Hinzufügen“ ist markiert",
        "home-screen": "Ein Home-Bildschirm mit dem markierten BlueLine-Symbol, offline nutzbar",
        "android-menu": "Chrome auf Android, der Menü-Knopf ist markiert",
        "android-install": "Das Chrome-Menü, „App installieren“ ist markiert",
        "android-confirm": "Der Installieren-Dialog, der Knopf „Installieren“ ist markiert",
        "desktop-install": "Eine Browser-Adressleiste, das Installieren-Symbol ist markiert",
        "desktop-confirm": "Das Installieren-Fenster, der Knopf „Installieren“ ist markiert",
        "desktop-dock": "Ein Dock mit dem markierten BlueLine-Symbol",
      },
    },
  },
}
