# P3a.02 Transport und Validierung

**Status:** In Arbeit
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
| Persistente Outbox | **Offen** | `lib/sync` mit dem Store `outbox` |
| Prüfung der BlueLine-Eventfamilien | **Offen** | `lib/protocol` nach P0.05 |

## Fehlerfälle

Die Fälle des Transports und der Signer stehen in der Karte [P0.03](P0.03.md). Für die Outbox festzulegen: Abbruch mitten im Senden, Neustart der App, Relay lehnt dauerhaft ab (`invalid:`, `blocked:`) gegen vorübergehend (`rate-limited:`, `timeout`, `unreachable`), derselbe Inhalt zweimal in der Warteschlange.

## Abschlussnachweise

| Nachweis | Ort |
| --- | --- |
| Transport, Signer, Authentifizierung | [evidence/P0.03/CORE.md](../evidence/P0.03/CORE.md), Tests `nostr-client`, `nostr-signers`, `nostr-nip46`, `relay/*` |
| Outbox über Neustarts, Selbstheilung beim Öffnen | Ausstehend |
| Grenzfälle mit unabhängigen Testdaten je Eventfamilie | Ausstehend (nach P0.05) |

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch | `wave1/nostr` |
| Basiscommit | `fd4e6c51639f1721bd5e1f01619eeaf6f2f22da5` |
| Prüfcommit | Der Commit, der diese Karte einführt |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | Wie [P0.03](P0.03.md) |
| Nicht ausgeführte Prüfungen | Outbox und Familienprüfung, weil nicht gebaut |
| Verbleibende Einschränkungen | Siehe Tabelle „Umfang und Stand“ |

## Nächster Schritt

Die Outbox in `lib/sync` auf `publish()` und dem Store `outbox` aufbauen, sobald `lib/storage` im Integrationsbranch liegt.
