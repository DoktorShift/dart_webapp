// German texts for the data area. The English file must have the same shape (see ../index.ts).

const games = (n: number) => (n === 1 ? "1 Spiel" : `${n} Spiele`)
const players = (n: number) => (n === 1 ? "1 Spieler" : `${n} Spieler`)

export const dataDe = {
  // Settings: export, import, delete everything.
  title: "Daten",
  footer: "Exportieren speichert alle Spiele und Spieler dieses Geräts in einer Datei. So kannst du sie sichern und auf einem anderen Gerät importieren.",
  unavailableFooter:
    "In diesem Browser bleiben die Details beendeter Spiele nur erhalten, solange die App geöffnet ist. Exportiere deine Daten, um sie zu behalten.",
  export: "Daten exportieren",
  import: "Daten importieren",
  wipe: "Alle Daten auf diesem Gerät löschen",
  fileName: "blueline-daten",
  exportFailedTitle: "Export nicht möglich",
  exportFailed: "Die Daten konnten gerade nicht gelesen werden. Versuche es noch einmal.",
  importDoneTitle: "Import abgeschlossen",
  importNothingTitle: "Nichts Neues",
  importAdded: (matches: number, people: number) =>
    people === 0 ? `${games(matches)} hinzugefügt.` : matches === 0 ? `${players(people)} hinzugefügt.` : `${games(matches)} und ${players(people)} hinzugefügt.`,
  importCompleted: (n: number) => (n === 1 ? "1 früheres Spiel ist jetzt vollständig." : `${n} frühere Spiele sind jetzt vollständig.`),
  importKnown: (n: number) => (n === 1 ? "1 Spiel war schon auf diesem Gerät." : `${n} Spiele waren schon auf diesem Gerät.`),
  importNothing: "Alles aus dieser Datei ist schon auf diesem Gerät.",
  importSkipped: (n: number) => (n === 1 ? "1 Eintrag war unlesbar und wurde übersprungen." : `${n} Einträge waren unlesbar und wurden übersprungen.`),
  importFormatTitle: "Datei passt nicht",
  importFormat: "Diese Datei enthält keine Daten von BlueLine Darts. Wähle eine Datei, die du mit „Daten exportieren“ erstellt hast.",
  importNewerTitle: "Neuere Version nötig",
  importNewer: "Diese Datei stammt aus einer neueren Version der App. Lade die App neu und versuche es noch einmal.",
  importStorageTitle: "Import fehlgeschlagen",
  importStorage: "Die Daten konnten auf diesem Gerät nicht gespeichert werden. Es wurde nichts verändert.",
  wipeTitle: "Alle Daten löschen?",
  wipeDescription:
    "Das löscht auf diesem Gerät alle Spiele, die Rangliste, alle Spieler, die Einstellungen und das laufende Spiel. Das lässt sich nicht rückgängig machen. Exportiere deine Daten vorher, wenn du sie behalten möchtest.",
  wipeConfirm: "Alles löschen",
  wipeFailedTitle: "Nicht alles gelöscht",
  wipeFailed: "Einige Daten konnten nicht gelöscht werden. Lade die App neu und versuche es noch einmal.",
  ok: "OK",

  // A write that failed, shown over the game.
  saveFailed: "Dein Spiel konnte nicht gespeichert werden.",
  saveFailedHint: "Solange die App geöffnet bleibt, geht nichts verloren.",
  saveStillFailing: "Es hat wieder nicht geklappt. Gib auf diesem Gerät Speicherplatz frei und versuche es dann erneut.",
  retry: "Erneut versuchen",
  hide: "Hinweis ausblenden",
  saved: "Dein Spiel ist gespeichert.",

  // Rangliste: results from the earlier version, which kept only names.
  importedTag: "Importiert",
  unnamedTag: "Ohne Namen",
  withImportedTag: "Mit früheren Spielen",
  importedTitle: (name: string) => `Frühere Spiele als ${name}`,
  importedText: (n: number) =>
    n === 1
      ? "Dieses Spiel stammt aus der früheren Version der App. Sie hat nur Namen gespeichert, deshalb ist es noch keinem Spieler zugeordnet."
      : `Diese ${n} Spiele stammen aus der früheren Version der App. Sie hat nur Namen gespeichert, deshalb sind sie noch keinem Spieler zugeordnet.`,
  assignTo: (name: string) => `Zu ${name} zählen`,
  assignChoose: "Mehrere Spieler heißen so. Wähle, zu wem die Spiele gehören.",
  assignHint: "Nur zuordnen, wenn es dieselbe Person ist. Du kannst das später wieder trennen.",
  lastPlayed: (when: string) => `Zuletzt gespielt: ${when}`,
  assignNobody: (name: string, n: number) =>
    `Sobald ${name} auf diesem Gerät ein Spiel beendet hat, kannst du ${n === 1 ? "das Spiel" : "die Spiele"} zuordnen.`,
  mergedTitle: (name: string) => `Frühere Spiele bei ${name}`,
  mergedText: (name: string, n: number) =>
    n === 1 ? `Auch 1 Spiel aus der früheren Version der App zählt für ${name}.` : `Auch ${n} Spiele aus der früheren Version der App zählen für ${name}.`,
  separate: "Wieder trennen",
  assignFailed: "Das hat nicht geklappt. Versuche es noch einmal.",
}
