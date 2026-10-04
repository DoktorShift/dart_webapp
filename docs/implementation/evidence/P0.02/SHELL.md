# P0.02 App-Rahmen und Navigation: Nachweise

Stand: 4. Oktober 2026 · Branch `wave1/shell` · Basis `fd4e6c5` (`nostr-expansion`) · Aufgabe [P0.02](../../tasks/P0.02.md)

Alle Prüfungen liefen gegen einen Produktionsbuild dieses Branches (`npm run build`, `npx next start -p 3203`) in Chromium aus Playwright 1.63 mit emulierten Größen. Das sind Browserprüfungen, keine Tests auf echten Telefonen oder mit Spielern.

## Was gebaut ist

| Teil | Dateien | Kurz |
| --- | --- | --- |
| Tabs | `components/app-shell.tsx`, `app/page.tsx` | Spielen, Rangliste, Clubs, Turniere, Profil. Tab-Leiste unten bis 1023 px Breite, Seitenleiste ab 1024 px; in Einrichtung und Spiel ausgeblendet. Tabs werden beim ersten Öffnen aufgebaut und bleiben danach erhalten. Erneutes Tippen auf den offenen Tab: zur Wurzel, an der Wurzel nach oben. |
| Navigationsstapel | `lib/shell/nav.ts`, `components/nav/stack-view.tsx`, `screen-frame.tsx`, `nav-header.tsx` | Je Tab ein Stapel. Push/Pop mit der Schiebeanimation der App (0,32 s), bei „Bewegung reduzieren“ Überblendung (0,15 s). Großer Titel, der beim Scrollen in die Leiste wandert. Zurück-Taste mit dem Titel des vorherigen Bildschirms, sonst „Zurück“, sonst nur Pfeil; VoiceOver hört immer „Zurück zu …“. Scrollposition und Eingaben je Bildschirm bleiben erhalten; Fokus folgt der Navigation. |
| Browser-Zurück | `components/nav/use-history-sync.ts` | Ein History-Eintrag je gepushtem Bildschirm und für die Einrichtung, ohne URL-Änderung. Das Spiel hat keinen eigenen Eintrag. |
| App-Links | `lib/shell/links.ts` | `/#p=`, `/#watch=`, `/#club=`, `/#tournament=`, `/#pair=`, `/#board=`, `/#signer-return…`; Nutzlast unverändert und undurchsichtig, höchstens 4096 Zeichen, keine Leer- oder Steuerzeichen. Beim Einfügen oder Scannen zählen nur Adressen dieser App und nur ihre Startseite. |
| Registry | `lib/shell/registry.ts`, `components/shell/extensions.ts`, `components/shell/builtin-screens.tsx` | Bildschirme, Aktionen, Link-Handler und Slots (`profile.root`, `profile.tabIcon`, `clubs.root`, `tournaments.root`). Jeder Bildschirm, auf den der Rahmen schon verweist, hat einen Platzhalter mit richtigem Titel; ein Bereich ersetzt ihn mit derselben ID. |
| Profil als Gast | `components/shell/guest-profile.tsx`, `tab-roots.tsx` | Erzeugtes Bild, „Gast“, Spiele und meiste Siege aus der Spielhistorie dieses Geräts, ruhige Karte „Profil anlegen“, Sheet „Ich habe schon ein Profil“ mit drei Wegen, Einstellungen, „Über die App“. |
| Einstellungen, Über | `components/shell/settings-entry.tsx`, `about-screen.tsx` | Die vorhandenen Ansichten als Bildschirme des Profil-Tabs; die Installationsanleitung öffnet als Sheet in den Einstellungen. Die Seite `/about` bleibt unverändert erreichbar. |
| Clubs, Turniere | `components/shell/tab-roots.tsx`, `open-link-screen.tsx` | Leerzustand mit „Club gründen“ / „Turnier erstellen“ und „Einladung öffnen“ (Scanner mit Einfügefeld, nimmt nur Einladungen der passenden Art). |
| Bausteine | `components/ui/list-row.tsx`, `empty-state.tsx`, `avatar.tsx`, `components/common/*`, `lib/shell/share.ts`, `lib/shell/avatar.ts` | Zeilen (Navigation, Wert, Symbol, zerstörend), Leerzustand, Avatar, QR-Code, Scanner, Teilen, Statusmeldung im Ablauf. |
| Kamera | `next.config.mjs` | `Permissions-Policy: camera=(self), microphone=(), geolocation=()` |

Der Code der Bildschirme außerhalb von Spielen und Rangliste (Profil, Einstellungen, Über, Scanner, QR-Erzeuger, QR-Leser) lädt erst bei Bedarf. Profil, Einstellungen und Über werden im Leerlauf auf den Tabs vorgeladen, damit sie offline funktionieren wie früher der Einstellungen-Tab.

## Anschluss für die Bereiche

Ein Bereich fügt in `components/shell/extensions.ts` eine Importzeile für ein kleines Modul hinzu, das beim Laden die Registry aufruft. Echte Bildschirme laden mit `lazyScreen()` erst bei Bedarf, damit der Gastweg ihren Code (und nostr-core) nie lädt.

```ts
// components/clubs/register.ts
import { lazyScreen } from "@/components/nav/lazy-screen"
import { SCREENS, registerLinkHandler, registerScreen, registerSlot } from "@/lib/shell/registry"

registerScreen(SCREENS.clubCreate, { title: (t) => t.clubs.createTitle, Component: lazyScreen(() => import("./create-screen")) })
registerLinkHandler("club", (link, nav, source) => …)   // sonst: Bildschirm "club.invite" mit params.payload
registerSlot("clubs.root", ClubListOrEmpty)              // bekommt den Leerzustand des Rahmens als `fallback`
```

| Erweiterungspunkt | IDs |
| --- | --- |
| Bildschirme mit Platzhalter | `profile.create`, `profile.fromDevice`, `profile.fromBackup`, `profile.fromApp`, `profile.public`, `devices.pair`, `club.create`, `club.invite`, `tournament.create`, `tournament.view`, `live.watch`, `live.board`; dazu `club.openInvite`, `tournament.openInvite` (Scanner), `settings`, `about` |
| Aktionen (Tasten des Rahmens) | `profile.create`, `profile.fromDevice`, `profile.fromBackup`, `profile.fromApp`, `club.create`, `club.openInvite`, `tournament.create`, `tournament.openInvite`; ohne Handler wird der gleichnamige Bildschirm in seinem Tab gepusht |
| Links ohne Handler | `p` → Profil/`profile.public`, `watch` → Spielen/`live.watch`, `club` → Clubs/`club.invite`, `tournament` → Turniere/`tournament.view`, `pair` → Profil/`devices.pair`, `board` → Spielen/`live.board`, `signer-return` → verworfen |
| Slots | `profile.root` (angemeldetes Profil), `profile.tabIcon` (eigenes Bild im Tab), `clubs.root`, `tournaments.root` |
| Navigation in Bildschirmen | `useNav()`: `push`, `replaceTop`, `pop`, `popToRoot`, `selectTab`, `openSetup` |
| Bausteine | `ListRow`, `RowIcon`, `EmptyState`, `Avatar`, `QRCodeView`, `QRScanner`, `ShareActions`, `InlineStatus`, `shareLink`, `buildLink`, `parseAppLink` |

## Abläufe im Produktionsbuild

Skript: [scripts/shell-flows.mjs](scripts/shell-flows.mjs); Fake-Kamera-Videos mit QR-Code aus [scripts/make-qr-video.mjs](scripts/make-qr-video.mjs). Keine echte Kamera, kein Netzwerk außer dem lokalen Server.

**74 von 74 Prüfungen bestanden** auf dem Endstand dieser Lieferung (Protokoll: [flows-result.txt](flows-result.txt)). Geprüft wird:

| Bereich | Prüfungen |
| --- | --- |
| Tabs und Stapel | fünf Tabs, Spielen offen; Gastkopf und Zahlen aus der Historie (14 Spiele, meiste Siege 9, Lena); Push von Einstellungen mit „Zurück zu Profil“; ein Verlaufseintrag je Push; Zurück-Taste und Browser-Zurück poppen; „Über die App“ im Profil-Tab; Tabwechsel ohne Verlaufseintrag; Stapel und Scrollposition je Tab bleiben erhalten (auch die Rangliste); erneutes Tippen auf den offenen Tab führt zur Wurzel; keine Konsolenfehler |
| App-Links | `/#club=` beim Start öffnet Clubs → „Einladung“ mit „Diesen Link kann diese Version noch nicht öffnen.“ und verschwindet aus der Adresse; Browser-Zurück führt zur Wurzel; `#tournament=` bei geöffneter App (hashchange) und zurück; `#foo=bar` wird ignoriert; `#signer-return=` ohne wartenden Ablauf wird aus der Adresse entfernt |
| Einrichtung und Spiel | Einrichtung ohne Tab-Leiste, mit einem Verlaufseintrag, Browser-Zurück zurück zu Spielen; Spiel ohne Tab-Leiste und ohne eigenen Verlaufseintrag, scrollt nicht; ein Link während des Spiels öffnet sich, das Spiel wartet auf Spielen unter „Weiterspielen“ mit allen Würfen |
| Einladung einfügen | Scanner-Bildschirm mit Einfügefeld; fremde Domain „kein BlueLine-Link“; Turnierlink im Club-Scanner „keine Club-Einladung“; Club-Link ersetzt den Scanner (Zurück führt zu Clubs) |
| Scanner ohne Kamera | verweigert, keine Kamera, belegt: je eigener Text, Einfügefeld bleibt |
| Scanner mit Fake-Kamera | echte QR-Erkennung mit BarcodeDetector und mit jsQR (BarcodeDetector entfernt): Club-Einladung öffnet sich; fremder Code wird abgelehnt; Kamera an beim Scannen, aus in einem anderen Tab, wieder an bei Rückkehr, aus nach Zurück |
| Offline | nach einem Besuch mit Service Worker: Profil, Einstellungen und „Über die App“ öffnen ohne Verbindung, ohne Seitenfehler |
| Sonstiges | `Permissions-Policy: camera=(self), microphone=(), geolocation=()`; Bewegung reduziert: Push überblendet statt zu schieben; englische Tab-Leiste und englisches Sheet; Sheet-Auswahl öffnet ihren Bildschirm im Profil-Tab |

## Bildmatrix

Skript: [scripts/shell-screens.mjs](scripts/shell-screens.mjs). Vierzehn Ansichten (Spielen, Rangliste, Clubs, Turniere, Profil, Profil gescrollt, Sheet „Ich habe schon ein Profil“, Einstellungen, Über die App, Club gründen, Einladung öffnen, Kamera verweigert, Einladungslink und der unveränderte Spielbildschirm) in Deutsch und Englisch, hell und dunkel, auf 320 × 548, 390 × 844, 768 × 1024, 1024 × 768 und 1440 × 900. Jedes Bild prüft das Skript zusätzlich auf horizontales Scrollen, Elemente außerhalb des Bildschirms, Kürzung mit „…“, Text, der aus seiner Taste läuft, und Berührungsflächen unter 44 × 44 pt.

| Lauf | Bilder | Befunde |
| --- | --- | --- |
| 14 Ansichten × DE/EN × hell/dunkel × 5 Größen | 280 | **0** ([matrix-report.json](matrix-report.json)) |
| 8 Ansichten × DE/EN × hell/dunkel × 568 × 320 und 844 × 390 (quer) | 64 | 2, beide im unveränderten Spielbildschirm: „Rückgängig“ läuft auf 568 × 320 auf Deutsch an den Rand seiner Taste. Im Ausgangsstand `fd4e6c5` identisch nachgemessen; nicht behoben, weil diese Lieferung den Spielbildschirm nicht ändert ([matrix-landscape-report.json](matrix-landscape-report.json)) |
| Bausteine (gallery/page.tsx, vorübergehend als `/dev-gallery`), hell/dunkel × 320, 390, 1440 | 6 | 0 (nichts außerhalb des Bildschirms, keine Kürzung, keine Seitenfehler); die Route ist wieder entfernt |

Die Läufe liefen auf dem Build vor der letzten Änderung, die nur den Zeitpunkt des Vorladens in `app/page.tsx` betrifft (keine sichtbare Wirkung). Auf dem Endstand wurden Spielen, Profil, Einstellungen und Spiel in DE/EN auf 320 × 548 und 390 × 844 erneut aufgenommen: 16 Bilder, 0 Befunde. Hinweis zur Prüfung der Berührungsflächen: Ein Schalter in einer `SwitchRow` zählt mit seiner ganzen Zeile, weil die Zeile ihn bedient; die Tab-Leiste im Querformat ist jetzt 44 statt 40 px hoch.

Eine Auswahl liegt in [screens/](screens/); die übrigen Bilder lassen sich mit dem Skript jederzeit neu erzeugen. Die ausgewählten Bilder wurden angesehen, nicht nur erzeugt.

| Bild | Zeigt |
| --- | --- |
| [play-de-light-iphone](screens/play-de-light-iphone.jpg), [play-de-light-iphone-landscape](screens/play-de-light-iphone-landscape.jpg) | Spielen unverändert, Tab-Leiste mit fünf Tabs (hoch, quer) |
| [game-de-light-se](screens/game-de-light-se.jpg), [game-en-dark-ipad-landscape](screens/game-en-dark-ipad-landscape.jpg), [game-de-light-se-landscape](screens/game-de-light-se-landscape.jpg) | Spielbildschirm unverändert (quer: Bestandsbefund „Rückgängig“) |
| [leaderboard-en-light-iphone](screens/leaderboard-en-light-iphone.jpg) | Rangliste unverändert im Tab |
| [profile-de-light-iphone](screens/profile-de-light-iphone.jpg), [profile-de-dark-se](screens/profile-de-dark-se.jpg), [profile-en-light-desktop](screens/profile-en-light-desktop.jpg) | Profil als Gast, Seitenleiste auf dem Desktop |
| [profile-scrolled-en-dark-iphone](screens/profile-scrolled-en-dark-iphone.jpg) | großer Titel in der Leiste nach dem Scrollen |
| [profile-sheet-de-light-se](screens/profile-sheet-de-light-se.jpg), [profile-sheet-en-dark-ipad-landscape](screens/profile-sheet-en-dark-ipad-landscape.jpg), [profile-sheet-en-dark-se-landscape](screens/profile-sheet-en-dark-se-landscape.jpg) | Sheet „Ich habe schon ein Profil“, auch auf flachem Bildschirm mit eigenem Scrollbereich |
| [settings-de-light-iphone](screens/settings-de-light-iphone.jpg), [settings-en-dark-ipad-landscape](screens/settings-en-dark-ipad-landscape.jpg) | Einstellungen im Profil-Tab mit „‹ Profil“ |
| [about-de-dark-iphone](screens/about-de-dark-iphone.jpg) | Über die App im Profil-Tab |
| [clubs-de-light-se](screens/clubs-de-light-se.jpg), [clubs-en-dark-desktop](screens/clubs-en-dark-desktop.jpg), [clubs-de-dark-se-landscape](screens/clubs-de-dark-se-landscape.jpg) | Clubs, Leerzustand |
| [tournaments-de-dark-iphone](screens/tournaments-de-dark-iphone.jpg), [tournaments-en-light-ipad](screens/tournaments-en-light-ipad.jpg) | Turniere, Leerzustand |
| [club-create-de-light-ipad](screens/club-create-de-light-ipad.jpg) | Platzhalter mit richtigem großem Titel |
| [open-invite-de-light-iphone](screens/open-invite-de-light-iphone.jpg), [open-invite-denied-en-dark-se](screens/open-invite-denied-en-dark-se.jpg) | Einladung öffnen: Scanner mit Einfügefeld, Kamera verweigert |
| [link-invite-de-dark-se](screens/link-invite-de-dark-se.jpg) | per Link geöffnete Einladung (noch ohne Bereich) |
| [gallery-light-iphone](screens/gallery-light-iphone.jpg), [gallery-dark-se](screens/gallery-dark-se.jpg), [gallery-dark-desktop](screens/gallery-dark-desktop.jpg) | Bausteine: Avatare (erzeugt, mit Initiale, kaputtes Foto, SVG und http abgewiesen), Zeilenarten, QR-Code, Teilen, Leerzustand, Scanner |

## Bundle und Leistung

Siehe [P0.07/DESIGN.md](../P0.07/DESIGN.md) §6. Kurz: Der Erstaufruf von `/` enthält weder nostr-core noch QR-Leser oder QR-Erzeuger. Er ist um 4,0 kB gzip (+1,6 %) gewachsen, davon 1,7 kB neue Texte in beiden Sprachen; Budget 5 kB. In der gedrosselten Labormessung zeichnet die Startseite rund 60 ms später (LCP-Median 764 / 780 ms gegen 696 / 724 ms); Scoreeingabe und Speicherung bleiben innerhalb der Streuung des Ausgangsstands.

## Unit-Tests

`tests/shell-links.test.ts`, `shell-nav.test.ts`, `shell-registry.test.ts`, `shell-share.test.ts`, `shell-avatar.test.ts`, `shell-texts.test.ts` (keine Protokollbegriffe in Rahmen- und Gastprofiltexten, in beiden Sprachen).

## Bekannte Grenzen

- Neu laden auf einem gepushten Bildschirm: Die App startet an den Wurzeln und führt den Browserverlauf auf den Starteintrag zurück. Chromium lädt die Seite dabei ein zweites Mal, weil die älteren Einträge zum vorherigen Dokument gehören. Ergebnis korrekt, aber ein doppelter Ladevorgang.
- Browser-Vorwärts auf einen früher gepushten Bildschirm wird zurückgenommen: der Stapel selbst wird nicht im Verlauf gespeichert.
- Ein Bildschirm, dessen Code offline noch nie geladen wurde, zeigt „konnte nicht geladen werden“ mit „Erneut versuchen“. Profil, Einstellungen und Über sind davon nach dem ersten Besuch ausgenommen (Vorladen im Leerlauf, Ablaufprüfung oben); der Scanner nicht, denn Einladungen brauchen ohnehin eine Verbindung.
- Wird der QR-Leser jsQR offline zum ersten Mal gebraucht, meldet der Scanner „Die Kamera ließ sich nicht starten“; das Einfügefeld bleibt nutzbar.
- Nicht geprüft: Safari und Firefox, echte Geräte, installierte PWA, VoiceOver und TalkBack auf Geräten, vergrößerte Schrift, echte Kameras (nur Chromium-Fake-Kamera).
