# Status der Erweiterung

Stand: 5. Oktober 2026 · Branch `nostr-expansion` (Prüfstand für den Menschen: `nostr-welle-1`)

Diese Datei zuerst lesen, wenn die Arbeit fortgesetzt wird. Danach die Karte der aktiven Aufgabe und die dort verlinkten Planstellen und Entscheidungen.

## Aktueller Stand

| Punkt | Wert |
| --- | --- |
| Aktive Arbeit | **Welle 1 (Grundlagen) ist fertig und zusammengeführt.** Jede Spur hatte unabhängige Reviews mit Korrekturrunden: Turnierengine, Nostr-Schicht und lokale Daten je zwei, App-Rahmen zwei, Protokoll drei. Als Nächstes prüft der Nutzer den Stand selbst ([Prüfanleitung](REVIEW-WELLE-1.md)); danach Welle 2 (Profil, Abgleich, Geräte und Sicherung, Zahlungen, Live-Spiele). |
| Verbindliche Grundlage | [Entscheidung 0001](../decisions/0001-kein-eigenes-backend.md) und [Entscheidung 0002](../decisions/0002-architektur.md), §6 präzisiert am 5. Oktober 2026. Die Folgeentscheidungen F1 bis F9 in 0001 sind vorläufig, bis der Nutzer sie bestätigt. |
| Letzter nachgewiesener Stand | Zusammengeführter Stand `f9b226e` am 5. Oktober 2026: `lint` und `typecheck` ohne Meldung, `npm test` 414 von 414 unter Node 25.2.1 und Node 22.23.2, `npm run test:relay` 20 von 20 gegen lokale nak-Relays, `build` bestanden (`/` 58,8 kB, First Load 266 kB). Browserprüfungen gegen genau diesen Build: Abläufe 59 von 59 (Kameraprüfungen ohne Testvideos übersprungen), Zusammenspiel Rahmen und Daten 36 von 36. |
| Nicht nachgewiesen | Safari, Firefox, echte Geräte und Kameras, installierte PWA, VoiceOver, öffentliche Relays, echte Signer (Amber, nsec.app, Erweiterungen), externe Kryptoprüfung. |
| Nächster Schritt | Menschliches Review des Branches `nostr-welle-1`. Parallel die Nutzerentscheidungen unten. |

## Entscheidungen für den Nutzer

| Nr. | Frage | Wo beschrieben |
| --- | --- | --- |
| E1 | F1 bis F9 aus Entscheidung 0001 bestätigen oder ändern. | [0001](../decisions/0001-kein-eigenes-backend.md) |
| E2 | Einladungsnachweis als Signatur eines aus dem Link abgeleiteten Schlüssels statt HMAC (Änderung von 0002 §6). Folge: Jede Leitungsperson erstellt eigene Links. | [0002 §6](../decisions/0002-architektur.md), [P0.05](tasks/P0.05.md) |
| E3 | Grenzen ohne vertrauenswürdige Zeit hinnehmen oder absichern (Rückdatieren um Übergaben, Ü6 a bis d; acht Grenzen insgesamt). Optionen: mehrere Eigentümer oder Ersatzleitung, Übergabeangebote standardmäßig 24 Stunden, später Zeitnachweise nach NIP-03. | [conflicts.md](../protocol/conflicts.md), [P0.05](tasks/P0.05.md) |
| E4 | Mitgliedergrenze geschlossener Clubs: Verdrängung an der Grenze von 100 (offene Nutzerentscheidung 7). | [club.md](../protocol/families/club.md), [P0.05](tasks/P0.05.md) |
| E5 | Startseite: +4,6 kB gzip durch den App-Rahmen (vor allem neue Texte), nach Zusammenführung 261 kB gzip; die vorgeschlagene Grenze von 5 kB gilt erst nach Freigabe. | [DESIGN.md](evidence/P0.07/DESIGN.md) |
| E6 | Referenzgerät für die Eingabelatenz und Testpersonen für die Nutzertests (A29). | [P0.07](tasks/P0.07.md) |
| E7 | Domain, Freigabe eines Schreibtests auf öffentlichen Relays (sieben Tage auf dem kritischen Pfad). | [Risikobericht](evidence/P0.01/RISKS-P0.02-P0.07.md) |

## Offene Befunde

| ID | Befund | Auswirkung | Umgang |
| --- | --- | --- | --- |
| BL-01 | Nach dem matchentscheidenden Dart zeigt die Kachel des Siegers einen zu hohen Live-Average (`components/game/scoreboards.tsx:173`). | Gering; das Ergebnisfenster verdeckt die Kachel und zeigt den richtigen Wert. | Nicht in diesem Branch. Vorschlag: kleiner Fix auf `main`; Entscheidung beim Nutzer. |
| BL-02 | Spielernamen sind auf 16 Zeichen begrenzt; Nostr-Namen können länger sein. | Gestaltungsvorgabe für neue Ansichten. | In P0.02, P0.07 und P2.01 als Regel ohne Kürzung mit „…“. |
| BL-03 | Node 22 warnt `MODULE_TYPELESS_PACKAGE_JSON`. | Keine. | Offen gelassen. |
| BL-04 | Dependabot-Branch `next-15.5.15` ist überholt. | Keine. | Kann geschlossen werden; Nutzer. |
| ST-01 | Die Karte P0.01 sagt „Kein App-Code, keine Abhängigkeiten“. Commit `db81218` fügt aber Abhängigkeiten hinzu (nostr-core 1.0.4, `@noble/*`, `@scure/base`, jsQR, fake-indexeddb, Playwright) sowie das i18n-Gerüst `lib/i18n/features/*` und Einträge in `lib/i18n/de.ts` und `en.ts`. | Karte und Lieferung stimmen nicht überein; der Build mit den neuen Abhängigkeiten ist nicht nachgewiesen. | Im Review klären und Karte oder Lieferung angleichen; `build` erneut ausführen. |
| PR-12 | 0002 wählte zuerst die Kinds 1501, 31501 und 21501; der offene NIP-PR #2272 (Golf) verwendet 1501 und 31501. | Erledigt. | Kinds 1180/31180/21180 (Entscheidung 0002, umgesetzt in P0.05). |
| RB-03 | 0002 nahm bei Einladungen die ersten Nutzungen nach `created_at` auf; den Wert setzt der Beitretende selbst. | Erledigt bis auf E4. | P0.05: Gruppenlink nimmt sofort auf, persönliche Einladung und Anfrage brauchen die Annahme einer berechtigten Rolle. Ausnahme an der Mitgliedergrenze geschlossener Clubs (E4). |
| OP-14 | 0002 Abschnitt 5 zählt eine Kopie ab `OK true`. Relays sagen keine Aufbewahrung zu. | „Gesichert“ könnte zu früh erscheinen. | Private Kopien und Passkey-Paket erst nach Rücklesen über eine neue Verbindung werten; als Präzisierung von 0002. |
| NB-19 | `/icon/*` wird in 1.0.0 beim ersten Abruf vom Netlify-Server-Handler gerendert. F6 verlangt ausschließlich vorgerenderte Seiten. | Eine Build-Prüfung auf dynamische Routen schlägt heute fehl. | Icon-Route im Branch statisch machen (P0.06). |
| RB-02 | 0002 nennt einen 12-stelligen Ersatzcode mit 60 Bit. Mit Ziffern wären es nur rund 40 Bit. | Erledigt. | `lib/protocol/pairing.ts`: 12 Zeichen Crockford-Base32 = 60 Bit. |
| NB-24 | Für A16, A21 und die verlustfreie Migration der v1-Daten fehlen noch Klarstellungen. | Abnahme dieser Punkte unklar. | Umsetzer entwirft, Nutzer bestätigt. |
| W1-01 | `npm audit` meldet 7 hohe Befunde, alle in Entwicklungswerkzeugen (`eslint-config-next`, `tailwindcss` über `braces`/`micromatch`). Ohne Entwicklungspakete: 0. Gleich auf `main` (1.0.0). | Keine für Spieler. | Wartung unabhängig von dieser Erweiterung. |
| W1-02 | Die dauerhafte Outbox (Teil von P3a.02) fehlt noch. | Ohne sie gibt es noch kein Veröffentlichen aus der App. | In Welle 2 (Spur Abgleich). |
| W1-03 | Die Ergänzungen in `lib/nostr/ext/` sind noch nicht in nostr-core übernommen. | Laufen lokal und getestet; das Ziel bleibt nostr-core. | Upstream-PRs und Release durch den Maintainer (P3a.01). |

## Arbeitspunkte

Reihenfolge und Titel wie in [PLAN.md](PLAN.md), Zeilen 658 bis 730. „Betroffen von 0001“ heißt: Umfang, Text oder Abnahme des Punkts ändert sich durch die Entscheidung gegen ein eigenes Backend (Abschnitt „Kein eigenes Backend“ im Risikobericht).

| ID | Arbeitspunkt | Status | Betroffen von Entscheidung 0001 | Grund |
| --- | --- | --- | --- | --- |
| P0.01 | Ausgangsstand und Arbeitsablage | In Prüfung | ja | Entscheidung 0001 und Analyse der Planstellen erstellt |
| P0.02 | Bedienmodell | In Prüfung (Navigationsteil) | ja | Hinweise nur bei offener App, ehrliche Sicherungstexte, Wartezustände |
| P0.03 | Core-Abdeckung | In Prüfung | ja | NIP-49, NIP-46 und Signer-Verschlüsselung werden ohne Server zwingend |
| P0.04 | Geräte und Wiederherstellung | Offen | ja | Sicherungs- und Kopplungsdienst entfallen (F1, F9) |
| P0.05 | Protokoll und Befugnisse | In Prüfung | ja | Kein privater Relay, kein Aussteller, Einladungen ohne Server |
| P0.06 | Betrieb und Empfang | Offen | ja | Kein Serverbetrieb; Domain, Relays, Aufbewahrungstest, Hosting |
| P0.07 | Gestaltungsgrundlage | In Prüfung | ja | Lastziele hängen an fremden Relays |
| P1.01 | IDs und Archive | In Prüfung | nein | |
| P1.02 | Migration und Schreiben | In Prüfung | nein | |
| P1.03 | Statistik und Export | In Prüfung | ja | Export wird das Sicherheitsnetz; Löschen privater Kopien nur als Bitte |
| P3a.01 | Core-Ergänzungen | Wartet auf Nachweis | ja | NIP-49 als Hauptweg der Sicherung, Signer-Varianten für Gift Wraps |
| P3a.02 | Transport und Validierung | In Arbeit | ja | Anmeldung und Outbox gegen öffentliche statt eigene Relays |
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
| P6.01 | Turnierengine | In Prüfung | nein | |
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

Zusammen: 37 Punkte. In Prüfung 9, In Arbeit 1, Wartet auf Nachweis 1, Offen 26. Von 0001 betroffen: 28, nicht betroffen: 9.
