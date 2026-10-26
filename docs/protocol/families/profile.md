# Familie: Profil

Stand: P2.01 und P3a.03, 5. Oktober 2026. Code: [`profile.ts`](../../../lib/protocol/profile.ts), [`stats-card.ts`](../../../lib/protocol/stats-card.ts) und für die Standardformate [`lib/profile/`](../../../lib/profile/) (`metadata.ts`, `relay-list.ts`, `rounds.ts`). Schema: [`schemas/profile.schema.json`](../schemas/profile.schema.json) (`profile.stats`).

## Zweck

Ein Profil ist eine öffentliche Visitenkarte: Name, Bild, wo die Person schreibt und liest, auf Wunsch selbst geteilte Zahlen und gespeicherte Spielerrunden. Spiele, Gegnernamen und frühere Gäste gehören nicht dazu; sie bleiben lokal oder verschlüsselt ([private-records.md](private-records.md)). Vor der ersten Veröffentlichung sieht die Person, was sichtbar wird („Für andere sichtbar: Name und Bild. Deine Spiele bleiben privat.“).

## Standardformate

| Kind | Inhalt | Ziele | Regeln |
| --- | --- | --- | --- |
| 0 | Metadaten (NIP-01) | Profil-Relays und Schreib-Relays der Person | BlueLine ändert nur `name` beziehungsweise `display_name` (dort, wo das Profil den Namen schon führt; ein neues Profil schreibt beide) und `picture` (nur `https`). Alle anderen Felder bleiben unverändert. Eine Änderung des Spitznamens in BlueLine ändert das öffentliche Profil nur nach Rückfrage. |
| 10002 | Relay-Liste (NIP-65) | Profil-Relays | Ein neues Profil trägt die vier allgemeinen Relays als Lesen und Schreiben ein; purplepag.es bleibt zusätzliches Ziel für Profile und Listen. Vorhandene Listen werden übernommen; beim Bearbeiten bleiben unbekannte Tags und hier unbrauchbare Einträge erhalten. |
| 10006 | Blockierte Relays (NIP-51) | – | Nur gelesen: an öffentlich blockierte Relays (`relay`-Tags) wird nie geschrieben. |
| 30000 | Spielerrunde (NIP-51, Follow-Set) | allgemeine Relays | `d` = `blueline-round-<16 Byte hex>`, `title`, öffentlich je Spieler mit Profil ein `p`-Tag. Privat (NIP-44 an sich selbst) je Platz in Reihenfolge `["player", <Name>, <pubkey?>]`, auch für Gäste ohne Profil. Fremde `p`-Einträge und unbekannte Tags bleiben erhalten. Ist der private Teil nicht lesbar, wird die Runde nicht überschrieben. Gelöscht wird eine Runde durch eine leere Fassung (nur `d`). |

Gelesen wird das eigene Profil an Profil-Relays, allgemeinen Relays und den Schreib-Relays aus der eigenen Liste; ein fremdes Profil an Profil-Relays, allgemeinen Relays, den Hinweisen aus dem Link und danach seinen Schreib-Relays. Eine Abfrage ohne Antwort eines Relays ist „unbekannt“, nie „leer“.

## Statistikkarte (`profile.stats`)

Kind **31180**, `d` = `stats`, Pflicht-Tags nach [kinds.md](../kinds.md), kein `e`-Tag (die Karte gehört zu keinem Club, Turnier oder Match). Unverschlüsselt. Relays behalten je Autor nur die neueste Karte.

| Feld | Bedeutung |
| --- | --- |
| `x01` | `games`, `versus`, `wins`, `darts`, `points`, `highestFinish`, `bestLeg`, `visits180`, optional `checkouts` und `dartsAtDouble` (seit 2026-10, nur gemeinsam; Checkout-Quote = `checkouts` / `dartsAtDouble`), oder `null` |
| `cricket` | `games`, `versus`, `wins`, `darts`, `marks`, oder `null` |
| `clock` | `games`, `versus`, `wins`, `darts`, `hits`, oder `null` |
| `refs` | IDs öffentlicher `match.result`, die in den Zahlen stecken (höchstens 100; heute leer) |

- `games` zählt alle Spiele der Spielart einschließlich Training, `versus` die Spiele gegen andere, `wins` die davon gewonnenen; es gilt `wins ≤ versus ≤ games`. Seit 2026-10 schreibt BlueLine nur noch Spiele gegen andere in die Karte (`games` = `versus`): Training bleibt privat.
- Optionale Felder fehlen in älteren Karten; ein Leser zeigt dann „nicht erfasst“, nie 0. `checkouts` und `dartsAtDouble` stehen nur gemeinsam in einer Karte, und `checkouts ≤ dartsAtDouble`.
- Nur Zähler und Summen, nie Durchschnitte oder Quoten: Leser rechnen selbst (Punkte pro drei Darts = `points` / `darts` × 3), damit jede Anzeige gleich rechnet und große Spiele mehr wiegen als kleine.
- `null` heißt „nicht erfasst“ (etwa 180er ohne vollständige Würfe), nie 0.
- Die Karte ist eine Selbstauskunft. Leser zeigen sie als „Vom Spieler geteilt“ mit ihrem Datum, nie als bestätigte Statistik. Öffentliche Ergebnisse, auf die `refs` zeigt, kann ein Leser selbst nachrechnen.
- Zurücknehmen: eine neue Karte, in der alle drei Spielarten `null` sind. Leser zeigen dann „Keine freigegebenen Spiele“. Standard ist aus: Eine Karte entsteht nur, wenn die Person „Statistik im Profil zeigen“ einschaltet.

Abgelehnt wird eine Karte mit anderem `d`, eines anderen Autors, mit ungültigem Inhalt (`invalid_content`) oder aus der Zukunft (`future_timestamp`); eine neuere Formatversion wird aufbewahrt, aber nicht angezeigt.

## Links

`/#p=U1.<pubkey>.<relays>` ([pairing.md](pairing.md), [`links.ts`](../../../lib/protocol/links.ts)) öffnet ein Profil. Ein Profilcode anderer Apps (`npub…`, `nprofile…`, auch mit `nostr:`) wird beim Scannen ebenfalls angenommen; ein `nsec` nie.
