# Nachweise P3a.02 (Outbox) und P3b.01–P3b.03 (private Historie, Abgleich, Portabilität)

Stand: 16. Oktober 2026 (Fix-Runde 1 nach der unabhängigen Prüfung), Branch `wave2/sync`, nostr-core 1.0.4. Laborwerte unter paralleler Last anderer Agenten auf demselben Rechner; nichts davon lief auf öffentlichen Relays (Nutzerfreigabe E7 steht aus).

## Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| `npm run lint` | 0 Fehler; 3 Warnungen (ungenutzte Variablen) in Skripten der Profil-Spur unter `evidence/P2.01/scripts/fix1`, die mit deren Fix-Runde hereinkamen, nicht Teil dieser Spur |
| `npm run typecheck` | fehlerfrei |
| `npm test` (alle Unit-Tests, Node 25) | 514/514 bestanden (19,5 s); diese Runde neu: `tests/sync-history.test.ts` 7 → 12 Fälle (Rangliste zurücksetzen, Abmelden während des Abgleichs, Uhr zurück, fremder Datenschlüssel, nur lesen zählt Änderungen), `tests/sync-outbox.test.ts` 9 → 12 (Einreihen wartet nie hinter dem Senden, verliehene Einträge, Aufgeben nach einer Woche), `tests/sync-records.test.ts` 9 → 11 (Abwesenheit ist keine Löschung, `nextCreatedAt`), `tests/storage-archive.test.ts` (Löschmarken), `tests/profile-session.test.ts` (`madeHere`) |
| `npm run test:relay` (nak serve, nak bunker auf 127.0.0.1, Ports 20040–20049, Dateien nacheinander: `NAK_PORT_RANGE=20040-20049 node --test --test-concurrency=1 tests/relay/*.test.ts`) | 31/31 bestanden (30,9 s); neu: „a deletion from a device whose clock runs behind“ |
| `npm run build` mit `NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20040,ws://127.0.0.1:20041` | bestanden; Route `/` 63,3 kB, First Load 268 kB (Profil-Spur nach ihrer Fix-Runde: 62,5 kB / 267 kB; Stand vor dieser Runde: 63 kB / 268 kB). Die Startaufgabe liest nur noch den kv-Eintrag der Sitzung (`lib/profile/storage-keys.ts`) statt das Sitzungsmodul zu laden; ein Gast ohne Profil lädt `lib/sync` gar nicht mehr |
| Browserlauf `scripts/sync-checks.mjs` (Chromium über Playwright gegen `next start -p 3312`, Relays und Signer auf 20040–20043, tote Adresse 20049) | 34/34 |

## Browserlauf

Fünf Geräte (Browserkontexte) gegen zwei lokale Relays und zwei Signer (`nak bunker`), alles von `nak` unabhängig nachgelesen:

1. **Gerät A** (iPhone 390 × 844, Deutsch): Ein beendetes Spiel (101, Lena gegen Ben), Anmeldung „Mit einer anderen App › Signer-App“ über den nostrconnect-Code, Spiel als „Lena“ beansprucht. Ein Profil in einer Signer-App wird nur beim Start, auf Wunsch und beim Verlassen der App um Unterschriften gebeten: das Spiel und die Spielerliste warten hier, kein Relay bekommt von selbst etwas, und Erweitert sagt „Noch nicht gesendet · Wird beim nächsten Abgleich gesendet. · 2“. Nach „Jetzt abgleichen“ liegen Datenschlüssel, Spiel und Spielerliste auf beiden Relays als drei Events Kind 30078 mit je einem opaken `d`-Tag; `nak verify` bestätigt die Signaturen, im Inhalt stehen weder Namen noch Spiel; Erweitert zeigt „Zuletzt abgeglichen · Vollständig · Heute“ ohne weitere Zeile. Ein Relay gestoppt und „Jetzt abgleichen“: die Zeile sagt „Teilweise · Nicht jedes Relay hat geantwortet.“, und die Relay-Liste darüber sagt für dieses Relay „Nicht erreichbar“ (sie wird nach jedem Abgleich neu geprüft). Relay leer neu gestartet und „Jetzt abgleichen“: wieder „Vollständig“, alle drei Datensätze liegen wieder dort, die Liste sagt „Verbunden“. `ws://127.0.0.1:20049` wird nach der NIP-11-Prüfung abgewiesen, `ws://127.0.0.1:20042` aufgenommen, in Kind 10002 veröffentlicht und beim nächsten Abgleich gefüllt. „Diagnose kopieren“ enthält den Abschnitt „Sync“ (outbox, fewer than 2 confirmed copies, changes not written yet, last sync, last check) und keinen Schlüssel.
2. **Gerät B** (iPhone, Englisch): Anmeldung mit demselben Signer, keine Zuordnung nötig. Das Spiel erscheint unter „Recent games“ und „Games 1“; im Archiv liegt es vollständig (`source: local`, drei Würfe, Lenas Platz mit dem Profil verbunden), die Spielerliste kennt Lena und Ben.
3. **Gerät C** (iPhone SE 320 × 548, Deutsch, alle Relays gestoppt): Neues Profil „Mia“ hier angelegt. Die Profilkarte sagt „Noch keine X01-Spiele. Nach deinem ersten Spiel stehen hier deine Zahlen.“ und verspricht nichts von anderen Geräten; Profil › Spiele sagt „Noch keine Spiele“ ohne „Erneut versuchen“; Erweitert zeigt „Nicht verfügbar · Kein Relay hat geantwortet.“ in der Zeile und „Noch nicht gesendet 2“ (Profil und Relay-Liste in der Outbox). Nach dem Start der Relays und „Jetzt abgleichen“: sofort „Wird abgeglichen“ mit drehendem Symbol in voller Deckung, dann „Vollständig“ und die Zeile ist weg. Keine horizontale Bildlaufleiste bei 320 pt.
4. **Gerät E** (iPhone 390 × 844, Deutsch, Profil von anderswo über einen eingefügten bunker://-Link, während die Relays der App gestoppt sind): Die Profilkarte sagt „Spiele von deinen anderen Geräten erscheinen, sobald eine Verbindung besteht.“; Profil › Spiele sagt „Deine Spiele konnten noch nicht geladen werden“ mit „Erneut versuchen“ als gefüllter Hauptaktion. Der Tipp zeigt „Deine Spiele werden geladen“, obwohl jedes Relay sofort ablehnt (der Ladezustand bleibt mindestens 0,7 s). Mit den Relays zurück endet „Erneut versuchen“ in „Noch keine Spiele“.
5. **Gerät D** (iPad quer 1024 × 768, Englisch, dunkel): Advanced mit dem Sync-Abschnitt („Last synced · Complete · Today“, „Sync now“, keine weitere Zeile).

Konsolenfehler: keine, abgesehen von den Verbindungsfehlern, die der Browser selbst für die absichtlich tote Adresse und die gestoppten Relays protokolliert.

## Bilder

| Datei | Inhalt |
| --- | --- |
| `screens/a-advanced-pending-de.jpg` | Gerät A, Erweitert: das beanspruchte Spiel wartet auf den nächsten Abgleich, der schreibt |
| `screens/a-advanced-sync-de.jpg` | Gerät A, Erweitert nach „Jetzt abgleichen“: vollständig |
| `screens/a-advanced-partial-de.jpg` | Gerät A, ein Relay gestoppt: Grund in der Zeile, Relay-Liste sagt „Nicht erreichbar“ |
| `screens/b-profile-en.jpg` | Gerät B, Profil mit dem von Gerät A gekommenen Spiel |
| `screens/c-profile-se-new.jpg` | Gerät C, Profilkarte eines hier angelegten Profils ohne Verbindung |
| `screens/c-games-se-none.jpg` | Gerät C, Profil › Spiele |
| `screens/c-advanced-se-unavailable.jpg` | Gerät C, Erweitert ohne Verbindung |
| `screens/c-advanced-se-syncing.jpg` | Gerät C, direkt nach „Jetzt abgleichen“ |
| `screens/c-advanced-se-complete.jpg` | Gerät C, Erweitert nach dem Abgleich |
| `screens/e-games-unavailable-de.jpg` | Gerät E, Profil › Spiele ohne Verbindung |
| `screens/e-games-retrying-de.jpg` | Gerät E, direkt nach „Erneut versuchen“ |
| `screens/d-advanced-ipad-en-dark.jpg` | Gerät D, Advanced auf dem iPad quer, dunkel |

## Nicht geprüft

Echte Geräte und Browser (Safari, Firefox, iOS, Android, installierte PWA), VoiceOver, echte Signer-Apps (Amber, nsec.app) und Erweiterungen, die fünf öffentlichen Relays (Annahme von Kind 30078, Aufbewahrung nach 24 Stunden und 7 Tagen), die Zustände „Signer hat abgelehnt“ und „Datenschlüssel öffnet nicht“ im Browser (nur Unit-Tests der Engine und feste Texte), der Moment „App geht in den Hintergrund“ einer Signer-App-Sitzung auf einem Telefon (ob der Browser dem Signer-Rundlauf Zeit lässt).
