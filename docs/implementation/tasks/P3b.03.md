# P3b.03 Portabilität

**Status:** Umgesetzt, Nachweis offen: Wiederaufbau auf sauberem echten Gerät, Export mit unabhängiger Implementierung (A20, E11), Wechsel eines ausgefallenen Relays im Feld
**Paket:** P3b · **Planstelle:** [PLAN.md](../PLAN.md), Zeile 696; A07, A20

## Ziel

Der Bestand eines Profils ist nicht an ein Gerät oder ein Relay gebunden: ein sauberes Gerät baut ihn aus den Relay-Kopien wieder auf, ein ausgefallener Speicherweg wird durch ein neues Relay ersetzt, und der portable Export bleibt das Sicherheitsnetz.

## Produktregeln und Abnahmekriterien

- A07 (Fassung aus [Entscheidung 0001](../../decisions/0001-kein-eigenes-backend.md)): private Historie aus den Relay-Kopien, soweit sie noch vorliegen, oder aus einem Export; vollständig, teilweise und nicht mehr abrufbar unterschieden.
- A20: Export mit unabhängiger Implementierung lesbar (P1.03: JSON-Datei); Wiederaufbau auf sauberem Gerät.
- [Entscheidung 0001](../../decisions/0001-kein-eigenes-backend.md) „Was ohne Backend nicht möglich ist“ 2: keine zugesicherte Aufbewahrung bei Relays.

## Voraussetzungen

- P1.03 (Export, Import), P3b.01, P3b.02.

## Umfang und Stand

| Weg | Stand | Nachweis |
| --- | --- | --- |
| Wiederaufbau auf sauberem Gerät aus den Relay-Kopien (Profil per Signer-App verbunden, Spiele und Spieler kommen ohne Zutun) | Erledigt | Browserlauf Gerät B, `tests/relay/sync.test.ts` „a new device reads them back“ |
| Wechsel eines ausgefallenen Speicherwegs: neues Relay unter Erweitert (NIP-11-Prüfung), der nächste vollständige Abgleich kopiert alles dorthin; ein neues Gerät findet den Bestand ohne das ausgefallene Relay | Erledigt | `tests/relay/sync.test.ts` „a relay that is gone for good is replaced“, Browserlauf Gerät A (Relay hinzufügen, danach alle Datensätze dort) |
| Relay verliert seinen Inhalt (Neustart): fehlende Kopien werden beim nächsten vollständigen Abgleich gefunden und erneut gesendet | Erledigt | `tests/relay/sync.test.ts` „a relay down and up again“ |
| Portabler Export und Import | P1.03 (unverändert) | `tests/storage-data.test.ts` |
| Wiederherstellung ohne Ursprungsgerät: Sicherungsdatei, Passkey, Kopplung | Spuren Sicherung und Geräte | — |

## Fehlerfälle

| Fall | Verhalten |
| --- | --- |
| Alle Relays verloren, kein anderes Gerät | Bestand nur noch lokal beziehungsweise im Export; Erweitert zeigt „Nicht verfügbar“; keine falsche Leere |
| Ein Relay nimmt 30078 nicht an (`invalid:`, `blocked:`) | Endgültig für dieses Event; die Outbox zählt es nicht als Kopie; unter Erweitert als „Noch nicht gesendet“, solange die Regel nicht erfüllt ist, und in der Diagnose („fewer than 2 confirmed copies“) |
| Neues Relay antwortet nicht auf NIP-11 | wird nicht aufgenommen („Unter dieser Adresse antwortet kein Relay.“) |

## Abschlussnachweise

Siehe [P3b.01](P3b.01.md).

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch / PR | `wave2/sync` |
| Basiscommit | `a56d8ed` |
| Prüfcommit | Der Commit, der diese Karte einführt |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | wie [P3b.01](P3b.01.md) |
| Nicht ausgeführte Prüfungen | Öffentliche Relays; Export-Import-Rundlauf über ein Profil hinweg auf echten Geräten |
| Verbleibende Einschränkungen | Die vier allgemeinen Relays der App bleiben immer Ziel; ein ausgefallenes Standardrelay lässt sich ergänzen, nicht entfernen (es stört nicht, kostet aber einen Verbindungsversuch je Abgleich) |

## Stand im Integrationszweig (16. Oktober 2026)

| Punkt | Wert |
| --- | --- |
| Zusammengeführt | Spur `wave2/sync`, Endstand `f7bb861`, zusammengeführt in `871e237` (16. Oktober 2026); Wiederherstellung aus Sicherungsdatei und Passkey mit Geräte und Sicherung (`291f4e9`) |
| Review | Review 1 (3 hoch, 4 mittel, 6 niedrig) und HIG 1 (3 mittel, 2 niedrig) → Korrektur `788dfab`/`c01e355`; Review 2: alle drei hohen Befunde halten, ein neuer hoher (Outbox-Schleife) und zwei niedrige → Korrektur `f7bb861`; Koordinator-Review |
| nostr-core-Version | 1.0.6 |
| Prüfungen der Spur | 16. Oktober 2026 auf `f7bb861`: `npm test` 516/516, Relay 31/31; beide neuen Tests scheitern gegen den alten Code. Browser 34/34 auf `788dfab` ([evidence/P3b](../evidence/P3b/README.md)); nach Korrektur 2 kein neuer Browserlauf |
| Prüfungen auf `nostr-plan` `4c4ce92` | 16. Oktober 2026, Prüfung beim Zusammenführen: `lint` und `typecheck` ohne Meldung, `npm test` 662 von 662, `npm run test:relay` 80 von 80 gegen lokale nak-Relays, `build` bestanden (`/` 71,1 kB, First Load 278 kB). Kein Browserlauf auf genau diesem Stand (P8.01). |
| Offen für die Abnahme | Wiederherstellung ohne Ursprungsgerät lief nur im Browser (Datei echt, Passkey simuliert, siehe P2.04); kein unabhängiger Leser des Exports; E11 |

## Nächster Schritt

E11 klären; dann Wiederaufbau aus Sicherungsdatei plus Relay-Kopien auf einem sauberen echten Gerät.
