// German texts of the friends area (components/friends). English mirror: friends.screens.en.ts.
export const friendsScreensDe = {
  title: "Freunde",
  unnamed: "Ohne Namen",

  // The row in the Profile tab.
  row: {
    title: "Freunde",
    requests: (n: number) => (n === 1 ? "1 Anfrage" : `${n} Anfragen`),
  },

  // The list: requests to answer, friends, requests on their way.
  sections: { requests: "Anfragen", friends: "Freunde", sent: "Gesendet" },
  wantsToBe: "Möchte mit dir befreundet sein",
  requestSent: "Anfrage gesendet",
  since: (date: string) => `Freunde seit ${date}`,
  accept: "Annehmen",
  acceptFor: (name: string) => `${name} annehmen`,
  accepting: "Wird angenommen",
  decline: "Ablehnen",
  empty: {
    title: "Noch keine Freunde",
    text: "Freunde sind beim Spielen mit einem Tipp dabei und sehen in der Rangliste ihre Zahlen nebeneinander. Nur ihr beide wisst, dass ihr befreundet seid.",
  },
  unavailable: "Freunde gibt es, sobald dieses Gerät dein Profil einmal abgeglichen hat. Das passiert von allein, wenn eine Verbindung besteht.",
  signerApp: "Mit einer Signer-App kommen Anfragen und Antworten anderer nicht von allein an. Was du hier änderst, gilt trotzdem. Auf einem Gerät, auf dem dein Profil ohne Signer-App angemeldet ist, siehst du alles.",
  offline: "Keine Verbindung. Die Liste zeigt den letzten Stand.",

  // Adding someone.
  add: "Freund hinzufügen",
  addTitle: "Freund hinzufügen",
  addText: "Wähle, mit wem du zuletzt gespielt hast, oder scanne den Profilcode. Die Person bekommt deine Anfrage und entscheidet.",
  scan: "Profilcode scannen",
  scanManual: "Link oder Code einfügen",
  myCode: "Meinen Code zeigen",
  recent: "Zuletzt gespielt mit",
  noRecent: "Noch niemand mit Profil dabei. Spiel mit jemandem oder scanne den Profilcode.",
  scanned: "Gescannt",
  send: "Hinzufügen",
  sendFor: (name: string) => `${name} hinzufügen`,
  sending: (name: string) => `Anfrage an ${name} wird gesendet`,
  notProfile: "Das ist kein Profilcode.",
  isYou: "Das ist dein eigenes Profil.",
  already: (name: string) => `${name} steht schon in deiner Liste.`,
  sentTo: (name: string) => `Anfrage an ${name} gesendet.`,
  queued: (name: string) => `Die Anfrage an ${name} geht raus, sobald eine Verbindung besteht.`,
  back: "Zurück",

  // On a person's profile.
  addFriend: "Als Freund hinzufügen",
  friend: "Befreundet",
  acceptRequest: "Anfrage annehmen",
  declineRequest: "Anfrage ablehnen",
  withdraw: "Anfrage zurückziehen",
  remove: "Freund entfernen",
  removeTitle: (name: string) => `${name} als Freund entfernen?`,
  removeText: "Ihr seht euch nicht mehr in euren Freundeslisten. Eure gemeinsamen Spiele bleiben.",
  removeConfirm: "Entfernen",
  withdrawTitle: "Anfrage zurückziehen?",
  withdrawText: "Die Person sieht deine Anfrage dann nicht mehr.",
  withdrawConfirm: "Zurückziehen",

  // Game setup and invitations: friends first.
  setup: { group: "Freunde" },
  invite: { group: "Freunde" },

  // The Rangliste's friends area.
  ranks: {
    scope: (n: number) => `Du und deine Freunde mit den Zahlen, die jeder unter Sichtbarkeit freigibt: X01 gegen andere, in der Wertung ab ${n} Spielen.`,
    offline: "Keine Verbindung. Die Zahlen zeigen den letzten Stand.",
    notLoaded: "Noch nicht geladen",
    silent: "Ohne Zahlen",
    noCard: "Zeigt keine Zahlen",
    youNoCard: "Du zeigst keine Zahlen",
    openVisibility: "Sichtbarkeit öffnen",
    loading: "Zahlen werden geladen",
    emptyTitle: "Noch keine Freunde",
    emptyText: "Hier stehen deine Freunde mit den Zahlen, die jeder von sich zeigt.",
    emptyAction: "Freund hinzufügen",
    guestTitle: "Freunde brauchen ein Profil",
    guestText: "Mit einem Profil fügst du Freunde hinzu, und ihr seht eure Zahlen nebeneinander.",
    guestAction: "Zum Profil",
  },

  // What went wrong with a change.
  problems: {
    "no-key": "Dieses Gerät hat dein Profil noch nicht abgeglichen. Versuch es gleich noch einmal.",
    offline: "Keine Verbindung. Versuch es, sobald du wieder online bist.",
    clock: "Die Uhr dieses Geräts geht nach. Stell sie richtig und versuch es noch einmal.",
    signer: "Deine Signer-App hat nicht unterschrieben.",
    switched: "Das Profil hat gewechselt. Öffne die Liste noch einmal.",
    refused: "Die Änderung wurde nicht angenommen. Versuch es später noch einmal.",
    full: "Deine Liste ist voll. Entferne jemanden, bevor du jemanden hinzufügst.",
    unknown: "Das hat nicht geklappt. Versuch es noch einmal.",
  },
}
