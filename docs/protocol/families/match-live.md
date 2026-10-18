# Familie: Live-Spielstand

Stand: P0.05. Code: [`live.ts`](../../../lib/protocol/live.ts), [`throws.ts`](../../../lib/protocol/throws.ts), [`match-state.ts`](../../../lib/protocol/match-state.ts). Schema: [`schemas/match.schema.json`](../schemas/match.schema.json) (`match.live`). Vektoren: [`vectors/match.json`](../vectors/match.json), [`vectors/throws.json`](../vectors/throws.json).

## Zweck

Zuschauer brauchen einen abrufbaren Spielstand mit Versionsnummer für den Wiedereinstieg; ein Strom flüchtiger Events reicht nicht (PLAN.md, Recherche PR-21). Der Sitzungsschlüssel veröffentlicht nach jeder Aufnahme den adressierbaren Stand.

## Kind und Tags

Kind **31180**, `d` = Match-ID = `e`, Pflicht-Tags nach [kinds.md](../kinds.md). Relays behalten je Autor, Kind und `d` nur den neuesten Stand: genau das, was ein Zuschauer braucht. Private Spiele: Inhalt NIP-44 an den Spielschlüssel aus dem Link (`["enc","nip44",<pubkey>]`); ein Stand eines privaten Spiels im Klartext wird abgelehnt (`sealing_required`).

## Inhalt (`match.live`)

| Feld | Bedeutung |
| --- | --- |
| `sv` | Sitzungsversion des Schreibers |
| `n` | Zähler des Stands, steigt mit jedem Stand und läuft über Übergaben weiter |
| `status` | `playing`, `paused`, `finished`, `abandoned` |
| `throws` | kompakte Würfe (unten), höchstens 16 000 Zeichen |
| `from` | Index des ersten Wurfs in `throws`; 0 = vollständig |
| `standing` | Schnellanzeige: `leg`, `set?`, `current`, `scores` (X01-Rest, Cricket-Punkte, Clock-Fortschritt), `legs`, `sets?`, `active?`, `winner` |
| `auth` | eingebettetes `match.session` der eigenen Sitzung |

Bester Stand: höhere Sitzungsversion, dann höherer Zähler, dann Abspielreihenfolge. Langen Spielen schickt der Stand die Würfe ab dem aktuellen Leg (`from` > 0); `standing` deckt den Rest ab. Ein Stand, dessen Würfe sich nicht dekodieren lassen, wird abgelehnt.

## Kompakte Würfe (Format 1)

Verlustfrei gegenüber dem gespeicherten Wurfprotokoll von `lib/game/types.ts` (`decode(encode(log))` = Protokoll wie als JSON gespeichert), rund 1,3 Byte je Dart statt etwa 73:

```
log    = "1" token*                    führende Ziffer = Formatversion
token  = meta | "!"? "#"? throw         "!" korrigiert (edited), "#" beendet das Leg (closesLeg)
meta   = "."                            nächste Aufnahme (visit + 1)
       | "/"                            nächstes Leg (leg + 1, visit + 1)
       | "[" visit? "," leg? "]"        beide Marken setzen; leer = ohne Marke
throw  = DART                           ein Zeichen, Tabelle unten
       | "*"                            Rest der Aufnahme daneben (noScore)
       | "(v" summe "," darts ["," aufDoppel] ")"   Aufnahme als Summe
       | "(t" spieler ")"               Wechsel: dieser Spieler wirft jetzt
       | "(r" spieler ")"               Aufgabe: dieser Spieler verlässt das Spiel
```

DART: Index = (Segment − 1) · 3 + (Faktor − 1) für 1–20; 60 daneben, 61 Single-Bull (25), 62 Bull (50); Zeichen = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-`[Index]. Jeder Wurf trägt die Marken des Cursors, der bei Aufnahme 0, Leg 0 beginnt. Korrekturen bleiben erhalten (`!`, `#`), ebenso alte Protokolle ohne Marken (`[,]`). Beispiel aus dem aufgezeichneten Spiel von P0.01 (Anna gegen Ben, 301): `1775.525.7y-`.

## Ablehnungen

`session_unknown`, `session_superseded`, `session_expired`, `session_mismatch`, `not_authorized`, `invalid_tags` (`d` ≠ Match-ID), `invalid_content` (Würfe nicht lesbar), `unknown_version` wird aufbewahrt, nicht angewandt.

## Vektoren

`session-handover`, `session-window`, `private-match`, `unknown-version`; Wurfkodierung in `vectors/throws.json` (aufgezeichnetes Spiel, korrigiertes Spiel mit `edited` und `closesLeg`, Protokoll ohne Marken).
