# P3a.02 Transport und Validierung

**Status:** In Prüfung (Outbox gebaut; Familienprüfung je Event folgt mit den Bereichen)
**Paket:** P3a · **Planstelle:** [PLAN.md](../PLAN.md), Zeile 680

## Ziel

Die App spricht über einen einzigen geprüften Weg mit Relays und Signern: ein Core-Zugang, Signer-Adapter, die jede Signatur prüfen, Authentifizierung bei Relays, die sie verlangen, und eine persistente Outbox, die Veröffentlichungen über Neustarts hinweg zu Ende bringt.

## Produktregeln und Abnahmekriterien

- Betroffene Kriterien: A03, A04, A09 bis A12, A25.
- [Entscheidung 0002](../../decisions/0002-architektur.md) Abschnitt 4 (jede Signatur geprüft) und Abschnitt 5 („veröffentlicht“ ab zwei Betreibern, unbekannt ist nicht leer, Fehlendes beim Öffnen erneut senden).

## Voraussetzungen

- P0.03 (In Prüfung) und P3a.01 (Wartet auf Nachweis).
- Für die Outbox: IndexedDB-Store `outbox` aus P1.01/P1.02 (`lib/storage`) und `lib/sync` (eigene Arbeitspunkte).
- Für die Eventprüfung je Familie: Verträge aus P0.05 (`lib/protocol`).

## Umfang und Stand

| Teil | Stand | Ort |
| --- | --- | --- |
| Einziger Core-Zugang | Erledigt | `lib/nostr/core.ts`, `runtime.ts`, `tests/nostr-boundary.test.ts` |
| Signer-Adapter (lokal, NIP-07, NIP-46 bunker:// und nostrconnect://, Fortsetzen) | Erledigt; NIP-55-Bausteine in `ext/nip55.ts`, die Sitzung dazu baut `lib/profile` | `lib/nostr/signers.ts` |
| Prüfung signierter Events | Erledigt für Signaturen, Schlüssel und unveränderte Vorlage; eingehende Events prüft nostr-core beim Empfang | `verifyingSigner`, `verifySignedEvent` |
| Prüfung von Badges, Zaps, Rechnungen, Gift Wraps | Erledigt | `lib/nostr/ext/validate.ts`, `crypto.ts` |
| NIP-42 | Erledigt | `lib/nostr/client.ts` |
| Ergebnis je Relay und „veröffentlicht“ ab zwei Betreibern | Erledigt als Bausteine (`publish`, `isPublished`) | `client.ts`, `relays.ts` |
| Persistente Outbox: signierte Events mit Zielrelays und Zustellregel im Store `outbox`, Ergebnis je Relay, Wiederholung mit begrenztem Backoff und Jitter, `rate-limited:`/`mute:`/keine Antwort wiederholbar, `invalid:`/`blocked:`/`restricted:`/`pow:` endgültig, Zusammenfassen je Koordinate, fehlende Kopien beim Start erneut, ein Sender je Browser (Web Locks: die Sperre deckt nur den Zustand der Warteschlange, nie das Senden; eine Runde wählt unter der Sperre und verleiht die Einträge für 30 s, sendet ohne sie und trägt die Antworten unter der Sperre ein), nach einer Woche aufgegeben | Erledigt (Fix-Runde 1: Sperre und Aufgeben) | `lib/sync/outbox.ts`; `lib/sync/publish.ts` reiht ein |
| Prüfung der BlueLine-Eventfamilien | **Offen** | `lib/protocol` nach P0.05 |

## Fehlerfälle

Die Fälle des Transports und der Signer stehen in der Karte [P0.03](P0.03.md). Outbox (`tests/sync-outbox.test.ts`, `tests/relay/sync.test.ts`): Abbruch mitten im Senden und Neustart der App (wartende Einträge bleiben, gehen nach dem Neustart hinaus), Relay lehnt dauerhaft ab (`invalid:`, `blocked:`) gegen vorübergehend (`rate-limited:`, `mute:`, `timeout`, `unreachable`), derselbe Inhalt zweimal in der Warteschlange (ein Eintrag; `duplicate:` zählt als Kopie), zwei Relays eines Betreibers zählen als eine Kopie, Relay weg und wieder da, Einreihen wartet nie hinter dem Senden einer laufenden Runde, ein Eintrag in einer Runde bleibt von einer zweiten unberührt, ein Eintrag ohne endgültige Antwort wird nach einer Woche aufgegeben.

## Abschlussnachweise

| Nachweis | Ort |
| --- | --- |
| Transport, Signer, Authentifizierung | [evidence/P0.03/CORE.md](../evidence/P0.03/CORE.md), Tests `nostr-client`, `nostr-signers`, `nostr-nip46`, `relay/*` |
| Outbox über Neustarts, Selbstheilung beim Öffnen | `tests/sync-outbox.test.ts` (12 Fälle), `tests/relay/sync.test.ts` („Relay weg und wieder da“), Browserlauf [P3b/scripts/sync-checks.mjs](../evidence/P3b/scripts/sync-checks.mjs) (Gerät C: Profil ohne erreichbares Relay, nach „Jetzt abgleichen“ alles gesendet) |
| Grenzfälle mit unabhängigen Testdaten je Eventfamilie | Ausstehend (nach P0.05) |

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch | `wave1/nostr` (Transport), `wave2/sync` (Outbox) |
| Basiscommit | `fd4e6c51639f1721bd5e1f01619eeaf6f2f22da5` |
| Prüfcommit | Der Commit, der diese Karte einführt |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | Wie [P0.03](P0.03.md) |
| Nicht ausgeführte Prüfungen | Familienprüfung je Eventfamilie (kommt mit den Bereichen Clubs, Turniere, Live); keine öffentlichen Relays (E7) |
| Verbleibende Einschränkungen | Siehe Tabelle „Umfang und Stand“ |

## Nächster Schritt

Live-Spiele (`lib/live/board.ts`) auf `enqueue()` der Outbox umstellen (Koordinator nach dem Zusammenführen), dann der Schreibtest auf den öffentlichen Zielen.
