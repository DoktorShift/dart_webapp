# Familie: Am Board mitspielen

Stand: P0.05. Code: [`board.ts`](../../../lib/protocol/board.ts), [`handshake.ts`](../../../lib/protocol/handshake.ts), [`links.ts`](../../../lib/protocol/links.ts). Schema: [`schemas/board-join.schema.json`](../schemas/board-join.schema.json). Vektoren: [`vectors/board-join.json`](../vectors/board-join.json).

## Zweck

Ein Spieler verbindet sich vom eigenen Handy mit dem Spiel an einem gemeinsamen Board, um seinen Platz zu bestätigen und das Ergebnis später selbst zu bestätigen (PLAN.md „Gemeinsame Spiele“). Dabei wird nie ein Profilschlüssel übertragen, und das Board bekommt keine Wallet-Berechtigung (A06, Recherche DR-08).

## Ablauf

1. Das Board zeigt einen QR beziehungsweise Link `#board=B1.<einmal-pubkey>.<sitzungs-id>.<ablauf>.<relays>` ([pairing.md](pairing.md#links-und-qr-codes)), höchstens 60 Minuten gültig, dann einen neuen.
2. Das Handy liest ihn **nur** als Board-Code; ein Kopplungscode (`P1`) wird im Board-Weg abgelehnt (`wrong_flow`) und umgekehrt.
3. Das Handy sendet `join`, signiert mit dem Profil des Spielers, NIP-44-verschlüsselt an den Einmalschlüssel des Boards.
4. Das Board prüft mit `checkJoin` Sitzung, Ablauf und freien Platz und antwortet mit `seat` (oder `decline`). Derselbe Spieler bekommt bei Wiederholung denselben Platz. Der Platz wird im `agreement.seats[].pubkey` des Matches festgehalten ([session-authorization.md](session-authorization.md)); damit darf der Spieler das Ergebnis bestätigen.

## Nachrichten (Kind 21180, Label `board`)

Flüchtig, NIP-44, Empfänger im `p`-Tag, strikt (unbekannte Felder werden abgelehnt, damit nichts mitreist; Vektor `smuggled`).

| Nachricht | Von → an | Inhalt |
| --- | --- | --- |
| `join` | Spieler → Board | `sid`, `seat` (gewünschter Platz oder `null` = beliebig), `alias?`, `confirm` (will das Ergebnis vom Handy bestätigen) |
| `seat` | Board → Spieler | `sid`, `seat`, `match?` (Match-ID, sobald es läuft) |
| `decline` | Board → Spieler | `sid`, `reason` (`full` / `taken` / `expired` / `declined`) |
| `leave` | Spieler → Board | `sid` |

Kopplungsnachrichten (`announce`, `hello`, `accept`, `package`, `ack`, `abort`) sind im Board-Weg `wrong_flow`; ein Board nimmt nie ein Paket an.

## Ablehnungen

`wrong_flow`, `session_mismatch`, `expired_message`, `no_free_seat`, `session_taken`, `invalid_content`, `invalid_tags`, `future_timestamp`, `unknown_version`.

## Vektoren

`join`, `seat`, besetzter Platz, eingeschmuggeltes Feld, Kopplungspaket an ein Board.
