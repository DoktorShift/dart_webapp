# Familie: Turnier

Stand: P0.05 (nach Review Runde 1). Code: [`tournament.ts`](../../../lib/protocol/tournament.ts) (Typen, Schemas, Auslosung), [`tournament-state.ts`](../../../lib/protocol/tournament-state.ts) (Zustand). Schema: [`schemas/tournament.schema.json`](../schemas/tournament.schema.json). Vektoren: [`vectors/tournament.json`](../vectors/tournament.json). Rechte: [permissions.md](../permissions.md).

## Zweck

Ein Turnier ist die Event-ID seines `tournament.found`. Das Protokoll legt fest, wer was entscheidet, wie die Auslosung nachprüfbar wird und wie Ergebnisse von „eingereicht“ zu „freigegeben“ kommen. Paarungen, Tabellen und Freilose berechnet die Turnier-Engine (`lib/tournaments`, Arbeitspunkt P6.01 im eigenen Branch, Engine-Version 1) aus `draw.order` und den freigegebenen Ergebnissen. Formatnamen, Seed und Auslosungsregel sind die der Engine.

## Kind, Tags, Verschlüsselung

Kind 1180, Pflicht-Tags nach [kinds.md](../kinds.md), `e` = Turnier-ID. Turniere sind öffentlich (Klartext) oder gehören einem geschlossenen Club; dann sind ihre Datensätze für dessen aktuelle Mitglieder versiegelt ([club.md](club.md)). Gäste stehen in öffentlichen Datensätzen nur unter einem Alias ([privacy.md](../privacy.md)).

## Grundsatz: Wer entscheidet

Spieler setzen `created_at` selbst. Deshalb entscheidet nichts, was ein Spieler schreibt, über Aufnahme, Kapazität oder Reihenfolge (Entscheidung 0001 Punkt 10):

- `tournament.register` ist eine **Anfrage** (`pending`). Aufgenommen wird nur mit `tournament.admit` des Veranstalters; die Kapazität wird dabei geprüft. `admission: "auto"` heißt nur, dass das Gerät des Veranstalters Anfragen in Ankunftsreihenfolge aufnimmt, solange es online ist.
- Die **Warteliste** hat die Reihenfolge der `tournament.waitlist`-Entscheidungen des Veranstalters; wer nachrückt, bestimmt der Veranstalter mit `tournament.admit`.
- Die **Auslosung legt das Feld fest**. Sie ist gültig, wenn sie vom Veranstalter auf der aktuellen Basis kommt, den zuvor festgelegten Seed öffnet, nur angemeldete und nicht herausgenommene Teilnehmende enthält und deren Reihenfolge aus dem Seed folgt. Ein Check-in ist Hilfe für die Leitung, keine Bedingung.
- Eigene Datensätze eines Spielers (Anmeldung, Rückzug, Check-in) verschieben nie die Basis (`head`) der Veranstalterentscheidungen über diesen Platz. Ein rückdatierter Rückzug macht deshalb weder eine spätere Entscheidung noch die Auslosung ungültig (Vektor `draw-holds-against-backdated-player-records`); der Platz ist danach `withdrawn`, die Engine wertet ein Freilos.

## Ablauf

`registration` → (`checkin`, wenn `checkIn`) → `drawn` (durch `tournament.draw`) → `running` ⇄ `paused` → `finished`; aus jeder Phase vor dem Ende `cancelled`. Nach dem Ende werden nur noch Gastplätze mit Profilen verbunden.

## Datensatztypen

| Typ | Autor | Inhalt | Regeln |
| --- | --- | --- | --- |
| `tournament.found` | Veranstalter | `name`, `about?`, `picture?`, `club?`, `engine` (1), `format` (`single` / `double` / `roundRobin` / `groups`), `rules`, `final?`, `capacity` (2–128), `admission`, `waitlist`, `checkIn`, `approval` (`organizer` / `board`), `starts?`, `timezone?`, `place?`, `online?`, `calendar?` (NIP-52-Adresse), `registrationCloses?`, `seedCommit?`, `grandFinalReset?`, `doubleRoundRobin?`, `groups?` | Event-ID = Turnier-ID. Mit `club`: Gründer muss im Club Eigentümer, Admin oder Turnierleiter sein (sonst kein Turnier). Andere `engine`: aufbewahrt, nicht abgespielt |
| `tournament.update` | Veranstalter | `prev`, geänderte Angaben | Regeln nur vor der Auslosung; Kapazität nicht unter das aufgenommene Feld |
| `tournament.phase` | Veranstalter | `phase`, `prev`, `reason?` | erlaubte Übergänge oben |
| `tournament.seed` | Veranstalter | `commit`, `prev` | neue Festlegung vor einer (erneuten) Auslosung |
| `tournament.draw` | Veranstalter | `seed` (16 Byte), `seeded`, `order`, `prev` | siehe Auslosung |
| `tournament.register` | Spieler | `alias?` | Anfrage; vor der Auslosung (auch während des Check-ins als Nachmeldung); nach `registrationCloses` mit Markierung `late` |
| `tournament.withdraw` | Spieler | `reason?` | jederzeit vor dem Ende |
| `tournament.admit` | Veranstalter | `participant`, `prev` | aus `pending` oder `waitlist`; Kapazität |
| `tournament.waitlist` | Veranstalter | `participant`, `prev` | nur mit `waitlist: true` |
| `tournament.remove` | Veranstalter | `participant`, `prev`, `reason` | abgelehnt, nicht erschienen, disqualifiziert |
| `tournament.guest` | Veranstalter | `guest` (16 Byte), `alias`, `named?` | Gast ohne Profil, direkt aufgenommen; `named: true` nur mit Zustimmung zur Namensnennung |
| `tournament.claim` | Spieler | `guest` | beansprucht einen Gastplatz |
| `tournament.link` | Veranstalter | `guest`, `player`, `prev` | nur nach Anspruch dieses Spielers; alte Bestätigungen bleiben unverändert |
| `tournament.checkin` | Spieler selbst, oder Veranstalter mit `participant` und `prev` | | nur in `checkin`, nur Aufgenommene |
| `tournament.board` | Veranstalter | `board` (16 Byte), `name`, `key` (Geräteschlüssel), `prev` | eingeschränkter Zugang eines Boards |
| `tournament.board.revoke` | Veranstalter | `board`, `prev` | |
| `tournament.assign` | Veranstalter | `slot`, `board`, `prev` | nach der Auslosung; nicht für freigegebene Spiele |
| `tournament.result` | zugewiesenes Board oder Veranstalter | `slot`, `winner`, `score`, `walkover?` (`noShow` / `retired`), `match?`, `result?` | während `running` / `paused`; zählt sofort bei `approval: "board"` oder vom Veranstalter |
| `tournament.approve` | Veranstalter | `slot`, `submission`, `prev` | macht ein eingereichtes Ergebnis gültig |
| `tournament.correct` | Veranstalter | `slot`, `winner`, `score`, `reason`, `prev` | ändert ein freigegebenes Ergebnis; abhängige, schon begonnene Spiele werden als `affected` markiert, nie still neu besetzt |
| `tournament.handover.offer` | Veranstalter | `to`, `prev` | bietet die Leitung an |
| `tournament.handover.cancel` | Veranstalter | `offer` | zieht das offene Angebot zurück; gilt nicht, wenn die angebotene Person angenommen hat (vor der Annahme einsortiert) |
| `tournament.handover.accept` | angebotene Person | `offer`, `core` (letzte Änderung des Turnierkerns, die sie sah, oder Turnier-ID) | Turnier-ID bleibt; bei Club-Turnieren muss die übernehmende Person im Club Eigentümer, Admin oder Turnierleiter sein; hält den übernommenen Kern fest (unten) |

Teilnehmer-IDs sind Pubkeys (64 Hex) oder Gast-IDs (32 Hex). Slots benennt die Engine (`R1-1`, `GF2`, …).

## Übergabe der Leitung

Die Übergabekette (Angebot, Rückzug, Annahme) wird vor allem anderen für sich abgespielt; ein angenommenes Angebot bindet den bisherigen Veranstalter. Die Annahme nennt in `core` den Turnierkern, den die übernehmende Person sah. Änderungen des Kerns (`tournament.update`, `.phase`, `.seed`, `.draw`) des bisherigen Veranstalters, die vor der Annahme einsortiert sind, gelten nur, wenn sie dieser Stand oder einer seiner Vorgänger sind; eine später zurückdatierte Absage oder ein Rückzug des Angebots ist `superseded` (Vektor `former-organizer-backdates`). Plätze, Boards und Spiele werden nicht festgehalten: Dort kann der bisherige Veranstalter weiter zurückdatieren, etwa einen Gast oder ein Herausnehmen vor der Auslosung, das sie ungültig macht ([conflicts.md](../conflicts.md#ende-einer-befugnis), bekannte Grenze zu PR-10).

## Auslosung

Nach `lib/tournaments/draw.ts` (Engine 1):

```
seedCommit = sha256("blueline-seed-v1\n" + seed)
drawKey    = sha256("blueline-draw-v1\n" + seed + "\n" + teilnehmer-id)
order      = gesetzte Teilnehmende in ihrer Reihenfolge, dann alle übrigen nach drawKey aufsteigend
```

Der Veranstalter veröffentlicht die Festlegung vor dem Ende des Check-ins (in der Gründung oder mit `tournament.seed`) und den Seed mit der Auslosung. Jeder Client prüft Festlegung und Reihenfolge nach. Eine Festlegung öffnet genau eine Auslosung; eine neue Auslosung braucht eine neue Festlegung. Der Veranstalter könnte vor der Festlegung viele Seeds ausprobieren; das bleibt eine Vertrauensfrage (Recherche PR-20), die Festlegung verhindert nur das Ausprobieren danach.

## Zustand

`reduceTournament(events, id, { now, open, dependents, clubRole })` liefert Phase, Einstellungen, Teilnehmende (Status `pending` / `registered` / `waitlist` / `withdrawn` / `removed`, `admitted`, `checkedIn`, `late`, Wartelistenzeit, Gastverknüpfung), Festlegung, Auslosung, Boards, Slots mit Einreichungen und freigegebenem Ergebnis, offenes Übergabeangebot und das Protokoll. `waitingList(state)` gibt die Warteliste in der Reihenfolge des Veranstalters. `clubRole` kommt aus `clubRoleAt` des Club-Zustands; ohne sie gilt die Club-Zuordnung als ungeprüft (`club.verified: false`).

## Aufbewahrung und Löschung

Wie bei Clubs: reguläre, nicht ersetzte Datensätze; Kopien sendet der Veranstalter erneut. Öffentliche Turniere sind dauerhaft öffentlich; deshalb nur Aliasse für Gäste ([privacy.md](../privacy.md)).

## Ablehnungen

`not_authorized`, `stale_predecessor`, `superseded`, `phase_invalid`, `registration_closed`, `tournament_full`, `not_registered`, `already_registered`, `guest_unknown`, `seed_not_committed`, `seed_mismatch`, `draw_mismatch`, `board_unknown`, `board_not_assigned`, `result_unknown`, `already_approved`, `rules_locked`, `no_open_offer`, `invalid_content` (Warteliste ohne Warteliste), dazu die allgemeinen Gründe.

## Vektoren

`registration-and-admission`, `capacity`, `guests-and-claims`, `checkin-and-draw`, `draw-holds-against-backdated-player-records`, `boards-and-results`, `organizer-handover`, `former-organizer-backdates`, `rules-locked-and-unknown`, `club-tournament`, `club-tournament-by-member`, `newer-engine`. Dazu Clubturniere mit dem Rollenverlauf eines echten Clubzustands in den Club-Vektoren `public-club-read-by-*` und `closed-club-partial-reader`.
