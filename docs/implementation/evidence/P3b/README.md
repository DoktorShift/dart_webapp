# Nachweise P3a.02 (Outbox) und P3b.01–P3b.03 (private Historie, Abgleich, Portabilität)

Stand: 6. Oktober 2026, Branch `wave2/sync`, nostr-core 1.0.4. Laborwerte unter paralleler Last anderer Agenten auf demselben Rechner; nichts davon lief auf öffentlichen Relays (Nutzerfreigabe E7 steht aus).

## Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| `npm run lint` | 0 Probleme |
| `npm run typecheck` | fehlerfrei |
| `npm test` (alle Unit-Tests, Node 25.2.1) | 490/490 bestanden (19,5 s); neu: `tests/sync-outbox.test.ts` (9), `tests/sync-records.test.ts` (9), `tests/sync-history.test.ts` (7), Erweiterungen in `tests/i18n.test.ts`, `tests/shell-texts.test.ts` |
| `npm run test:relay` (nak serve, nak bunker auf 127.0.0.1) | 30/30 bestanden (10,0 s); neu: `tests/relay/sync.test.ts` (6) |
| `npm run build` mit `NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:18961,ws://127.0.0.1:18962` | bestanden; Route `/` 63 kB, First Load 268 kB (Profil-Spur zuvor: 62,4 kB / 267 kB; der Zuwachs sind die Registrierung des Erweitert-Abschnitts und die Startaufgabe, lib/sync selbst lädt erst im Leerlauf nach dem ersten Bildschirm) |
| Browserlauf `scripts/sync-checks.mjs` (Chromium über Playwright gegen `next start -p 3312`) | 22/22 |

## Browserlauf

Vier Geräte (Browserkontexte) gegen zwei lokale Relays und einen Signer (`nak bunker`), alles von `nak` unabhängig nachgelesen:

1. **Gerät A** (iPhone 390 × 844, Deutsch): Ein beendetes Spiel (101, Lena gegen Ben), Anmeldung „Mit einer anderen App › Signer-App“ über den nostrconnect-Code, Spiel als „Lena“ beansprucht. Der Datenschlüssel, das Spiel und die Spielerliste erreichen beide Relays von selbst (15 s nach der Änderung) als drei Events Kind 30078 mit je einem opaken `d`-Tag; `nak verify` bestätigt die Signaturen des Signers, im Inhalt stehen weder Namen noch Spiel. Erweitert zeigt „Zuletzt abgeglichen · Vollständig · Heute“, „Kopien zuletzt geprüft“, 0 wartende Übertragungen, 0 Events mit weniger als zwei Kopien. `ws://127.0.0.1:18999` wird nach der NIP-11-Prüfung abgewiesen („Unter dieser Adresse antwortet kein Relay.“), `ws://127.0.0.1:18963` aufgenommen und in Kind 10002 veröffentlicht; nach „Jetzt abgleichen“ liegen alle drei Datensätze auch dort. „Diagnose kopieren“ enthält den Abschnitt „Sync“ (outbox, fewer than 2 confirmed copies, last sync, last check) und keinen Schlüssel.
2. **Gerät B** (iPhone, Englisch): Anmeldung mit demselben Signer, keine Zuordnung nötig. Das Spiel erscheint unter „Recent games“ und „Games 1“; im Archiv liegt es vollständig (`source: local`, drei Würfe, Lenas Platz mit dem Profil verbunden), die Spielerliste kennt Lena und Ben.
3. **Gerät C** (iPhone SE 320 × 548, Deutsch, alle Relays gestoppt): Neues Profil „Mia“ ohne Spiele. Die Profilkarte sagt „Spiele von deinen anderen Geräten erscheinen, sobald eine Verbindung besteht.“ statt „Noch keine X01-Spiele“; Profil › Spiele zeigt „Deine Spiele konnten noch nicht geladen werden“ mit „Erneut versuchen“; Erweitert zeigt „Nicht verfügbar · Noch nie“, 2 wartende Übertragungen (Profil und Relay-Liste) und „Kein Relay hat geantwortet.“. Nach dem Start der Relays und „Jetzt abgleichen“: „Vollständig“, 0 wartend, und Spiele sagt ehrlich „Noch keine Spiele“. Keine horizontale Bildlaufleiste bei 320 pt.
4. **Gerät D** (iPad quer 1024 × 768, Englisch, dunkel): Advanced mit dem Sync-Abschnitt („Last synced · Complete“).

Konsolenfehler: keine, abgesehen von den Verbindungsfehlern, die der Browser selbst für die absichtlich tote Adresse und die gestoppten Relays protokolliert.

## Bilder

| Datei | Inhalt |
| --- | --- |
| `screens/a-advanced-sync-de.jpg` | Gerät A, Profil › Erweitert mit Relays und Abgleich |
| `screens/b-profile-en.jpg` | Gerät B, Profil mit dem von Gerät A gekommenen Spiel |
| `screens/c-profile-se-unavailable.jpg` | Gerät C, Profilkarte ohne Verbindung |
| `screens/c-games-se-unavailable.jpg` | Gerät C, Profil › Spiele ohne Verbindung |
| `screens/c-advanced-se-unavailable.jpg` | Gerät C, Erweitert ohne Verbindung |
| `screens/c-advanced-se-complete.jpg` | Gerät C, Erweitert nach „Jetzt abgleichen“ |
| `screens/c-games-se-none.jpg` | Gerät C, Profil › Spiele nach dem Abgleich |
| `screens/d-advanced-ipad-en-dark.jpg` | Gerät D, Advanced auf dem iPad quer, dunkel |

## Nicht geprüft

Echte Geräte und Browser (Safari, Firefox, iOS, Android, installierte PWA), VoiceOver, echte Signer-Apps (Amber, nsec.app) und Erweiterungen, die fünf öffentlichen Relays (Annahme von Kind 30078, Aufbewahrung nach 24 Stunden und 7 Tagen).
