// The privacy policy, in both languages (German first, as everywhere). Shown at /privacy on the
// website and as a screen of About inside the app (components/privacy-view.tsx). It describes
// what the app actually does; the facts behind it: docs/protocol/privacy.md, lib/nostr/relays.ts,
// lib/profile/delete-profile.ts. Change it with the code it describes, and update `updated`.

export interface PrivacySection {
  heading: string
  paragraphs: string[]
}

export interface PrivacyTexts {
  title: string
  updated: string
  intro: string
  sections: PrivacySection[]
  contact: string
}

const RELAYS = "nos.lol, relay.primal.net, nostr-01.yakihonne.com, nostr.oxtr.dev, purplepag.es"

export const PRIVACY: Record<"de" | "en", PrivacyTexts> = {
  de: {
    title: "Datenschutz",
    updated: "Stand: 6. November 2026",
    intro:
      "BlueLine Darts braucht kein Konto, zeigt keine Werbung und verfolgt dich nicht. Es gibt keinen Server des Entwicklers, der deine Daten bekommt.",
    sections: [
      {
        heading: "Ohne Profil",
        paragraphs: [
          "Spiele, Spieler, Rangliste und Einstellungen bleiben auf deinem Gerät (im Speicher der App bzw. des Browsers). Nichts davon wird gesendet.",
          "Unter Einstellungen › Daten kannst du alles exportieren und alles auf dem Gerät löschen.",
        ],
      },
      {
        heading: "Mit Profil",
        paragraphs: [
          `Ein Profil ist freiwillig. Es wird auf öffentlichen Nostr-Relays gespeichert, die von Dritten betrieben werden (voreingestellt: ${RELAYS}; du kannst sie unter Profil › Erweitert ändern).`,
          "Öffentlich und für jeden lesbar sind: dein Profilname, dein Bild, deine Relay-Liste und, wenn du es unter Sichtbarkeit einschaltest, deine Statistikkarte.",
          "Deine Spiele und Einstellungen werden verschlüsselt gespeichert, damit deine anderen Geräte sie lesen können. Den Inhalt können nur deine Geräte öffnen; sichtbar bleiben dein öffentlicher Schlüssel, Zeitpunkte und die ungefähre Größe.",
          "Wie jeder Server sehen die Relays die IP-Adresse und den Zeitpunkt jeder Verbindung. Für sie gelten die Datenschutzbestimmungen ihrer Betreiber.",
        ],
      },
      {
        heading: "Kamera und Fotos",
        paragraphs: [
          "Die Kamera wird nur geöffnet, wenn du einen Code scannst, etwa beim Koppeln eines Geräts. Das Bild wird auf dem Gerät gelesen und weder gespeichert noch gesendet.",
          "Ein Ergebnisbild landet nur dann in deinen Fotos, wenn du im Teilen-Menü „Bild sichern“ wählst.",
        ],
      },
      {
        heading: "Profil löschen",
        paragraphs: [
          "Unter Profil › Profil löschen wird dein Name und Bild geleert, die Relays werden gebeten, alles zu löschen, was dein Profil veröffentlicht hat (NIP-09), und danach wird alles auf diesem Gerät gelöscht.",
          "Relays, die Löschbitten nicht folgen, und Kopien in anderen Apps kann niemand zwingen. Auf deinen anderen Geräten meldest du dich dort ab.",
        ],
      },
      {
        heading: "Website",
        paragraphs: [
          "Die Website wird bei Netlify gehostet. Netlify verarbeitet beim Aufruf technisch nötige Daten wie die IP-Adresse. Die Website setzt keine Cookies zur Analyse und lädt keine Tracker.",
        ],
      },
      {
        heading: "Kinder",
        paragraphs: ["Die App sammelt wissentlich keine Daten von Kindern. Ohne Profil verlässt nichts das Gerät."],
      },
    ],
    contact: "Fragen zum Datenschutz: über GitHub",
  },
  en: {
    title: "Privacy Policy",
    updated: "Last updated: 6 November 2026",
    intro:
      "BlueLine Darts needs no account, shows no ads and doesn't track you. There is no server of the developer's that receives your data.",
    sections: [
      {
        heading: "Without a profile",
        paragraphs: [
          "Games, players, the leaderboard and settings stay on your device (in the app's or the browser's storage). None of it is sent anywhere.",
          "Settings › Data exports everything and deletes everything on the device.",
        ],
      },
      {
        heading: "With a profile",
        paragraphs: [
          `A profile is optional. It is stored on public Nostr relays run by third parties (by default: ${RELAYS}; you can change them under Profile › Advanced).`,
          "Public and readable by anyone: your profile name, your picture, your relay list and, if you turn it on under Visibility, your stats card.",
          "Your games and settings are stored encrypted, so your other devices can read them. Only your devices can open the content; your public key, the times and the approximate size stay visible.",
          "Like any server, the relays see the IP address and time of each connection. Their operators' privacy policies apply to them.",
        ],
      },
      {
        heading: "Camera and photos",
        paragraphs: [
          "The camera opens only when you scan a code, for example when pairing a device. The picture is read on the device and neither stored nor sent.",
          "A result picture goes to your photos only if you choose Save Image in the share sheet.",
        ],
      },
      {
        heading: "Deleting your profile",
        paragraphs: [
          "Profile › Delete profile clears your name and picture, asks the relays to delete everything your profile has published (NIP-09), and then deletes everything on this device.",
          "Nobody can force relays that ignore deletion requests, or copies kept by other apps. On your other devices, sign out there.",
        ],
      },
      {
        heading: "Website",
        paragraphs: [
          "The website is hosted by Netlify, which processes data technically needed to serve it, such as your IP address. The website uses no analytics cookies and loads no trackers.",
        ],
      },
      {
        heading: "Children",
        paragraphs: ["The app does not knowingly collect data from children. Without a profile, nothing leaves the device."],
      },
    ],
    contact: "Privacy questions: via GitHub",
  },
}
