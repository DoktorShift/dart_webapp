# Status der Erweiterung

Stand: 4. Oktober 2026 · Branch `nostr-expansion`

Diese Datei zuerst lesen, wenn die Arbeit fortgesetzt wird. Danach die Karte der aktiven Aufgabe und die dort verlinkten Planstellen und Entscheidungen.

## Aktueller Stand

| Punkt | Wert |
| --- | --- |
| Aktive Arbeit | **P0.01** ist in Prüfung (Review durch Codex). Parallel in Arbeit, in eigenen Branches `wave1/*`: P0.02, P0.03, P0.05, P0.07, P1.01 bis P1.03 und P6.01. |
| Verbindliche Grundlage | [Entscheidung 0001](../decisions/0001-kein-eigenes-backend.md) (kein eigenes Backend, nur nostr-core) und [Entscheidung 0002](../decisions/0002-architektur.md) (Architektur). Die Folgeentscheidungen F1 bis F9 in 0001 sind vorläufig, bis der Nutzer sie bestätigt. |
| Letzter nachgewiesener Stand | Basiscommit `e6ff77e` (1.0.0): `lint`, `typecheck`, `test` 40 von 40 und `build` bestanden unter Node 25.2.1, `test` und `build` zusätzlich unter Node 22.23.3; Gastablauf und Größenmatrix im Browser geprüft ([BASELINE](evidence/P0.01/BASELINE.md)). |
| Nachprüfung im Branch | Am 4. Oktober 2026 auf `b52d71c` unter Node 25.2.1: `lint` ohne Meldung, `typecheck` bestanden, `test` 40 von 40. `build` und Browserprüfungen wurden nach den neuen Abhängigkeiten aus `db81218` nicht wiederholt. |
| Risiken | [Risikobericht P0.02 bis P0.07](evidence/P0.01/RISKS-P0.02-P0.07.md), einschließlich der Folgen von Entscheidung 0001 und der Liste der Nutzerentscheidungen. |
| Nächster Schritt | Review von P0.01. Parallel klärt der Nutzer die dringendsten Punkte aus dem Risikobericht: Domain, Bestätigung von F1 bis F9, Freigabe des Schreibtests auf öffentlichen Relays (sieben Tage auf dem kritischen Pfad), Geräte und Testpersonen. |

## Offene Befunde

| ID | Befund | Auswirkung | Umgang |
| --- | --- | --- | --- |
| BL-01 | Nach dem matchentscheidenden Dart zeigt die Kachel des Siegers einen zu hohen Live-Average (`components/game/scoreboards.tsx:173`). | Gering; das Ergebnisfenster verdeckt die Kachel und zeigt den richtigen Wert. | Nicht in diesem Branch. Vorschlag: kleiner Fix auf `main`; Entscheidung beim Nutzer. |
| BL-02 | Spielernamen sind auf 16 Zeichen begrenzt; Nostr-Namen können länger sein. | Gestaltungsvorgabe für neue Ansichten. | In P0.02, P0.07 und P2.01 als Regel ohne Kürzung mit „…“. |
| BL-03 | Node 22 warnt `MODULE_TYPELESS_PACKAGE_JSON`. | Keine. | Offen gelassen. |
| BL-04 | Dependabot-Branch `next-15.5.15` ist überholt. | Keine. | Kann geschlossen werden; Nutzer. |
| ST-01 | Die Karte P0.01 sagt „Kein App-Code, keine Abhängigkeiten“. Commit `db81218` fügt aber Abhängigkeiten hinzu (nostr-core 1.0.4, `@noble/*`, `@scure/base`, jsQR, fake-indexeddb, Playwright) sowie das i18n-Gerüst `lib/i18n/features/*` und Einträge in `lib/i18n/de.ts` und `en.ts`. | Karte und Lieferung stimmen nicht überein; der Build mit den neuen Abhängigkeiten ist nicht nachgewiesen. | Im Review klären und Karte oder Lieferung angleichen; `build` erneut ausführen. |
| PR-12 | 0002 wählt die Kinds 1501, 31501 und 21501. Der offene NIP-PR #2272 (Golf) verwendet 1501 und 31501. | Mögliche Kollision mit einem künftigen Standard. | Vor dem Festschreiben in P0.05 neu entscheiden (neue Entscheidung nötig). |
| RB-03 | 0002 nimmt bei Einladungen die ersten Nutzungen nach `created_at` auf; den Wert setzt der Beitretende selbst. 0001 Punkt 10 macht die berechtigte Rolle maßgeblich. | Rückdatieren möglich; Clients können verschiedene Mitgliederlisten errechnen. | In P0.05 präzisieren; Nutzerentscheidung zum Beitritt ohne Admin-Gerät. |
| OP-14 | 0002 Abschnitt 5 zählt eine Kopie ab `OK true`. Relays sagen keine Aufbewahrung zu. | „Gesichert“ könnte zu früh erscheinen. | Private Kopien und Passkey-Paket erst nach Rücklesen über eine neue Verbindung werten; als Präzisierung von 0002. |
| NB-19 | `/icon/*` wird in 1.0.0 beim ersten Abruf vom Netlify-Server-Handler gerendert. F6 verlangt ausschließlich vorgerenderte Seiten. | Eine Build-Prüfung auf dynamische Routen schlägt heute fehl. | Icon-Route im Branch statisch machen (P0.06). |
| RB-02 | 0002 nennt einen 12-stelligen Ersatzcode mit 60 Bit. Mit Ziffern wären es nur rund 40 Bit. | Schwächerer Code als entschieden. | Alphabet mit 32 Zeichen festlegen (P0.04, P0.05). |
| NB-24 | Für A16, A21 und die verlustfreie Migration der v1-Daten fehlen noch Klarstellungen. | Abnahme dieser Punkte unklar. | Umsetzer entwirft, Nutzer bestätigt. |

## Arbeitspunkte

Reihenfolge und Titel wie in [PLAN.md](PLAN.md), Zeilen 658 bis 730. „Betroffen von 0001“ heißt: Umfang, Text oder Abnahme des Punkts ändert sich durch die Entscheidung gegen ein eigenes Backend (Abschnitt „Kein eigenes Backend“ im Risikobericht).

| ID | Arbeitspunkt | Status | Betroffen von Entscheidung 0001 | Grund |
| --- | --- | --- | --- | --- |
| P0.01 | Ausgangsstand und Arbeitsablage | In Prüfung | ja | Entscheidung 0001 und Analyse der Planstellen erstellt |
| P0.02 | Bedienmodell | In Arbeit | ja | Hinweise nur bei offener App, ehrliche Sicherungstexte, Wartezustände |
| P0.03 | Core-Abdeckung | In Arbeit | ja | NIP-49, NIP-46 und Signer-Verschlüsselung werden ohne Server zwingend |
| P0.04 | Geräte und Wiederherstellung | Offen | ja | Sicherungs- und Kopplungsdienst entfallen (F1, F9) |
| P0.05 | Protokoll und Befugnisse | In Arbeit | ja | Kein privater Relay, kein Aussteller, Einladungen ohne Server |
| P0.06 | Betrieb und Empfang | Offen | ja | Kein Serverbetrieb; Domain, Relays, Aufbewahrungstest, Hosting |
| P0.07 | Gestaltungsgrundlage | In Arbeit | ja | Lastziele hängen an fremden Relays |
| P1.01 | IDs und Archive | In Arbeit | nein | |
| P1.02 | Migration und Schreiben | In Arbeit | nein | |
| P1.03 | Statistik und Export | In Arbeit | ja | Export wird das Sicherheitsnetz; Löschen privater Kopien nur als Bitte |
| P3a.01 | Core-Ergänzungen | Offen | ja | NIP-49 als Hauptweg der Sicherung, Signer-Varianten für Gift Wraps |
| P3a.02 | Transport und Validierung | Offen | ja | Anmeldung und Outbox gegen öffentliche statt eigene Relays |
| P3a.03 | Profilverteilung und Listen | Offen | nein | |
| P2.01 | Kontextprofil und Ansichten | Offen | ja | Keine Uploads, fremde Bilder direkt, Profillinks über Fragment |
| P2.02 | Externe Zugänge | Offen | nein | |
| P2.03 | Eigenes Gerät koppeln | Offen | ja | Kopplung über öffentliche Relays statt Kopplungsdienst |
| P2.04 | Zugang sichern | Offen | ja | Sicherungsdatei und Passkey-Paket statt Sicherungsdienst |
| P3b.01 | Private Daten | Offen | ja | Verschlüsselt auf öffentlichen Relays statt zugriffsbeschränkt |
| P3b.02 | Abgleich und Konflikte | Offen | ja | Löschen und Tombstones nur als Bitte an Relays |
| P3b.03 | Portabilität | Offen | ja | Wechsel des Speicherdienstes wird Wechsel der Relays aus der lokalen Kopie |
| P4.01 | Teilnahme und Board | Offen | ja | Widerruf von Board-Sitzungen nur signiert |
| P4.02 | Schreiben und Zuschauen | Offen | ja | Live-Ziel hängt an Grenzen fremder Relays |
| P4.03 | Ergebnislebenszyklus | Offen | nein | |
| P5.01 | Clubbetrieb | Offen | ja | Geschlossene Daten nur verschlüsselt, Einladungen ohne Server, keine Uploads |
| P5.02 | Saison und Übergabe | Offen | ja | Schlüsselwechsel und Clubexport ohne Serverbackups |
| P6.01 | Turnierengine | In Arbeit | nein | |
| P6.02 | Teilnahme | Offen | ja | Anmeldung, Warteliste und Fristen ohne vertrauenswürdige Zeit |
| P6.03 | Leitungsbetrieb | Offen | ja | Aufruf nur bei offener App |
| P6.04 | Darstellung und Last | Offen | ja | Last mit 128 und 16 Boards über öffentliche Relays |
| P7a.01 | Voraussetzungen und Vergabe | Offen | ja | Kein Ausstellerdienst (F3) |
| P7a.02 | Profil und Austausch | Offen | ja | Kennzeichnung „Selbst erreicht“ und Veranstalter als Aussteller |
| P7b.01 | Verbindung | Offen | nein | |
| P7b.02 | Zahlungsablauf | Offen | ja | Euro-Näherung über öffentliche Kurs-API (F4) |
| P7b.03 | Zap und Wallet-Abnahme | Offen | ja | LNURL direkt aus dem Browser, kein Proxy |
| P8.01 | Gesamter Spielabend | Offen | nein | |
| P8.02 | Produktqualität | Offen | nein | |
| P8.03 | Betrieb und Freigabe | Offen | ja | Keine Dienst-Wiederherstellung und keine Serverbackups |

Zusammen: 37 Punkte. In Prüfung 1, In Arbeit 8, Offen 28. Von 0001 betroffen: 28, nicht betroffen: 9.
