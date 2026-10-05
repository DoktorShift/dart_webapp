# P0.02 App-Rahmen und Navigation: Nachweise

Stand: 4. Oktober 2026 · Branch `wave1/shell` · Basis `fd4e6c5` (`nostr-expansion`) · Aufgabe [P0.02](../../tasks/P0.02.md)

Alle Prüfungen liefen gegen einen Produktionsbuild dieses Branches (`npm run build`, `npx next start -p 3203`) in Chromium aus Playwright 1.63 mit emulierten Größen. Das sind Browserprüfungen, keine Tests auf echten Telefonen oder mit Spielern.

## Was gebaut ist

| Teil | Dateien | Kurz |
| --- | --- | --- |
| Tabs | `components/app-shell.tsx`, `app/page.tsx` | Spielen, Rangliste, Clubs, Turniere, Profil. Tab-Leiste unten bis 1023 px Breite, Seitenleiste ab 1024 px; in Einrichtung und Spiel ausgeblendet. Tabs werden beim ersten Öffnen aufgebaut und bleiben danach erhalten, auch unter Einrichtung und Spiel (`components/nav/tabs-layer.tsx`: verdeckt, `inert`, nach dem Einschieben `display: none` und eingefroren; aus memoisierten Teilen gebaut, damit ein Wurf sie nicht neu rendert). Erneutes Tippen auf den offenen Tab: zur Wurzel, an der Wurzel nach oben. |
| Navigationsstapel | `lib/shell/nav.ts`, `components/nav/stack-view.tsx`, `screen-frame.tsx`, `nav-header.tsx` | Je Tab ein Stapel. Push/Pop mit der Schiebeanimation der App (0,32 s), bei „Bewegung reduzieren“ Überblendung (0,15 s). Großer Titel, der beim Scrollen in die Leiste wandert. Zurück-Taste mit dem Titel des vorherigen Bildschirms, sonst „Zurück“, sonst nur Pfeil; VoiceOver hört immer „Zurück zu …“. Scrollposition und Eingaben je Bildschirm bleiben erhalten, beim Tabwechsel und nach Einrichtung oder Spiel; Fokus folgt der Navigation und kehrt nach der Einrichtung zur auslösenden Taste zurück. |
| Browser-Zurück | `components/nav/use-history-sync.ts` | Ein History-Eintrag je gepushtem Bildschirm und für die Einrichtung, ohne URL-Änderung. Das Spiel hat keinen eigenen Eintrag. |
| Rückkehr aus Einrichtung und Spiel | `app/page.tsx` | Zurück in der Einrichtung, Browser-Zurück, „Speichern und verlassen“, „Spiel beenden ohne Speichern“ und „Fertig“ führen in den Tab, aus dem die Einrichtung geöffnet wurde (auch `openSetup` aus einem Bereich); die Zurück-Taste der Einrichtung trägt dessen Titel, über einem gepushten Bildschirm „Zurück“. „Rangliste“ im Ergebnis führt zur Rangliste. „Spiel starten“ in der leeren Rangliste führt wie in 1.0.0 nach Spielen. |
| App-Links | `lib/shell/links.ts` | `/#p=`, `/#watch=`, `/#club=`, `/#tournament=`, `/#pair=`, `/#board=`, `/#signer-return…`; Nutzlast unverändert und undurchsichtig, höchstens 4096 Zeichen, keine Leer- oder Steuerzeichen. Beim Einfügen oder Scannen zählen nur Adressen dieser App und nur ihre Startseite. |
| Registry | `lib/shell/registry.ts`, `components/shell/extensions.ts`, `components/shell/builtin-screens.tsx`, `components/shell/slot-items.tsx` | Bildschirme, Aktionen, Link-Handler und Slots (`profile.root`, `profile.tabIcon`, `clubs.root`, `tournaments.root`); Slot-Listen im Spielablauf (`result.actions`, `setup.extras`) und Einträge im Optionsmenü des Spiels. Jeder Bildschirm, auf den der Rahmen schon verweist, hat einen Platzhalter mit richtigem Titel; ein Bereich ersetzt ihn mit derselben ID. Ohne Registrierung zeigen Slot-Listen und Menü nichts zusätzlich. |
| Profil als Gast | `components/shell/guest-profile.tsx`, `tab-roots.tsx`, `tab-homes.tsx` | Erzeugtes Bild, „Gast“, Spiele und meiste Siege aus der Spielhistorie dieses Geräts, ruhige Karte „Profil anlegen“, Sheet „Ich habe schon ein Profil“ mit drei Wegen, Einstellungen, „Über die App“. |
| Einstellungen, Über | `components/shell/settings-entry.tsx`, `about-screen.tsx` | Die vorhandenen Ansichten als Bildschirme des Profil-Tabs; die Installationsanleitung öffnet als Sheet in den Einstellungen. Die Seite `/about` bleibt unverändert erreichbar. |
| Clubs, Turniere | `components/shell/tab-roots.tsx`, `tab-homes.tsx`, `open-link-screen.tsx` | Leerzustand mit „Club gründen“ / „Turnier erstellen“ und „Einladung öffnen“ (Scanner mit Einfügefeld, nimmt nur Einladungen der passenden Art). Auf Telefonen quer ohne Symbol und mit beiden Tasten nebeneinander, damit alles über der Tab-Leiste bleibt. |
| Bausteine | `components/ui/list-row.tsx`, `empty-state.tsx`, `avatar.tsx`, `components/common/*`, `lib/shell/share.ts`, `lib/shell/avatar.ts` | Zeilen (Navigation, Wert, Symbol, zerstörend), Leerzustand, Avatar, QR-Code, Scanner, Teilen, Statusmeldung im Ablauf. |
| Kamera | `next.config.mjs` | `Permissions-Policy: camera=(self), microphone=(), geolocation=()` |

Der Code der Bildschirme außerhalb von Spielen und Rangliste (Inhalt von Clubs, Turniere und Profil, Einstellungen, Über, Scanner, QR-Erzeuger, QR-Leser) lädt erst bei Bedarf; die großen Titel der Tabs stehen sofort. Clubs, Turniere, Profil, Einstellungen und Über werden im Leerlauf auf den Tabs vorgeladen, damit sie offline funktionieren wie früher der Einstellungen-Tab.

## Anschluss für die Bereiche

Ein Bereich fügt in `components/shell/extensions.ts` eine Importzeile für ein kleines Modul hinzu, das beim Laden die Registry aufruft. Echte Bildschirme laden mit `lazyScreen()` erst bei Bedarf, damit der Gastweg ihren Code (und nostr-core) nie lädt.

```ts
// components/clubs/register.ts
import { lazyScreen } from "@/components/nav/lazy-screen"
import { SCREENS, registerLinkHandler, registerScreen, registerSlot } from "@/lib/shell/registry"

registerScreen(SCREENS.clubCreate, { title: (t) => t.clubs.createTitle, Component: lazyScreen(() => import("./create-screen")) })
registerLinkHandler("club", (link, nav, source) => …)   // sonst: Bildschirm "club.invite" mit params.payload
registerSlot("clubs.root", ClubListOrEmpty)              // bekommt den Leerzustand des Rahmens als `fallback`

// im Spielablauf (mehrere Bereiche je Stelle, in Registrierungsreihenfolge; Rückgabe entfernt wieder)
registerSlotItem("result.actions", "profile.keep", KeepResultCard)   // Props: { match: FinishedMatch }
registerSlotItem("setup.extras", "live", LiveSwitch)                 // Props: { config, value, onChange }
registerGameMenuItem({ id: "live.watchers", label: (t) => t.live.invite, icon: Radio, onSelect: ({ match }) => … })
```

| Erweiterungspunkt | IDs |
| --- | --- |
| Bildschirme mit Platzhalter | `profile.create`, `profile.fromDevice`, `profile.fromBackup`, `profile.fromApp`, `profile.public`, `devices.pair`, `club.create`, `club.invite`, `tournament.create`, `tournament.view`, `live.watch`, `live.board`; dazu `club.openInvite`, `tournament.openInvite` (Scanner), `settings`, `about` |
| Aktionen (Tasten des Rahmens) | `profile.create`, `profile.fromDevice`, `profile.fromBackup`, `profile.fromApp`, `club.create`, `club.openInvite`, `tournament.create`, `tournament.openInvite`; ohne Handler wird der gleichnamige Bildschirm in seinem Tab gepusht |
| Links ohne Handler | `p` → Profil/`profile.public`, `watch` → Spielen/`live.watch`, `club` → Clubs/`club.invite`, `tournament` → Turniere/`tournament.view`, `pair` → Profil/`devices.pair`, `board` → Spielen/`live.board`, `signer-return` → verworfen |
| Slots | `profile.root` (angemeldetes Profil), `profile.tabIcon` (eigenes Bild im Tab), `clubs.root`, `tournaments.root` |
| Slot-Listen | `result.actions`: im Ergebnis eines beendeten Spiels unter dem Ergebnis, über „Revanche“; bekommt `{ match: FinishedMatch }` (`id`, `config`, `players`, `winner`, `solo`, `throws`); je Bereich eine Zeile (Taste oder einzeilige Karte, etwa 44 pt), denn das Ergebnis bleibt ein fester Bildschirm, und auf Telefonen quer ist Platz für etwa eine Zeile ([Beispiel mit zwei Teilen](screens/slots-result-de-light-iphone-landscape.jpg): die kleinen Tasten rutschen schon an den Rand). `setup.extras`: am Ende der Optionen der Einrichtung, vor „Spiel starten“; bekommt `{ config, value, onChange }`; der Wert wird als `config.extras[id]` mit dem Spiel gespeichert (nur JSON; „Revanche“ und „Nochmal spielen“ übernehmen ihn). Ein Teil, das wirft oder nicht laden kann, wird ausgelassen. |
| Einträge im Spielmenü | `registerGameMenuItem({ id, label: (t) => string, icon?, onSelect({ match }) })`: am Ende der Aktionen im Optionsmenü („…“) des laufenden Spiels; das Menü schließt sich vor `onSelect`. Sonst bleibt der Spielbildschirm unverändert. |
| Navigation in Bildschirmen | `useNav()`: `push`, `replaceTop`, `pop`, `popToRoot`, `selectTab`, `openSetup` (Zurück und Spielende führen in den aufrufenden Tab) |
| Bausteine | `ListRow`, `RowIcon`, `EmptyState`, `Avatar`, `QRCodeView`, `QRScanner`, `ShareActions`, `InlineStatus`, `shareLink`, `buildLink`, `parseAppLink` |

## Abläufe im Produktionsbuild

Skript: [scripts/shell-flows.mjs](scripts/shell-flows.mjs); Fake-Kamera-Videos mit QR-Code aus [scripts/make-qr-video.mjs](scripts/make-qr-video.mjs). Keine echte Kamera, kein Netzwerk außer dem lokalen Server.

**75 von 75 Prüfungen bestanden** auf dem Stand nach Review-Runde 1 (Protokoll: [flows-result.txt](flows-result.txt)); neu ist die Offline-Prüfung von Clubs und Turniere, deren Inhalt jetzt bei Bedarf lädt. Geprüft wird:

| Bereich | Prüfungen |
| --- | --- |
| Tabs und Stapel | fünf Tabs, Spielen offen; Gastkopf und Zahlen aus der Historie (14 Spiele, meiste Siege 9, Lena); Push von Einstellungen mit „Zurück zu Profil“; ein Verlaufseintrag je Push; Zurück-Taste und Browser-Zurück poppen; „Über die App“ im Profil-Tab; Tabwechsel ohne Verlaufseintrag; Stapel und Scrollposition je Tab bleiben erhalten (auch die Rangliste); erneutes Tippen auf den offenen Tab führt zur Wurzel; keine Konsolenfehler |
| App-Links | `/#club=` beim Start öffnet Clubs → „Einladung“ mit „Diesen Link kann diese Version noch nicht öffnen.“ und verschwindet aus der Adresse; Browser-Zurück führt zur Wurzel; `#tournament=` bei geöffneter App (hashchange) und zurück; `#foo=bar` wird ignoriert; `#signer-return=` ohne wartenden Ablauf wird aus der Adresse entfernt |
| Einrichtung und Spiel | Einrichtung ohne Tab-Leiste, mit einem Verlaufseintrag, Browser-Zurück zurück zu Spielen; Spiel ohne Tab-Leiste und ohne eigenen Verlaufseintrag, scrollt nicht; ein Link während des Spiels öffnet sich, das Spiel wartet auf Spielen unter „Weiterspielen“ mit allen Würfen |
| Einladung einfügen | Scanner-Bildschirm mit Einfügefeld; fremde Domain „kein BlueLine-Link“; Turnierlink im Club-Scanner „keine Club-Einladung“; Club-Link ersetzt den Scanner (Zurück führt zu Clubs) |
| Scanner ohne Kamera | verweigert, keine Kamera, belegt: je eigener Text, Einfügefeld bleibt |
| Scanner mit Fake-Kamera | echte QR-Erkennung mit BarcodeDetector und mit jsQR (BarcodeDetector entfernt): Club-Einladung öffnet sich; fremder Code wird abgelehnt; Kamera an beim Scannen, aus in einem anderen Tab, wieder an bei Rückkehr, aus nach Zurück |
| Offline | nach einem Besuch mit Service Worker: Profil, Einstellungen, „Über die App“ sowie die Leerzustände von Clubs und Turniere öffnen ohne Verbindung, ohne Seitenfehler |
| Sonstiges | `Permissions-Policy: camera=(self), microphone=(), geolocation=()`; Bewegung reduziert: Push überblendet statt zu schieben; englische Tab-Leiste und englisches Sheet; Sheet-Auswahl öffnet ihren Bildschirm im Profil-Tab |

### Nachprüfung Review-Runde 1

Skript: [scripts/review1-checks.mjs](scripts/review1-checks.mjs) gegen drei Produktionsbuilds: diesen Stand (nichts registriert), den geprüften Stand `c61a108` (aus `git archive`, gleiche `node_modules`) und diesen Stand mit den Beispielregistrierungen aus [scripts/sample-extensions.tsx](scripts/sample-extensions.tsx) (nur in einer Arbeitskopie gebaut, nie in der App). **68 von 68 Prüfungen bestanden** ([review1-result.txt](review1-result.txt)).

| Bereich | Prüfungen |
| --- | --- |
| Zustand nach einem Spiel (Befund 1) | 320 × 548: Profil › Einstellungen auf 300 px, Rangliste auf 400 px gescrollt, in Clubs › „Einladung öffnen“ einen Link angefangen; Spiel gestartet, drei Würfe, „Speichern und verlassen“: Einstellungen weiter oben im Profil-Stapel mit 300 px, Rangliste 400 px, Entwurf „entwurf-123“ noch im Feld ([Bild](screens/after-game-draft-de-light-se.jpg)). Beendetes Spiel bis zum Ergebnis und „Fertig“: Rangliste behält 250 px und zeigt das neue Ergebnis. Tab-Leiste im Spiel ausgeblendet, keine Konsolenfehler |
| Rückkehr (Befund 3) | Einrichtung aus Spielen: Zurück „Spielen“, Zurück-Taste und Browser-Zurück führen nach Spielen, Fokus wieder auf „X01“. Leere Rangliste › „Spiel starten“: Zurück „Spielen“ und nach Spielen, wie 1.0.0. Mit Beispielregistrierung `club.create` → `openSetup`: Zurück „Clubs“ ([Bild](screens/setup-from-clubs-de-light-iphone.jpg)), Zurück-Taste, Browser-Zurück und „Speichern und verlassen“ führen nach Clubs |
| Leerzustand quer (Befund 2) | Clubs und Turniere, DE/EN, hell/dunkel, auf 568 × 320 und 844 × 390 (und 320 × 548): beide Tasten mindestens 44 pt hoch und ganz über der Tab-Leiste, kein waagerechtes Scrollen |
| Texte (Befunde 4, 6) | `/#p=abc`: großer Titel „Spielerprofil“ / „Player profile“ unter „‹ Profil“ / „‹ Profile“ ([Bild](screens/public-profile-link-de-light-se.jpg)); englischer Platzhalter „This is coming in a future version.“ |
| Leiste beim erneuten Zeigen | Wurzel nach Tabwechsel und nach der Einrichtung: der kleine Titel in der Leiste blitzt nicht auf (vorher sichtbar, auch im geprüften Stand); weggescrollt steht der Titel in der Leiste, auch nach einem Tabwechsel |
| Ohne Registrierung unverändert | Einrichtung (oben und unten), Spiel, Optionsmenü und Ergebnis pixelgleich mit `c61a108` (390 × 844); Clubs, Turniere und Profil pixelgleich auf 320 × 548, 390 × 844 und 1024 × 768, hell und dunkel |
| Erweiterungspunkte | `setup.extras`: Teil am Ende der Optionen, `onChange` setzt den Wert, das gestartete Spiel trägt `config.extras = {"test":true}`; ein werfendes Teil wird ausgelassen, „Spiel starten“ bleibt ([Bild](screens/slots-setup-extras-de-light-iphone.jpg)). Spielmenü: Eintrag am Ende der Aktionen mit Symbol, Auswahl schließt das Menü und übergibt das laufende Spiel (id, 1 Wurf, extras) ([Bild](screens/slots-game-menu-de-light-iphone.jpg)). `result.actions`: zwei Teile in Registrierungsreihenfolge über „Revanche“, je genau einmal im Dokument, auf 390 × 844, 844 × 390 und 320 × 548 sichtbar, mit Sieger, Spielerzahl und 9 Würfen ([hoch](screens/slots-result-de-light-iphone.jpg), [quer](screens/slots-result-de-light-iphone-landscape.jpg)) |

## Bildmatrix

Skript: [scripts/shell-screens.mjs](scripts/shell-screens.mjs). Vierzehn Ansichten (Spielen, Rangliste, Clubs, Turniere, Profil, Profil gescrollt, Sheet „Ich habe schon ein Profil“, Einstellungen, Über die App, Club gründen, Einladung öffnen, Kamera verweigert, Einladungslink und der unveränderte Spielbildschirm) in Deutsch und Englisch, hell und dunkel, auf 320 × 548, 390 × 844, 768 × 1024, 1024 × 768 und 1440 × 900. Jedes Bild prüft das Skript zusätzlich auf horizontales Scrollen, Elemente außerhalb des Bildschirms, Kürzung mit „…“, Text, der aus seiner Taste läuft, und Berührungsflächen unter 44 × 44 pt.

| Lauf | Bilder | Befunde |
| --- | --- | --- |
| Review-Runde 1: 14 Ansichten × DE/EN × hell/dunkel × 7 Größen (die fünf oben und 568 × 320, 844 × 390) | 392 | 2, dieselben Bestandsbefunde im unveränderten Spielbildschirm („Rückgängig“ auf 568 × 320, Deutsch). Clubs und Turniere quer jetzt ohne Befund und vollständig über der Tab-Leiste ([matrix-review1-report.txt](matrix-review1-report.txt)) |
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
| [clubs-de-light-se](screens/clubs-de-light-se.jpg), [clubs-en-dark-desktop](screens/clubs-en-dark-desktop.jpg), [clubs-de-dark-se-landscape](screens/clubs-de-dark-se-landscape.jpg), [clubs-de-light-se-landscape](screens/clubs-de-light-se-landscape.jpg) | Clubs, Leerzustand; quer ohne Symbol, Tasten nebeneinander (Review-Runde 1) |
| [tournaments-de-dark-iphone](screens/tournaments-de-dark-iphone.jpg), [tournaments-en-light-ipad](screens/tournaments-en-light-ipad.jpg), [tournaments-en-dark-se-landscape](screens/tournaments-en-dark-se-landscape.jpg), [tournaments-de-light-iphone-landscape](screens/tournaments-de-light-iphone-landscape.jpg) | Turniere, Leerzustand |
| [public-profile-link-de-light-se](screens/public-profile-link-de-light-se.jpg) | Profillink: „Spielerprofil“ unter „‹ Profil“ |
| [after-game-draft-de-light-se](screens/after-game-draft-de-light-se.jpg) | nach einem Spiel: Clubs-Stapel und angefangener Link unverändert |
| [setup-from-clubs-de-light-iphone](screens/setup-from-clubs-de-light-iphone.jpg), [slots-setup-extras-de-light-iphone](screens/slots-setup-extras-de-light-iphone.jpg), [slots-game-menu-de-light-iphone](screens/slots-game-menu-de-light-iphone.jpg), [slots-result-de-light-iphone](screens/slots-result-de-light-iphone.jpg), [slots-result-de-light-iphone-landscape](screens/slots-result-de-light-iphone-landscape.jpg) | nur mit Beispielregistrierungen: Einrichtung aus Clubs, `setup.extras`, Eintrag im Spielmenü, `result.actions` hoch und quer |
| [club-create-de-light-ipad](screens/club-create-de-light-ipad.jpg) | Platzhalter mit richtigem großem Titel |
| [open-invite-de-light-iphone](screens/open-invite-de-light-iphone.jpg), [open-invite-denied-en-dark-se](screens/open-invite-denied-en-dark-se.jpg) | Einladung öffnen: Scanner mit Einfügefeld, Kamera verweigert |
| [link-invite-de-dark-se](screens/link-invite-de-dark-se.jpg) | per Link geöffnete Einladung (noch ohne Bereich) |
| [gallery-light-iphone](screens/gallery-light-iphone.jpg), [gallery-dark-se](screens/gallery-dark-se.jpg), [gallery-dark-desktop](screens/gallery-dark-desktop.jpg) | Bausteine: Avatare (erzeugt, mit Initiale, kaputtes Foto, SVG und http abgewiesen), Zeilenarten, QR-Code, Teilen, Leerzustand, Scanner |

## Bundle und Leistung

Siehe [P0.07/DESIGN.md](../P0.07/DESIGN.md) §6. Kurz: Der Erstaufruf von `/` enthält weder nostr-core noch QR-Leser oder QR-Erzeuger. Nach Review-Runde 1 ist er 4,6 kB gzip (+1,9 %) größer als der Ausgangsstand `fd4e6c5`, davon 1,7 kB neue Texte in beiden Sprachen; der Inhalt von Clubs, Turniere und Profil lädt jetzt bei Bedarf. Die Grenze von 5 kB stammt aus DESIGN.md, nicht vom Nutzer; die Aufgabe verlangt „unverändert“, die Entscheidung liegt beim Nutzer. Laborwerte (unter paralleler Last, Lastmittel 4 bis 11): Kaltstart LCP-Median 708 bis 776 ms; Scoreeingabe p50 64 ms in allen Läufen, p95 64 bis 96 ms wie im Stand davor (64 bis 72 ms) innerhalb der Streuung; die verdeckten Tabs werden unter dem Spiel eingefroren, damit Änderungen in ihnen (Spielende, später Live-Daten) keinen Wurf aufhalten.

## Unit-Tests

`tests/shell-links.test.ts`, `shell-nav.test.ts`, `shell-registry.test.ts`, `shell-share.test.ts`, `shell-avatar.test.ts`, `shell-texts.test.ts` (keine Protokollbegriffe in Rahmen- und Gastprofiltexten, in beiden Sprachen).

## Bekannte Grenzen

- Neu laden auf einem gepushten Bildschirm: Die App startet an den Wurzeln und führt den Browserverlauf auf den Starteintrag zurück. Chromium lädt die Seite dabei ein zweites Mal, weil die älteren Einträge zum vorherigen Dokument gehören. Ergebnis korrekt, aber ein doppelter Ladevorgang.
- Browser-Vorwärts auf einen früher gepushten Bildschirm wird zurückgenommen: der Stapel selbst wird nicht im Verlauf gespeichert.
- Ein Bildschirm, dessen Code offline noch nie geladen wurde, zeigt „konnte nicht geladen werden“ mit „Erneut versuchen“. Clubs, Turniere, Profil, Einstellungen und Über sind davon nach dem ersten Besuch ausgenommen (Vorladen im Leerlauf, Ablaufprüfung oben); der Scanner nicht, denn Einladungen brauchen ohnehin eine Verbindung.
- Wer die Clubs-, Turniere- oder Profil-Tab in den ersten Sekunden nach dem allerersten Start öffnet, sieht unter dem großen Titel kurz nichts, bis der Inhalt geladen ist (ab 0,4 s „Wird geladen“).
- Die Tabs bleiben unter dem Spiel erhalten und sind dort eingefroren (Suspense-Grenze statt `<Activity>`, das die React-Version in Next.js 15 noch nicht exportiert). Änderungen in ihnen rendert React im Leerlauf oder beim Zeigen; ihre Effekte (Abos, Listener) laufen aber weiter. Bereiche, die in einem Tab Live-Daten abonnieren, sollten das Abo pausieren, solange ihr Bildschirm nicht sichtbar ist.
- Wird der QR-Leser jsQR offline zum ersten Mal gebraucht, meldet der Scanner „Die Kamera ließ sich nicht starten“; das Einfügefeld bleibt nutzbar.
- Nicht geprüft: Safari und Firefox, echte Geräte, installierte PWA, VoiceOver und TalkBack auf Geräten, vergrößerte Schrift, echte Kameras (nur Chromium-Fake-Kamera).
