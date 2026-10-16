// German texts of the badges area's screens, loaded with them (useAreaT, ./badges.screens.ts).
// Normal views never name the technology (decision 0002 §1); only `advanced` may. The English
// file must have the same shape.
export const badgesScreensDe = {
  // The catalog's milestones (lib/badges/catalog.ts), by id: what it is called, what it means,
  // and the exact condition.
  milestones: {
    "first-win": { name: "Erster Sieg", description: "Dein erstes gewonnenes Spiel gegen andere.", condition: "Ein Spiel mit mindestens zwei Spielern gewinnen." },
    "games-10": { name: "10 Spiele", description: "Zehn Spiele zu Ende gespielt.", condition: "Zehn Spiele beenden, Training zählt mit." },
    "games-50": { name: "50 Spiele", description: "Fünfzig Spiele zu Ende gespielt.", condition: "Fünfzig Spiele beenden, Training zählt mit." },
    "games-100": { name: "100 Spiele", description: "Hundert Spiele zu Ende gespielt.", condition: "Hundert Spiele beenden, Training zählt mit." },
    "first-100": { name: "Erste 100+", description: "Eine Aufnahme mit 100 Punkten oder mehr.", condition: "In einem X01-Spiel 100 oder mehr mit drei Darts werfen." },
    "first-140": { name: "Erste 140+", description: "Eine Aufnahme mit 140 Punkten oder mehr.", condition: "In einem X01-Spiel 140 oder mehr mit drei Darts werfen." },
    "first-180": { name: "Erste 180", description: "Drei Triple-20 in einer Aufnahme.", condition: "In einem X01-Spiel 180 mit drei Darts werfen." },
    "checkout-100": { name: "Finish ab 100", description: "Ein Leg mit 100 Punkten oder mehr beendet.", condition: "In einem X01-Spiel ein Leg mit einem Finish von 100 oder mehr gewinnen." },
    "perfect-leg": { name: "Perfektes Leg", description: "Ein Leg in den wenigsten möglichen Darts, neun in 501.", condition: "In einem X01-Spiel ein Leg in den wenigsten möglichen Darts gewinnen." },
    "average-40": { name: "Schnitt 40", description: "Ein Spiel mit mindestens 40 Punkten pro drei Darts.", condition: "Ein X01-Spiel mit einem Schnitt von 40 oder mehr beenden." },
    "average-60": { name: "Schnitt 60", description: "Ein Spiel mit mindestens 60 Punkten pro drei Darts.", condition: "Ein X01-Spiel mit einem Schnitt von 60 oder mehr beenden." },
    "average-80": { name: "Schnitt 80", description: "Ein Spiel mit mindestens 80 Punkten pro drei Darts.", condition: "Ein X01-Spiel mit einem Schnitt von 80 oder mehr beenden." },
    "cricket-mpr-3": { name: "3 Marks pro Runde", description: "Ein Cricket-Spiel mit mindestens drei Marks pro Runde.", condition: "Ein Cricket-Spiel mit drei oder mehr Marks pro drei Darts beenden." },
    "cricket-nine-marks": { name: "Neun Marks", description: "Neun Marks in einer Aufnahme beim Cricket.", condition: "In einem Cricket-Spiel mit drei Darts neun Marks erzielen; Treffer auf eine Zahl, die alle schon geschlossen haben, zählen nicht." },
    "clock-30": { name: "Clock in 30", description: "Around the Clock in höchstens 30 Darts.", condition: "Ein Around-the-Clock-Spiel in 30 Darts oder weniger gewinnen." },
  },
  // Badges an organizer gives (lib/badges/organizer.ts), as the definitions are published.
  organizer: {
    "tournament-winner": (event: string) => ({ name: "Turniersieg", description: `Hat das Turnier „${event}“ gewonnen.` }),
    "tournament-finalist": (event: string) => ({ name: "Finalist", description: `Hat das Finale des Turniers „${event}“ erreicht.` }),
    "tournament-participant": (event: string) => ({ name: "Dabei", description: `Hat am Turnier „${event}“ teilgenommen.` }),
    "season-winner": (event: string) => ({ name: "Saisonsieg", description: `Hat die Saison „${event}“ gewonnen.` }),
    "season-regular": (event: string) => ({ name: "Regelmäßig dabei", description: `Hat in der Saison „${event}“ regelmäßig gespielt.` }),
  },

  // How far a milestone is (lib/badges/milestones.ts progress), by what it measures.
  progress: {
    games: (have: number, target: number) => `${have} von ${target} Spielen`,
    wins: "Noch kein Sieg gegen andere",
    highestVisit: (best: number | null) => (best === null ? "Noch keine Aufnahme" : `Beste Aufnahme bisher: ${best}`),
    highestCheckout: (best: number | null) => (best === null ? "Noch kein Finish" : `Höchstes Finish bisher: ${best}`),
    perfectLeg: "Noch nicht geschafft",
    average: (best: string | null) => (best === null ? "Noch kein Spiel" : `Bester Schnitt bisher: ${best}`),
    marksPerRound: (best: string | null) => (best === null ? "Noch kein Spiel" : `Beste Marks pro Runde bisher: ${best}`),
    marksInVisit: (best: number | null) => (best === null ? "Noch kein Spiel" : `Bisher höchstens ${best} Marks in einer Aufnahme`),
    clockDarts: (best: number | null) => (best === null ? "Noch keine Runde" : `Bisher ${best} Darts`),
  },

  // The card on the result of a finished game.
  earned: {
    one: (badge: string) => `Neue Auszeichnung: ${badge}`,
    oneOf: (player: string, badge: string) => `${player}: ${badge}`,
    several: (n: number) => `${n} neue Auszeichnungen`,
    dismiss: "Ausblenden",
    title: "Neue Auszeichnungen",
    description: "Auf diesem Gerät erreicht.",
    showAll: "Im Profil zeigen",
    showing: "Wird veröffentlicht",
    shown: "Jetzt in deinem Profil.",
    already: "Schon in deinem Profil.",
  },

  // A tournament's page, once its organizer gave the player a badge (components/badges/occasion-award.tsx).
  occasion: {
    given: (badge: string) => `Deine Auszeichnung „${badge}“ liegt unter Profil\u00a0›\u00a0Auszeichnungen.`,
    shown: (badge: string) => `Deine Auszeichnung „${badge}“ steht auf deiner Profilkarte.`,
  },

  // The badges screen.
  list: {
    row: "Auszeichnungen",
    rowNew: (n: number) => (n === 1 ? "1 neu" : `${n} neu`),
    shown: "Im Profil",
    shownFooter: "Die ersten drei stehen auf deiner Profilkarte.",
    earned: "Erreicht",
    reachable: "Erreichbar",
    reachableFooter: "Manche Auszeichnungen zählen nur aus Spielen mit allen Würfen; Ergebnisse der früheren Version haben nur Summen.",
    onDevice: "Auf diesem Gerät erreicht",
    received: "Erhalten",
    corrected: "Ergebnis korrigiert",
    none: "Noch keine Auszeichnungen",
    noneText: "Spiel weiter: deine erste Auszeichnung wartet auf dem Ergebnisbildschirm.",
    guestFooter: "Mit einem Profil kannst du Auszeichnungen in deinem Profil zeigen.",
    arrange: "Anordnen",
    more: "Weitere erhaltene Auszeichnungen",
    moreFooter: "Von Ausstellern, die dein Profil noch nicht kennt.",
  },

  // One badge.
  detail: {
    self: "Selbst erreicht",
    onDevice: "Auf diesem Gerät erreicht",
    condition: "Bedingung",
    progress: "Fortschritt",
    earnedAt: "Erreicht am",
    givenAt: "Vergeben am",
    issuer: "Aussteller",
    you: "Du",
    issuerUnknown: "Ohne Namen",
    result: "Ergebnis",
    resultElsewhere: "Spiel auf einem anderen Gerät",
    visibility: "Sichtbarkeit",
    inProfile: "Im Profil",
    notInProfile: "Nicht im Profil",
    show: "Im Profil zeigen",
    showFooter: "Veröffentlicht werden Name der Auszeichnung, Datum und Spielart des Spiels und die erreichte Zahl (etwa dein Schnitt in diesem Spiel). Deine anderen Spiele bleiben privat.",
    publishedFooter: "Die Auszeichnung ist schon veröffentlicht; sie kommt auf deine Profilkarte.",
    hide: "Aus dem Profil nehmen",
    hideFooter: "Die Auszeichnung bleibt veröffentlicht, nur nicht mehr auf deiner Karte.",
    voided: "Das Spiel wurde korrigiert; die Bedingung ist damit nicht mehr erfüllt.",
    voidedReceived: "Das Ergebnis wurde korrigiert; der Aussteller kann die Auszeichnung zurücknehmen.",
    requestDeletion: "Löschung anfragen",
    requestDeletionTitle: "Löschung anfragen?",
    requestDeletionDescription: "Die Auszeichnung kommt aus deinem Profil. Andere Apps und Dienste können der Anfrage folgen, müssen es aber nicht.",
    requestDeletionConfirm: "Anfragen",
    deletionRequested: "Löschung angefragt.",
    unavailable: "Diese Auszeichnung ist hier nicht bekannt.",
  },

  // Technical details of a badge, behind "Erweitert" only (decision 0002 §1).
  advanced: {
    title: "Erweitert",
    issuerKey: "Aussteller-Kennung",
    eventId: "Event-ID",
    definition: "Definition",
  },

  // Arranging the shown badges.
  arrange: {
    hint: "Die ersten drei stehen auf deiner Profilkarte.",
    up: (name: string) => `${name} nach oben`,
    down: (name: string) => `${name} nach unten`,
    save: "Speichern",
  },

  // When a change didn't work.
  problems: {
    offline: "Dein Profil ist gerade nicht erreichbar. Versuch es später noch einmal.",
    rejected: "Die Unterschrift wurde abgelehnt. Es wurde nichts geändert.",
    failed: "Das hat nicht geklappt. Versuch es noch einmal.",
  },
}
