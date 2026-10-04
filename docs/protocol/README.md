# BlueLine Darts Protokoll

Hier entsteht das offen beschriebene Darts-Format für Nostr: JSON-Schemas, Beispiele, Testvektoren und Versionsregeln je Eventfamilie. Grundlage ist das Kapitel „Ereignismodell und eigenes Darts Format“ in [PLAN.md](../implementation/PLAN.md).

Stand: noch leer. Die Event-Verträge, die Kind-Auswahl und die Rechte werden in **P0.05** festgelegt. Bis dahin gilt hier nichts als Standard.

## Geplanter Aufbau

| Ordner oder Datei | Inhalt |
| --- | --- |
| `kinds.md` | Gewählte Kind-Nummern mit Kollisionsprüfung und Datum |
| `families/<name>.md` | Vertrag je Eventfamilie: Kind, Tags, Inhalt, Autor, Empfänger, Referenzen, Sichtbarkeit, Aufbewahrung, Löschung, Versionsregeln |
| `schemas/<name>.schema.json` | JSON-Schema je Inhalt |
| `vectors/<name>/` | Testvektoren: Eingabe, erwartetes Ergebnis, Begründung; unabhängig von der Implementierung hergeleitet |
| `permissions.md` | Rollenmatrix für Club, Turnier, Match und Profil |

## Feste Regeln

- Alle Nostr-Funktionen der App laufen über nostr-core ([Entscheidung 0001](../decisions/0001-kein-eigenes-backend.md)).
- Es gibt keinen eigenen Relay und keinen eigenen Server. Jede Eventfamilie muss mit öffentlichen Relays und lokaler Speicherung funktionieren.
- Unbekannte Versionen werden erhalten, aber nicht als bekannte Regeln ausgeführt.
