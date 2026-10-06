# P3b.02 Abgleich und Konflikte

**Status:** In Prüfung
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
| Spiel | Datensatz je ID, Version (Lamport-Zähler `rev`, Geräte-ID als Entscheider bei Gleichstand). Eine Änderung auf diesem Gerät seit dem letzten Abgleich gewinnt (spätere Absicht): Löschung bleibt, Korrektur bleibt. Ohne eigene Änderung gilt die neuere Version der Relays, Löschungen eingeschlossen. Ausnahmen: das vollständige Spiel gewinnt gegen übernommene 1.0.0-Summen; Summen machen keine Löschung rückgängig | `lib/sync/history.ts` `decideMatch` |
| Löschung | Tombstone-Version auf den Relays und lokale Kopie der Version; eine alte Kopie bringt das Spiel nie zurück; 1.0.0-Verlauf wird mit gelöscht, damit der Start es nicht erneut übernimmt | `history.ts`, `lib/storage/archive.ts` `applySynced`, `lib/storage/v1.ts` `replaceV1Records` |
| Spielerliste | Lesen, je Eintrag mischen (jüngere Änderung, spätestes Spieldatum), schreiben; was fehlt, wird als nächste Version geschrieben | `history.ts` `mergePlayers` |
| Relay-Liste und andere kleine Listen | Neueste Fassung der Relays lesen, Änderung darauf anwenden, dann signieren; ohne Antwort die eigene Fassung als Basis | `lib/sync/own-lists.ts` `changeOwnList` |
| Datenschlüssel | der früher erzeugte gewinnt (siehe P3b.01) | `lib/sync/data-key.ts` |
| Zustellung | Outbox mit Ergebnis je Relay; `duplicate:` ist eine Kopie; neue Fassung einer ersetzbaren Koordinate verdrängt die wartende | `lib/sync/outbox.ts` |

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
| Nicht ausgeführte Prüfungen | Konflikte mit mehr als zwei Geräten gleichzeitig; Uhren, die um Stunden abweichen (`created_at`-Streuung von zehn Minuten und 15 Minuten Überlappung beim Nachlesen sind die Annahme) |
| Verbleibende Einschränkungen | Ein Relay, das nur einen Teil der Teile eines großen Datensatzes hält, macht ihn dort unlesbar; die anderen Relays gleichen das beim vollständigen Abgleich aus. Gleichzeitige Änderung derselben Spielerliste auf zwei Geräten mischt je Eintrag, nicht je Feld |

## Nächster Schritt

Die Live-Spur auf die Outbox umstellen (Koordinator), damit Ergebnisse von Live-Spielen dieselben Regeln nutzen.
