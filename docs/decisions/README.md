# Entscheidungen

Hier stehen begründete Produkt- und Technikentscheidungen für die Erweiterung von BlueLine Darts. Jede Entscheidung bekommt eine fortlaufende Nummer und bleibt erhalten, auch wenn eine spätere sie ersetzt.

| Nr. | Entscheidung | Status | Datum |
| --- | --- | --- | --- |
| [0001](0001-kein-eigenes-backend.md) | Kein eigenes Backend; Nostr und Lightning ausschließlich über nostr-core | Angenommen | 4. Oktober 2026 |
| [0002](0002-architektur.md) | Architektur der Erweiterung: Module, Speicherung, Signer, Relays, Events, Oberfläche | Angenommen (§6 präzisiert am 5. Oktober 2026; §2 und §6 ergänzt am 6. Oktober 2026: `lib/live` darf `lib/storage` und `lib/profile/vault.ts` nutzen, Freundschaftsspiele mit Autoritätsschlüssel je Spiel) | 4. Oktober 2026 |
| [0003](0003-spielerzuordnungen.md) | Spielerzuordnungen erhalten und synchronisieren | Angenommen; Umsetzung offen | 28. Oktober 2026 |

## Aufbau einer Entscheidung

Dateiname `NNNN-kurzer-titel.md`. Inhalt:

1. **Status:** Vorgeschlagen, Angenommen, Ersetzt durch NNNN oder Verworfen.
2. **Kontext:** Warum die Frage ansteht.
3. **Entscheidung:** Was gilt, in klaren Sätzen.
4. **Folgen:** Was dadurch einfacher, schwieriger oder unmöglich wird.
5. **Betroffene Planstellen:** Kapitel, Arbeitspunkte und Abnahmekriterien in [PLAN.md](../implementation/PLAN.md), die angepasst werden.

Produktentscheidungen trifft der Nutzer. Routinemäßige technische Entscheidungen trifft der Umsetzer mit Begründung; der Reviewer bewertet sie.
