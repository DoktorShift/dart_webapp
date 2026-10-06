# Familie: Am Board mitspielen

Stand: P4.01 (5. Oktober 2026; P0.05 um Ansehen, Anspruch des Profils und Spielschlüssel ergänzt). Code: [`board.ts`](../../../lib/protocol/board.ts), [`handshake.ts`](../../../lib/protocol/handshake.ts), [`links.ts`](../../../lib/protocol/links.ts). Schema: [`schemas/board-join.schema.json`](../schemas/board-join.schema.json). Vektoren: [`vectors/board-join.json`](../vectors/board-join.json).

## Zweck

Ein Spieler verbindet sich vom eigenen Handy mit dem Spiel an einem gemeinsamen Board, um seinen Platz zu bestätigen und das Ergebnis später selbst zu bestätigen (PLAN.md „Gemeinsame Spiele“). Dabei wird nie ein Profilschlüssel übertragen, und das Board bekommt keine Wallet-Berechtigung (A06, Recherche DR-08).

## Ablauf

1. Das Board zeigt einen QR beziehungsweise Link `#board=B1.<einmal-pubkey>.<sitzungs-id>.<ablauf>.<relays>` ([pairing.md](pairing.md#links-und-qr-codes)), höchstens 60 Minuten gültig, dann einen neuen. Das Match ist dann schon gegründet ([session-authorization.md](session-authorization.md)).
2. Das Handy liest ihn **nur** als Board-Code; ein Kopplungscode (`P1`) oder Übergabecode (`H1`) wird im Board-Weg abgelehnt (`wrong_flow`) und umgekehrt.
3. Das Handy erzeugt einen Einmalschlüssel und spricht mit dem Board nur über ihn: NIP-44 zwischen den beiden Einmalschlüsseln, in beide Richtungen. Es fragt mit `look` nach dem Spiel; das Board antwortet mit `table` (Match-ID, Regeln, Plätze mit Namen und ob dort schon ein Handy verbunden ist).
4. Der Spieler wählt seinen Platz; das Handy sendet `join`. **Mit Profil** trägt `join` unter `profile` den Anspruch des Profils: ein vom Profil signiertes, nie veröffentlichtes Event (Kind 21180, Label `board`, ohne `p`-Tag), Inhalt `{"t":"claim","sid","board","key"}` mit dem Einmalschlüssel des Boards und dem des Handys. So signiert das Profil nur, verschlüsselt nie; das genügt auch einem Android-Signer ohne NIP-44 (NIP-55). **Als Gast** fehlt `profile`; dann steht der Einmalschlüssel des Handys für den Platz.
5. Das Board prüft die Signatur des Anspruchs (lib/nostr) und mit `checkClaim` Art, Board-Code und Handy-Schlüssel, dann mit `checkJoin` Sitzung, Ablauf und freien Platz, und antwortet mit `seat` (oder `decline`). Derselbe Spieler (dasselbe Profil, derselbe Gast-Schlüssel) bekommt bei Wiederholung denselben Platz. Das Board hält den Platz mit `match.seat` im Match fest ([match-result.md](match-result.md)); damit gibt der Spieler das Urteil seines Platzes zum Ergebnis ab. `seat` nennt die Match-ID und bei einem privaten Spiel den Spielschlüssel, mit dem das Handy dem Spiel folgt und seine Bestätigung verschlüsselt.

## Nachrichten (Kind 21180, Label `board`)

Flüchtig, NIP-44, Empfänger im `p`-Tag, strikt (unbekannte Felder werden abgelehnt, damit nichts mitreist; Vektor `smuggled`).

| Nachricht | Von → an | Inhalt |
| --- | --- | --- |
| `look` | Spieler → Board | `sid` |
| `table` | Board → Spieler | `sid`, `match` (Match-ID), `rules` (Spielregeln wie in der Vereinbarung), `seats` (je Platz `alias` und `taken`) |
| `join` | Spieler → Board | `sid`, `seat` (gewünschter Platz oder `null` = beliebig), `alias?`, `confirm` (will das Ergebnis vom Handy bestätigen), `profile?` (Anspruch des Profils, oben) |
| `seat` | Board → Spieler | `sid`, `seat`, `match?` (Match-ID, sobald es läuft), `key?` (Spielschlüssel eines privaten Spiels) |
| `decline` | Board → Spieler | `sid`, `reason` (`full` / `taken` / `expired` / `declined`) |
| `leave` | Spieler → Board | `sid` |

Kopplungs- und Übergabenachrichten (`announce`, `hello`, `accept`, `package`, `ack`, `abort`, `take`, `game`, `done`) sind im Board-Weg `wrong_flow`; ein Board nimmt nie ein Paket an.

Der Spielschlüssel in `seat` ist derselbe Lesezugang wie der Zuschauerlink: Wer am Board mitspielt, darf mitlesen. Er reist nur verschlüsselt an das Handy, das den Platz bekommen hat.

## Ablehnungen

`wrong_flow`, `session_mismatch`, `expired_message`, `no_free_seat`, `session_taken`, `invalid_content`, `invalid_tags`, `future_timestamp`, `unknown_version`; für den Anspruch zusätzlich `wrong_kind` und `not_authorized` (Anspruch für einen anderen Handy-Schlüssel).

## Vektoren

`look`, `table`, `join` als Gast, `join` mit Anspruch des Profils, Anspruch für ein anderes Handy, `seat` mit Spielschlüssel, besetzter Platz, eingeschmuggeltes Feld, Kopplungspaket an ein Board, Übergabepaket an ein Board.
