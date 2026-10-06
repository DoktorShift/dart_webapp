// German texts of the payments area, loaded with its screens (see ../index.ts). The English file
// must have the same shape. Normal views name no protocol (no "NWC", "Zap", "Relay"); technical
// words appear only in `advanced`, the "Erweitert" screen (tests/payments-texts.test.ts).
export const paymentsScreensDe = {
  unit: "sats",
  euro: (amount: string, time: string) => `≈ ${amount} · Kurs von ${time} Uhr`,
  // Choosing an amount: a few to tap, or any other typed in.
  amount: {
    custom: "Anderer Betrag",
    placeholder: "Betrag in sats",
    tooHigh: (max: string) => `Höchstens ${max}.`,
  },
  // The Bitcoin and wallet-connection marks together, where no text next to them says it.
  signet: "Bitcoin-Wallet",
  yourWallet: "Deine Wallet",

  // One plain sentence where money moves (nostrdesign.org, zaps), and "Mehr erfahren".
  explain: {
    screen: "Zahlungen gehen direkt von Wallet zu Wallet. BlueLine bewahrt kein Geld auf und zahlt nie ohne deine Bestätigung.",
    pay: (name: string) => (name ? `Das Geld geht direkt aus deiner Wallet an ${name}. BlueLine bewahrt kein Geld auf.` : "Das Geld geht direkt aus deiner Wallet an die andere Person. BlueLine bewahrt kein Geld auf."),
    receive: "Das Geld kommt direkt in deiner Wallet an. BlueLine bewahrt kein Geld auf.",
  },
  learn: {
    button: "Mehr erfahren",
    title: "So funktionieren Zahlungen",
    facts: [
      {
        title: "Direkt von Wallet zu Wallet",
        text: "Du bezahlst aus deiner eigenen Bitcoin-Wallet, das Geld kommt in der Wallet der anderen Person an. BlueLine bewahrt kein Geld auf und bezahlt nichts ohne deine Bestätigung.",
      },
      {
        title: "Was sind sats?",
        text: "sats sind kleine Bitcoin-Einheiten: 100 Millionen sats sind ein Bitcoin. Verbindlich ist immer der Betrag in sats; der Euro-Betrag ist nur eine Näherung.",
      },
      {
        title: "Öffentlich gratulieren",
        text: "Ein öffentlicher Glückwunsch ist mit Betrag und deinem Profil für alle sichtbar, die das Profil der anderen Person ansehen. Ohne Profil, oder wenn du es ausschaltest, sieht nur die andere Person die Zahlung in ihrer Wallet.",
      },
      {
        title: "Wenn die Bestätigung fehlt",
        text: "Meldet deine Wallet eine Zahlung nicht sofort zurück, zahlt BlueLine nie ein zweites Mal. „Status prüfen“ fragt deine Wallet, ob das Geld angekommen ist. Kann sie es nicht sagen, siehst du selbst in deiner Wallet nach und vermerkst es.",
      },
      {
        title: "Deine Wallet-Verbindung",
        text: "Sie liegt verschlüsselt nur auf diesem Gerät. Du kannst sie hier entfernen; die Freigabe in deiner Wallet widerrufst du dort.",
      },
    ],
  },

  // Profil › Zahlungen
  row: {
    connected: "Wallet verbunden",
    notConnected: "Keine Wallet verbunden",
    unresolved: "Eine Zahlung ist noch nicht bestätigt",
  },
  intro: {
    title: "Direkt zwischen Spielern",
    text: "Verbinde deine Bitcoin-Wallet. Danach kannst du nach dem Spiel bezahlen und Geld empfangen.",
    noWallet: "Ich habe noch keine Wallet",
  },
  help: {
    title: "Noch keine Wallet?",
    text: "Für Zahlungen brauchst du eine Bitcoin-Wallet, die sich mit Apps verbinden lässt. Du erkennst sie am rechten der beiden Zeichen. Du kannst sie jederzeit später verbinden; spielen kannst du ohne.",
    ok: "Verstanden",
  },
  capability: {
    both: "Bezahlen und Empfangen möglich",
    pay: "Bezahlen möglich",
    receive: "Empfangen möglich",
    none: "Weder Bezahlen noch Empfangen freigegeben",
  },
  wallet: {
    pay: "Bezahlen",
    receive: "Empfangen",
    allowed: "Möglich",
    notAllowed: "Nicht freigegeben",
    balance: "Guthaben",
    loading: "Wird geladen",
    unavailable: "Nicht abrufbar",
    limitLeft: "Vom Limit übrig",
    // `left` is a bare number, `total` an amount: "80.000 von 100.000 sats".
    limitOf: (left: string, total: string) => `${left} von ${total}`,
    limitFooter: "Dieses Limit setzt deine Wallet für BlueLine durch.",
    noLimitFooter: "Ein Ausgabenlimit für BlueLine legst du in deiner Wallet fest.",
    cantPay: "Damit BlueLine bezahlen kann, erlaube es in deiner Wallet und verbinde sie neu.",
    cantReceive: "Damit du Geld empfangen kannst, erlaube es BlueLine in deiner Wallet und verbinde sie neu.",
    receiveMoney: "Geld empfangen",
    payInvoice: "Zahlungscode scannen",
    history: "Letzte Zahlungen",
    reconnect: "Neu verbinden",
    remove: "Verbindung entfernen",
    removeTitle: "Verbindung entfernen?",
    removeText: "BlueLine vergisst die Verbindung zu deiner Wallet. Die Freigabe in deiner Wallet bleibt bestehen, bis du sie dort widerrufst.",
    removeConfirm: "Entfernen",
    privacy: "Die Verbindung liegt verschlüsselt nur auf diesem Gerät. Sie ist in keiner Sicherung und keinem Export enthalten. Auf einem anderen Gerät verbindest du deine Wallet neu.",
  },

  // "Wallet verbinden": scan, paste, or open the wallet app on this device.
  connect: {
    intro: "Öffne in deiner Wallet „App verbinden“ und erstelle eine Verbindung für BlueLine. Scanne dann ihren Code oder füge sie unten ein.",
    namesDiffer: "In deiner Wallet kann es anders heißen, etwa „Verbindungen“ oder „Apps“.",
    manualLabel: "Verbindung einfügen",
    manualPlaceholder: "Verbindung aus deiner Wallet",
    openApp: "Wallet-App öffnen",
    openAppHint: "Für Wallets auf diesem Gerät, die das können. Sonst kopiere die Verbindung in deiner Wallet und füge sie oben ein.",
    connecting: "Wallet wird verbunden",
    connected: "Verbunden",
    notWallet: "Das ist keine Wallet-Verbindung. Prüfe, ob sie vollständig ist.",
    isInvoice: "Das ist ein Zahlungscode. Hier brauchst du die Verbindung aus deiner Wallet.",
    // The answer of a wallet app ("Wallet-App öffnen"): looked at before it is kept.
    checking: "Wallet wird geprüft",
    confirmTitle: "Diese Wallet verbinden?",
    confirmText: "Deine Wallet-App hat diese Verbindung für BlueLine erstellt. Prüfe Name und Rechte, bevor du sie verbindest.",
    replaces: (name: string) => (name ? `Sie ersetzt die verbundene Wallet „${name}“.` : "Sie ersetzt deine verbundene Wallet."),
    confirm: "Verbinden",
    unrequested: "Diese Verbindung kam nicht als Antwort auf „Wallet-App öffnen“ auf diesem Gerät. BlueLine hat sie nicht übernommen.",
  },

  // How a payment stands; never by colour alone.
  state: {
    sending: "Zahlung läuft",
    paid: "Bezahlt",
    failed: "Fehlgeschlagen",
    unknown: "Noch nicht bestätigt",
    waiting: "Warte auf Zahlung",
    received: "Erhalten",
    expired: "Abgelaufen",
    settledHere: "Vor Ort erledigt",
    receiptPending: "Bezahlt · Beleg wird noch geladen",
    receiptConfirmed: "Glückwunsch bestätigt",
    // Settled by the person from what their wallet shows.
    paidByHand: "Als bezahlt vermerkt",
    notPaidByHand: "Als nicht bezahlt vermerkt",
    receivedByHand: "Als erhalten vermerkt",
    notReceivedByHand: "Als nicht erhalten vermerkt",
  },
  to: (name: string) => `An ${name}`,
  from: (name: string) => `Von ${name}`,

  // Why the wallet couldn't do it.
  problem: {
    invalid: "Das ist keine gültige Wallet-Verbindung. Kopiere sie in deiner Wallet noch einmal.",
    unreachable: "Deine Wallet ist gerade nicht erreichbar. Prüfe die Internetverbindung.",
    "no-answer": "Deine Wallet antwortet gerade nicht. Öffne sie und versuche es erneut.",
    insufficient: "In deiner Wallet ist nicht genug Guthaben. Lade sie auf und versuche es erneut.",
    quota: "Dein Ausgabenlimit für BlueLine ist erreicht. Du kannst es in deiner Wallet ändern.",
    restricted: "Deine Wallet erlaubt BlueLine das nicht. Gib es in deiner Wallet frei und verbinde sie neu.",
    unsupported: "Deine Wallet kann das nicht. Dafür brauchst du eine andere Wallet.",
    "not-found": "Deine Wallet kennt diese Zahlung nicht. Sieh in deiner Wallet nach.",
    "rate-limited": "Deine Wallet bittet um eine kurze Pause. Versuche es gleich noch einmal.",
    failed: "Deine Wallet konnte die Zahlung nicht ausführen. Versuche es erneut.",
    expired: "Der Zahlungscode ist abgelaufen, bevor bezahlt wurde. Lass dir einen neuen zeigen.",
  },
  // Why a scanned payment code or a receiving address can't be paid.
  invoice: {
    invalid: "Das ist kein Zahlungscode. Lass dir den Code aus „Geld empfangen“ zeigen.",
    amount: (amount: string) => `Dieser Zahlungscode ist nicht über ${amount}. Lass dir den richtigen zeigen.`,
    expired: "Dieser Zahlungscode ist abgelaufen. Lass dir einen neuen zeigen.",
    description: "Die Empfangsadresse hat einen unpassenden Code geschickt. Es wurde nichts bezahlt. Scanne stattdessen einen Zahlungscode.",
    "no-amount": "Dieser Zahlungscode nennt keinen Betrag. Lass dir einen mit Betrag zeigen.",
    isWallet: "Das ist deine Wallet-Verbindung, kein Zahlungscode. Zeig sie niemandem und scanne den Code der anderen Person.",
    addressUnreachable: (address: string) => `${address} ist gerade nicht erreichbar. Scanne stattdessen einen Zahlungscode.`,
    addressAmount: (address: string) => `${address} nimmt diesen Betrag nicht an. Scanne stattdessen einen Zahlungscode.`,
  },

  // Paying someone, from the review to the outcome.
  pay: {
    findRecipient: "Empfangsadresse wird gesucht",
    noAddress: (name: string) => `${name} hat im Profil keine Empfangsadresse.`,
    profilePartial: (name: string) => `Das Profil von ${name} war nicht vollständig erreichbar.`,
    // `name` is empty for an invoice paid from Zahlungen, whose recipient the app doesn't know.
    scanIntro: (name: string) => (name ? `Bitte ${name}, „Geld empfangen“ zu öffnen, und scanne den Zahlungscode.` : "Scanne den Zahlungscode oder füge ihn ein."),
    scanManual: "Zahlungscode einfügen",
    scanPlaceholder: "Zahlungscode",
    scanInstead: "Stattdessen Zahlungscode scannen",
    toAddress: (address: string) => `über ${address}`,
    fromWallet: "Aus",
    fees: "Gebühren",
    feesUnknown: "Je nach Wallet",
    confirm: (amount: string, name: string) => (name ? `${amount} an ${name} zahlen` : `${amount} zahlen`),
    // Until the wallet has the payment: the code is asked for (receiving address) or the wallet opened.
    requesting: "Zahlungscode wird angefragt",
    preparing: "Zahlung wird vorbereitet",
    nothingYet: "Noch wurde nichts bezahlt.",
    sending: "Zahlung läuft",
    sendingText: "Deine Wallet bezahlt. Meist dauert das nur Sekunden.",
    paidText: (amount: string, name: string) => (name ? `${amount} sind bei ${name} angekommen.` : `${amount} sind angekommen.`),
    feesPaid: (amount: string) => `Gebühren: ${amount}`,
    // Paid in another window while this one showed the review (a payment that may be repeated).
    paidMeanwhile: "Diese Zahlung wurde gerade in einem anderen Fenster von BlueLine gemacht.",
    payAgain: "Noch einmal zahlen",
    unknownTitle: "Zahlung noch nicht bestätigt",
    unknownText: (amount: string, name: string) => `Die ${amount} könnten schon ${name ? `bei ${name} ` : ""}angekommen sein. Bitte zahle nicht noch einmal.`,
    check: "Status prüfen",
    checking: "Wird geprüft",
    stillUnknown: "Noch keine Bestätigung. Prüfe es später noch einmal oder sieh in deiner Wallet nach.",
    noLookup: "Deine Wallet kann den Status nicht melden. Sieh in deiner Wallet nach, ob die Zahlung durchging.",
    otherWallet: "Diese Zahlung lief über eine andere Wallet-Verbindung. Ob sie durchging, zeigt die Wallet, mit der bezahlt wurde.",
    failedTitle: "Zahlung fehlgeschlagen",
    nothingPaid: "Es wurde nichts bezahlt.",
    retry: "Erneut versuchen",
    busy: "Diese Zahlung läuft gerade in einem anderen Fenster von BlueLine.",
    invoice: "Zahlung",
  },

  // "In deiner Wallet nachgesehen": settling an outcome the wallet can't report, from what it shows.
  byHand: {
    title: "In deiner Wallet nachgesehen?",
    note: "Vermerkt nach dem, was deine Wallet zeigt. BlueLine hat es nicht selbst geprüft.",
    confirm: "Vermerken",
    outgoing: {
      done: "Zahlung ist durchgegangen",
      notDone: "Zahlung ist nicht durchgegangen",
      doneTitle: "Als bezahlt vermerken?",
      doneText: (amount: string, name: string) => `Nur wenn deine Wallet zeigt, dass ${amount}${name ? ` an ${name}` : ""} bezahlt sind.`,
      notDoneTitle: "Als nicht bezahlt vermerken?",
      notDoneText: "Nur wenn deine Wallet keine Zahlung zeigt. Danach kann neu bezahlt werden; ging die Zahlung doch durch, wäre doppelt bezahlt.",
      notYet: (time: string) => `Sobald der Zahlungscode abgelaufen ist (${time}), kannst du auch vermerken, dass nichts bezahlt wurde.`,
    },
    incoming: {
      done: "Zahlung ist angekommen",
      notDone: "Zahlung ist nicht angekommen",
      doneTitle: "Als erhalten vermerken?",
      doneText: (amount: string) => `Nur wenn deine Wallet zeigt, dass ${amount} angekommen sind.`,
      notDoneTitle: "Als nicht erhalten vermerken?",
      notDoneText: "Nur wenn deine Wallet keine Zahlung zeigt. Danach kannst du einen neuen Zahlungscode erstellen.",
      notYet: (time: string) => `Sobald der Zahlungscode abgelaufen ist (${time}), kannst du auch vermerken, dass nichts ankam.`,
    },
  },

  // Showing an invoice to be paid.
  receive: {
    title: "Geld empfangen",
    amount: "Betrag",
    create: "Zahlungscode erstellen",
    creating: "Zahlungscode wird erstellt",
    show: (name: string) => `Lass ${name} diesen Code mit der eigenen Wallet scannen.`,
    showAnyone: "Lass diesen Code mit einer Wallet scannen.",
    qrLabel: (amount: string) => `Zahlungscode über ${amount}`,
    keepOpen: "Lass BlueLine geöffnet, bis die Zahlung da ist.",
    copy: "Code kopieren",
    receivedText: (amount: string) => `${amount} sind in deiner Wallet angekommen.`,
    expiredText: "Bis zum Ablauf des Codes kam keine Zahlung an.",
    expiredUnchecked: "Der Code ist abgelaufen. Ob vorher eine Zahlung ankam, siehst du in deiner Wallet.",
    again: "Neuer Zahlungscode",
    offline: "Deine Wallet ist gerade nicht erreichbar. Öffne sie und versuche es erneut; für einen neuen Zahlungscode muss sie online sein.",
    noStatus: "Deine Wallet meldet Zahlungseingänge nicht an BlueLine. Sieh in deiner Wallet nach, ob die Zahlung da ist.",
    otherWallet: "Diesen Code hat eine andere Wallet-Verbindung erstellt. Ob die Zahlung ankam, zeigt die Wallet, die ihn erstellt hat.",
  },

  // The stake: setting it in setup (the row's own texts are in payments.de.ts), and after the game.
  stake: {
    sheetText: "Der Verlierer zahlt dem Sieger nach dem Spiel diesen Betrag, direkt von Wallet zu Wallet. Nichts wird automatisch bezahlt.",
    apply: "Übernehmen",
    remove: "Kein Einsatz",
    agreed: (payer: string, amount: string, payee: string) => `${payer} zahlt ${amount} an ${payee}, wie vor dem Spiel vereinbart.`,
    payTo: (amount: string, name: string) => `${amount} an ${name} zahlen`,
    receiveFrom: (amount: string, name: string) => `${amount} von ${name} empfangen`,
    receiveHere: (name: string) => `Ich bin ${name}: hier empfangen`,
    settledHere: "Vor Ort erledigt",
    settledHereHint: "Wenn ihr den Einsatz anders beglichen habt, zum Beispiel bar.",
    paidRow: (amount: string, name: string) => `${amount} an ${name} bezahlt`,
    receivedRow: (amount: string, name: string) => `${amount} von ${name} erhalten`,
    settledRow: "Einsatz vor Ort erledigt",
    unknownRow: "Einsatz: Zahlung noch nicht bestätigt",
    waitingRow: "Einsatz: Warte auf Zahlung",
  },

  // Paying without a stake, from a result.
  free: {
    button: "Bezahlen oder empfangen",
    title: "Zahlung",
    payTo: (name: string) => `An ${name} zahlen`,
  },

  // "Gratulieren": a voluntary payment, public when the person chooses so.
  congratulate: {
    button: "Gratulieren",
    title: (name: string) => `${name} gratulieren`,
    amount: "Betrag",
    message: "Nachricht",
    messagePlaceholder: "Stark gespielt!",
    public: "Öffentlich gratulieren",
    publicHint: (name: string) => `Das Geld geht direkt an ${name}. Dein Glückwunsch ist öffentlich: Wer das Profil von ${name} ansieht, sieht ihn mit Betrag und deinem Profil.`,
    privateHint: (name: string) => `Das Geld geht direkt an ${name}. Nur ${name} sieht die Zahlung in der eigenen Wallet. BlueLine bewahrt kein Geld auf.`,
    send: (amount: string, name: string) => `${amount} an ${name} senden`,
    noAddress: (name: string) => `${name} hat gerade keine Empfangsadresse. Bitte ${name}, dir den Zahlungscode aus „Geld empfangen“ zu zeigen.`,
    notSigned: "Dein Profil hat den Glückwunsch nicht bestätigt. Es wurde nichts bezahlt. Versuche es erneut.",
  },

  // "Erweitert": the technical details, for those who want them.
  advanced: {
    protocol: "Verfahren",
    protocolValue: "Nostr Wallet Connect (NIP-47)",
    encryption: "Verschlüsselung",
    relays: "Relays der Wallet",
    methods: "Erlaubte Befehle",
    notifications: "Benachrichtigungen",
    none: "Keine",
    lightningAddress: "Lightning-Adresse der Wallet",
    connectedAt: "Verbunden seit",
    footer: "Die Verbindungsdaten (nostr+walletconnect) liegen nur verschlüsselt auf diesem Gerät. Zahlungen laufen ausschließlich über die Relays der Wallet.",
  },
}
