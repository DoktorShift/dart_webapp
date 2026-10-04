# Familie: Matchergebnis, Protokoll und Bestätigung

Stand: P0.05. Code: [`match.ts`](../../../lib/protocol/match.ts), [`match-state.ts`](../../../lib/protocol/match-state.ts), [`chunks.ts`](../../../lib/protocol/chunks.ts). Schema: [`schemas/match.schema.json`](../schemas/match.schema.json). Vektoren: [`vectors/match.json`](../vectors/match.json), [`vectors/chunks.json`](../vectors/chunks.json).

## Zweck

Abgeschlossene Ergebnisse sind nachvollziehbare, nicht ersetzte Ereignisse (PLAN.md „Ereignismodell“). Die lokale Spielengine berechnet jedes Ergebnis selbst; das Ergebnis trägt die Würfe, damit jeder Leser nachrechnen kann. Spieler bestätigen oder bestreiten genau ein Ergebnis; eine Signatur beweist eine Erklärung, nicht den Einschlag eines Darts.

## Kind und Tags

Kind 1180, `e` = Match-ID, Pflicht-Tags nach [kinds.md](../kinds.md). Private Spiele: NIP-44 an den Spielschlüssel aus dem Link, sonst `sealing_required`.

## Datensatztypen

| Typ | Autor | Inhalt |
| --- | --- | --- |
| `match.result` | letzte Sitzung (mit eingebetteter Berechtigung `auth`) oder Match-Autorität | `sv`, `status` (`finished` / `abandoned` / `void`), `winner` (Platz oder `null`), `legs` je Platz, `sets?`, `stats?` (`darts`, `points` je Platz), **entweder** `throws` (kompakte Würfe, [match-live.md](match-live.md#kompakte-würfe-format-1)) **oder** `log` (`head`, `total`, `bytes` eines Protokolls in Stücken), `finishedAt`, `replaces?`, `reason?`, `auth?` |
| `match.log` | Sitzungsschlüssel oder Autorität | ein Stück: `set` (Kopf), `seq`, `total`, `prev`, `data` |
| `match.confirm` | Spieler des genannten Platzes (Profil im `seat.pubkey`) | `result` (Event-ID), `verdict` (`confirm` / `dispute`), `seat`, `reason?` |

## Regeln

1. **Kette der Ergebnisse:** Das erste Ergebnis hat kein `replaces`; jede Korrektur oder Aufhebung (`void`) nennt das jeweils neueste davor und eine Begründung. Ein zweites Ergebnis ohne Bezug ist ein sichtbarer Konflikt (`stale_predecessor`). Es zählt das neueste der Kette, außer es hebt das Match auf.
2. **Nur die letzte Sitzung** (nach allen Übergaben) und die Autorität schreiben Ergebnisse ([session-authorization.md](session-authorization.md)).
3. **Bestätigungen** zählen für das Ergebnis, das sie nennen; je Platz zählt die neueste. Wird das Ergebnis ersetzt, bleiben seine Bestätigungen sichtbar, zählen aber nicht mehr (A13). Nur der Spieler des Platzes bestätigt (`not_a_player`).
4. **Größe:** Passt das Wurfprotokoll nicht in ein Event, wird es nach Bytebudget in hash-verkettete Stücke geteilt: `prev_0` = 64 × „0", `hash_i = sha256(prev_i ‖ data_i)`, Kopf = letzter Hash. Jedes Stück nennt den Kopf, das Ergebnis Kopf, Stückzahl und Größe. Fehlende, doppelte mit anderem Inhalt oder falsch verkettete Stücke sind ein Fehler, nie ein halbes Ergebnis. Budget je Event: ≤ 32 KiB signiert, ≤ 20 480 Byte Klartext vor NIP-44 (Recherche PR-07).
5. Ergebnisse mit Würfen, die sich nicht dekodieren lassen, oder Längen, die nicht zu den Plätzen passen, werden abgelehnt (`invalid_content`).

Ein Ergebnis eines Turnierspiels wird zusätzlich mit `tournament.result` eingereicht ([tournament.md](tournament.md)); ein Clubspiel zählt für die Saison nach deren Regeln und den Entscheidungen in `club.result` ([club.md](club.md)).

## Aufbewahrung und Löschung

Reguläre Events; Korrekturen ersetzen nichts, sie verweisen. Eine zurückgenommene Bestätigung (NIP-09) gilt als zurückgenommen, bleibt aber lokal sichtbar (PR-10 e).

## Ablehnungen

`session_superseded`, `session_unknown`, `session_expired`, `session_mismatch`, `not_authorized`, `stale_predecessor`, `not_a_player`, `result_unknown`, `invalid_content`.

## Vektoren

`session-handover`, `confirm-and-correct`, `chunked-log`; Stücke in `vectors/chunks.json`.
