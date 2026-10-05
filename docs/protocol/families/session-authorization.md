# Familie: Sitzungsberechtigung (Match-Gründung und Schreiberwechsel)

Stand: P0.05. Code: [`match.ts`](../../../lib/protocol/match.ts) (`match.session`), [`match-state.ts`](../../../lib/protocol/match-state.ts). Schema: [`schemas/match.schema.json`](../schemas/match.schema.json). Vektoren: [`vectors/match.json`](../vectors/match.json).

## Zweck

Pro Match gibt es einen aktiven Schreiber, meist das Tablet am Board (PLAN.md „Gemeinsame Spiele“). Damit ein externer Signer nicht jeden Dart bestätigen muss, berechtigt die **Match-Autorität** einen zufälligen **Sitzungsschlüssel** für genau dieses Match. Der Sitzungsschlüssel signiert Live-Stände und das Ergebnis, nie Zahlungen oder Profiländerungen. NIP-26 wird nicht verwendet (Recherche PR-11).

## Match-ID und Autorität

Die Match-ID ist die Event-ID des ersten `match.session` (`sv: 1`). Dessen Autor ist die Autorität:

- das Profil des Gastgebers (Freundschaftsspiel),
- ein vom Veranstalter zugelassenes Board (`tournament.board`) oder der Veranstalter selbst (Turnierspiel; der Veranstalter wird `lib/live` als weitere Autorität übergeben, `authorities`),
- der Geräteschlüssel eines Boards, an dem nur Gäste spielen.

## Inhalt (`match.session`, Kind 1180)

| Feld | Bedeutung |
| --- | --- |
| `sv` | Sitzungsversion, beginnt bei 1, +1 je Übergabe |
| `session` | Pubkey des Sitzungsschlüssels |
| `from`, `until` | Gültigkeitsfenster (höchstens 24 Stunden), bewusst kein NIP-40-`expiration`-Tag: Relays würden die Berechtigung sonst löschen und alte Protokolle unprüfbar machen (PR-11 a) |
| `prev` | nur bei `sv` > 1: Event-ID der vorigen Sitzung |
| `agreement` | nur bei `sv` = 1: Spielvereinbarung, unten |

Vereinbarung (`agreement`): `engine` (Regelversion von `lib/game/engine.ts`, heute 1), `rules` (Spielregeln ohne Namen: Spielart, Modus, Startpunktzahl, Double-In/-Out, Cut-Throat, Bull-Finish, Legs, Sets, Startregel; jedes Feld geschrieben, damit kein Leser andere Standardwerte annimmt), `seats` (1–6 Plätze mit `alias`, optional `pubkey`, wenn die Person mit ihrem Profil beigetreten ist, und `named`, wenn ein Gast ohne Profil der Namensnennung zugestimmt hat, [privacy.md](../privacy.md)), `visibility` (`public` / `private`), `tournament?` (`id`, `slot`), `club?`, `stake?` (vereinbarter Einsatz in ganzen sats als msat, nur informativ).

## Regeln

1. **Übergabe** ist ein neues `match.session` der Autorität mit `sv` = aktuelle + 1 und `prev` = aktuelle Sitzung. Andere Autoren, übersprungene Versionen oder eine falsche Basis werden abgelehnt (`not_authorized`, `stale_predecessor`); nennt `prev` eine Sitzung, die der Leser nicht hat, wartet die Übergabe auf sie (Vektor `forged-handover`).
2. **Ab der Übergabe ist die alte Sitzung wertlos.** Live-Stände der alten Sitzung danach: `session_superseded`. **Ergebnisse zählen nur von der letzten Sitzung nach allen Übergaben**; ein Ergebnis der alten Sitzung ist auch dann ungültig, wenn es vor die Übergabe datiert ist (Vektor `session-handover`, `result-backdated`). Nach einer Übergabe veröffentlicht die neue Sitzung ein Ergebnis neu.
3. Datensätze des Sitzungsschlüssels müssen im Fenster liegen (mit 15 Minuten Uhrtoleranz am Anfang), sonst `session_expired`, und die eingebettete Berechtigung ihrer eigenen Sitzung tragen (`auth`, sonst `session_mismatch`). So ist ein Live-Stand oder Ergebnis ohne weitere Abfrage prüfbar; die eingebettete Berechtigung steht im Inhalt, nie in einem Tag (Tag-Grenze 1 024 Byte).
4. **Privat:** `visibility: "private"` verlangt Verschlüsselung mit dem Spielschlüssel aus dem Link (`["enc","nip44",<pubkey>]`), für die Gründung und für jeden weiteren Datensatz des Matches (Live-Stand, Ergebnis, Protokoll, Bestätigung); ein Datensatz im Klartext wird mit `sealing_required` abgelehnt (Vektor `private-match`). Ein Einsatz steht nur in einem privaten, verschlüsselten Match (`stake_requires_private`). Wer den Zuschauerlink hat, kann mitlesen; der Schlüssel lässt sich nicht widerrufen ([privacy.md](../privacy.md)).
5. **Uhren:** Strfry verwirft Events, die mehr als 900 s in der Zukunft liegen. Ein Tablet mit vorgehender Uhr wäre sonst stumm; Schreiber klemmen `created_at` an die Zeit des Relays ([conflicts.md](../conflicts.md#uhren)). Flüchtige Kinds dienen nie als Warteschlange (PR-11 d).

## Ablehnungen

`not_authorized`, `stale_predecessor`, `session_unknown`, `session_superseded`, `session_expired`, `session_mismatch`, `sealing_required`, `stake_requires_private`, `wrong_root` (zweite Gründung).

## Vektoren

`session-handover`, `forged-handover`, `session-window`, `public-stake`, `private-match`; der Versuch eines Sitzungsschlüssels, eine Zahlung anzufordern, steht in [`vectors/payment-request.json`](../vectors/payment-request.json) (`session-key-requests`).
