import type { Messages } from "../index"

// English texts for the data area. Same shape as data.de.ts.

const games = (n: number) => (n === 1 ? "1 game" : `${n} games`)
const players = (n: number) => (n === 1 ? "1 player" : `${n} players`)

export const dataEn: Messages["data"] = {
  title: "Data",
  footer: "Export saves every game and player on this device to a file, so you can keep a copy and import it on another device.",
  unavailableFooter: "In this browser, the details of finished games last only while the app is open. Export your data to keep them.",
  export: "Export data",
  import: "Import data",
  wipe: "Delete all data on this device",
  fileName: "blueline-data",
  exportFailedTitle: "Couldn’t export",
  exportFailed: "Your data couldn’t be read just now. Please try again.",
  importDoneTitle: "Import complete",
  importNothingTitle: "Nothing new",
  importAdded: (matches, people) =>
    people === 0 ? `Added ${games(matches)}.` : matches === 0 ? `Added ${players(people)}.` : `Added ${games(matches)} and ${players(people)}.`,
  importCompleted: (n) => (n === 1 ? "1 earlier game is now complete." : `${n} earlier games are now complete.`),
  importKnown: (n) => (n === 1 ? "1 game was already on this device." : `${n} games were already on this device.`),
  importNothing: "Everything in this file is already on this device.",
  importSkipped: (n) => (n === 1 ? "1 entry couldn’t be read and was skipped." : `${n} entries couldn’t be read and were skipped.`),
  importFormatTitle: "Wrong file",
  importFormat: "This file doesn’t contain BlueLine Darts data. Choose a file you made with “Export data”.",
  importNewerTitle: "Newer version needed",
  importNewer: "This file comes from a newer version of the app. Reload the app and try again.",
  importStorageTitle: "Couldn’t import",
  importStorage: "The data couldn’t be saved on this device. Nothing was changed.",
  wipeTitle: "Delete all data?",
  wipeDescription:
    "This deletes every game, the leaderboard, all players, your settings and the game in progress on this device. This can’t be undone. Export your data first if you want to keep it.",
  wipeConfirm: "Delete everything",
  wipeFailedTitle: "Not everything was deleted",
  wipeFailed: "Some data couldn’t be deleted. Reload the app and try again.",
  ok: "OK",

  saveFailed: "Your game couldn’t be saved.",
  saveFailedHint: "Nothing is lost while the app stays open.",
  saveStillFailing: "That didn’t work either. Free up some storage on this device, then try again.",
  retry: "Try again",
  hide: "Hide message",
  saved: "Your game is saved.",

  importedTag: "Imported",
  unnamedTag: "No name",
  withImportedTag: "With earlier games",
  importedTitle: (name) => `Earlier games as ${name}`,
  importedText: (n) =>
    n === 1
      ? "This game comes from the earlier version of the app. It saved only names, so the game isn’t assigned to a player yet."
      : `These ${n} games come from the earlier version of the app. It saved only names, so they aren’t assigned to a player yet.`,
  assignTo: (name) => `Count for ${name}`,
  assignChoose: "More than one player has this name. Choose who the games belong to.",
  assignHint: "Only if it’s the same person. You can separate them again later.",
  lastPlayed: (when) => `Last played: ${when}`,
  assignNobody: (name, n) => `Once ${name} finishes a game on this device, you can assign ${n === 1 ? "this game" : "these games"}.`,
  mergedTitle: (name) => `Earlier games for ${name}`,
  mergedText: (name, n) =>
    n === 1 ? `1 game from the earlier version of the app also counts for ${name}.` : `${n} games from the earlier version of the app also count for ${name}.`,
  separate: "Separate again",
  assignFailed: "That didn’t work. Please try again.",
}
