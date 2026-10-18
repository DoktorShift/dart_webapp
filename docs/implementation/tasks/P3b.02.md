# P3b.02 Abgleich und Konflikte

**Status:** Umgesetzt, Nachweis offen: Offline-Abend mit echten Geräten; Grenze bei nachgehender Uhr (STATUS SY-01); Bestätigung E8
**Paket:** P3b · **Planstelle:** [PLAN.md](../PLAN.md), Zeile 694; Zeilen 183–199 (Speicherung), 315 (Tombstones)

## Ziel

Mehrere Geräte eines Profils, auch nach einem Abend offline, kommen ohne Dubletten auf denselben Stand: Spiele sind unveränderliche Datensätze je ID mit Versionen, Löschungen bleiben gelöscht, kleine veränderliche Listen (Spieler, Relay-Liste) werden gelesen, gemischt und erst dann geschrieben.

## Produktregeln und Abnahmekriterien

- Betroffene Kriterien: A04, A08, A09, A11.
- PLAN.md „Zuverlässige Speicherung“: doppelte Events über IDs erkannt, Wiederholung mit demselben signierten Event, unsichere Ergebnisse führen zum Nachlesen; „Verwendung von NIP 51“: vor einer Änderung den aktuellen Stand laden; „Historie“: lokale Tombstones gegen Wiederauferstehung.
- [Entscheidung 0002](../../decisions/0002-architektur.md) §1 (lokal ist maßgeblich), §5 (unbekannt ist nicht leer).

## Voraussetzungen

- P3b.01 (diese Spur), P3a.02 (Outbox).

## Regeln

| Gegenstand | Regel | Ort |
| --- | --- | --- |
| Spiel | Datensatz je ID, Version (Lamport-Zähler `rev`, Geräte-ID als Entscheider bei Gleichstand). Eine Änderung auf diesem Gerät seit dem letzten Abgleich gewinnt (spätere Absicht): Löschung bleibt, Korrektur bleibt. Ohne eigene Änderung gilt die neuere Version der Relays, Löschungen eingeschlossen. Ausnahmen: das vollständige Spiel gewinnt gegen übernommene 1.0.0-Summen; Summen machen keine Löschung rückgängig. Eine Löschung ist nur, was hier absichtlich gelöscht wurde (`unarchive` hinterlässt eine Marke `deleted:<id>` im kv-Store); ein Spiel, das nur von diesem Gerät verschwand („Rangliste zurücksetzen“), wird nirgends gelöscht und kommt hier nicht zurück | `lib/sync/history.ts` `decideMatch`, `lib/storage/archive.ts` `deletedMatches` |
| Löschung | Tombstone-Version auf den Relays und lokale Kopie der Version; eine alte Kopie bringt das Spiel nie zurück; 1.0.0-Verlauf wird mit gelöscht, damit der Start es nicht erneut übernimmt | `history.ts`, `lib/storage/archive.ts` `applySynced`, `lib/storage/v1.ts` `replaceV1Records` |
| Spielerliste | Lesen, je Eintrag mischen (jüngere Änderung, spätestes Spieldatum), schreiben; was fehlt, wird als nächste Version geschrieben | `history.ts` `mergePlayers` |
| Relay-Liste und andere kleine Listen | Neueste Fassung der Relays lesen, Änderung darauf anwenden, dann signieren; ohne Antwort die eigene Fassung als Basis | `lib/sync/own-lists.ts` `changeOwnList` |
| Datenschlüssel | der früher erzeugte gewinnt (siehe P3b.01) | `lib/sync/data-key.ts` |
| Zustellung | Outbox mit Ergebnis je Relay; `duplicate:` ist eine Kopie; neue Fassung einer ersetzbaren Koordinate verdrängt die wartende | `lib/sync/outbox.ts` |
| Zeit | Die Uhr wird korrigiert, sobald Relays geantwortet haben; `created_at` einer neuen Version liegt über der Version auf den Relays (sonst behielten sie die alte), höchstens 15 Minuten vor der korrigierten Zeit; sonst wartet die Änderung („clock“) | `lib/sync/records.ts` `nextCreatedAt`, `lib/sync/data-key.ts` |

## Fehlerfälle

| Fall | Prüfung |
| --- | --- |
| Zwei Geräte spielen offline, danach beide abgleichen: alle Spiele je einmal, auf den Relays je eine Version | `tests/sync-history.test.ts`, `tests/relay/sync.test.ts` (Relays weg und wieder da, Inhalte verloren) |
| Löschung auf einem Gerät, ein Relay verpasst sie, ein neues Gerät trifft die alte Kopie | `tests/sync-history.test.ts` „a game deleted on one device“ |
| Doppelte und ungeordnete Zustellung: Teile in beliebiger Reihenfolge, Event zweimal | `tests/sync-records.test.ts`, `tests/sync-outbox.test.ts` |
| Verspätete Änderung: Datensatz mit niedrigerer Version trifft nach einer höheren ein | `tests/sync-records.test.ts` „the newest version wins“ |
| Nicht lesbare Inhalte: Teil fehlt, Datensatz in fremdem Slot, fremder Schlüssel | `tests/sync-records.test.ts` |
| Relay-Liste von zwei Geräten geändert: beide Einträge bleiben | `tests/relay/sync.test.ts` „a relay that is gone for good is replaced“ |
| Wartende Events überleben einen Neustart | `tests/sync-outbox.test.ts`, `tests/sync-history.test.ts` |
| „Rangliste zurücksetzen“ auf einem Gerät: nichts wird im Profil gelöscht, nichts kommt zurück; eine Löschung geht weiter überall hin | `tests/sync-history.test.ts` „resetting the Rangliste“ |
| Abmelden mit „alles löschen“ während eines Abgleichs: nichts bleibt, nichts wird später gelöscht | `tests/sync-history.test.ts` „signing out … during a sync“ |
| Uhr zehn Minuten zurück: die Löschung erreicht die Relays; 20 Minuten zurück: sie wartet mit Grund | `tests/sync-history.test.ts`, `tests/relay/sync.test.ts` |

## Abschlussnachweise

Siehe [P3b.01](P3b.01.md) (dieselben Läufe).

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch / PR | `wave2/sync` |
| Basiscommit | `a56d8ed` |
| Prüfcommit | Der Commit, der diese Karte einführt |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | wie [P3b.01](P3b.01.md) |
| Nicht ausgeführte Prüfungen | Konflikte mit mehr als zwei Geräten gleichzeitig; Uhren, die um Stunden abweichen, ohne dass die Korrektur über den eigenen Ursprung greift (die Streuung von zehn Minuten und 15 Minuten Überlappung beim Nachlesen bleiben die Annahme) |
| Verbleibende Einschränkungen | Ein Relay, das nur einen Teil der Teile eines großen Datensatzes hält, macht ihn dort unlesbar; die anderen Relays gleichen das beim vollständigen Abgleich aus. Gleichzeitige Änderung derselben Spielerliste auf zwei Geräten mischt je Eintrag, nicht je Feld |

## Stand im Integrationszweig (16. Oktober 2026)

| Punkt | Wert |
| --- | --- |
| Zusammengeführt | Spur `wave2/sync`, Endstand `f7bb861`, zusammengeführt in `871e237` (16. Oktober 2026) |
| Review | Review 1 (3 hoch, 4 mittel, 6 niedrig) und HIG 1 (3 mittel, 2 niedrig) → Korrektur `788dfab`/`c01e355`; Review 2: alle drei hohen Befunde halten, ein neuer hoher (Outbox-Schleife) und zwei niedrige → Korrektur `f7bb861`; Koordinator-Review |
| nostr-core-Version | 1.0.6 |
| Prüfungen der Spur | 16. Oktober 2026 auf `f7bb861`: `npm test` 516/516, Relay 31/31; beide neuen Tests scheitern gegen den alten Code. Browser 34/34 auf `788dfab` ([evidence/P3b](../evidence/P3b/README.md)); nach Korrektur 2 kein neuer Browserlauf |
| Prüfungen auf `nostr-plan` `4c4ce92` | 16. Oktober 2026, Prüfung beim Zusammenführen: `lint` und `typecheck` ohne Meldung, `npm test` 662 von 662, `npm run test:relay` 80 von 80 gegen lokale nak-Relays, `build` bestanden (`/` 71,1 kB, First Load 278 kB). Kein Browserlauf auf genau diesem Stand (P8.01). |
| Offen für die Abnahme | Offline-Abend mit echten Geräten; ein Gerät mit nachgehender Uhr ohne Zeitabgleich schreibt in die Vergangenheit; E8 (Rangliste zurücksetzen bleibt auf dem Gerät) |

## Nächster Schritt

E8 bestätigen; den Offline-Abend im P8-Ablauf und auf echten Geräten durchspielen.
