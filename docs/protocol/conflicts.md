# Reihenfolge, Konflikte und Uhren

Stand: P0.05 (nach Review Runde 1). Code: [`replay.ts`](../../lib/protocol/replay.ts) (`prepare`, `staleOr`, `handoverChain`, `pinRule`), die Reducer und [`tags.ts`](../../lib/protocol/tags.ts) (`byReplayOrder`, `createdAtAfter`). Grundlage: Entscheidung 0002 §6, Entscheidung 0001 Punkte 10 und 11, PLAN.md „Eigentum Berechtigungen und Konflikte“, Recherche PR-10, PR-11, PR-16.

## Abspielen

Club-, Turnier- und Matchzustand ist eine Funktion der **Menge** der vorliegenden Events, nicht ihrer Ankunft:

1. Jedes Event wird geparst ([kinds.md](kinds.md#prüfreihenfolge-beim-lesen)); Kopien derselben ID zählen einmal.
2. Ungültige Events kommen mit Grund in `rejected`, unbekannte Versionen (`unknown`) und nicht zu öffnende verschlüsselte Events (`sealed`) in `unapplied`, Events eines anderen Objekts als `wrong_root` in `rejected`.
3. Die übrigen werden **nach `created_at`, dann nach `id`** (lexikografisch) sortiert und der Reihe nach angewandt. Jede Änderung wird gegen die Rolle ihres Autors **an dieser Stelle** geprüft. Datensätze vor der Gründung: `before_founding`.

Dieselben Events ergeben auf jedem Gerät denselben Zustand; die Tests mischen jede Vektor-Fallmenge zwölfmal und liefern jedes Event doppelt ([`tests/protocol-replay.test.ts`](../../tests/protocol-replay.test.ts)). Verschiedene Leser sehen verschiedene Mengen, wenn Relays verschiedene Kopien haben oder verschlüsselte Datensätze nicht für alle lesbar sind: „kein Konflikt gesehen“ heißt nicht „kein Konflikt“ (PR-10 c). Die App zeigt fehlende Grundlagen als „wartet auf Daten“, nie als Ablehnung. Im Protokoll steht dafür `unapplied` mit `why: "waiting"`: eine Änderung, deren `prev` ein Datensatz ist, den dieser Leser nur versiegelt hat; das Beenden einer Einladung, die er nicht öffnen kann; ein Datensatz einer abgegebenen Befugnis, wenn der Stand, den ihr Ende nennt, fehlt (unten). Beitritte über eine Einladung, die der Leser nicht öffnen kann, bleiben Anfragen mit `check: "unverified"` (Vektor `club` › `closed-club-partial-reader`). Ein öffentlicher Club hat keine solchen Lücken: Seine Einladungen stehen im Klartext, jeder prüft die Beitritte (Vektoren `public-club-read-by-*`).

## Erwarteter Vorgänger

Für umstrittene Reihenfolgen gilt nie die Ankunftszeit oder der höchste Zeitstempel. Änderungen an einem Gegenstand nennen in `prev` die letzte Änderung dieses Gegenstands, die ihr Autor kannte (oder die Objekt-ID, wenn es keine gab):

| Gegenstand | Basis (`prev`) |
| --- | --- |
| Club-Angaben | letzte `club.update` |
| Mitglied (Rolle, Entfernen) | letzter Rollenwechsel dieses Mitglieds, sonst sein Beitritt (auch nach einer Annahme: so ist die Basis für jeden Leser dieselbe, wie auch immer er das Mitglied sah) |
| Eigentum | letztes Angebot, Rückzug oder Annahme |
| Saisonregeln | fortlaufende `version` statt `prev` |
| Ergebnisentscheidung im Club | letzte `club.result` zu diesem Match |
| Clubtermin | letzte Fassung des Termins |
| Turnierkern (Angaben, Phase, Festlegung, Auslosung) | letzte Änderung des Kerns |
| Teilnehmerplatz | letzte **Veranstalter**entscheidung zu diesem Platz, sonst die Anmeldung |
| Board, Slot | letzte Änderung dieses Boards beziehungsweise Spiels |
| Leitung | letztes Angebot, Rückzug oder Annahme |
| Matchsitzung | vorige Sitzung (`sv` + 1) |
| Matchergebnis | neuestes Ergebnis der Kette (`replaces`) |

Zwei Änderungen auf derselben Basis: Die in der Abspielreihenfolge erste gilt, die zweite ist ein **sichtbarer Konflikt** (`stale_predecessor`), nie eine stille Zusammenführung. Die zuständige Rolle löst ihn mit einer neuen Änderung auf der aktuellen Basis (Vektor `club` › `role-conflict`). Basiert eine Änderung auf einer unbekannten Version, ist auch das ein sichtbarer Konflikt. Basiert sie auf einem Datensatz, den dieser Leser nur versiegelt hat, wartet sie (`waiting`, `staleOr`). Verschiedene Gegenstände (zwei Mitglieder, zwei Boards) haben getrennte Basen; Admins stören sich dort nicht.

**Eigene Datensätze eines Spielers verschieben nie die Basis von Veranstalterentscheidungen** über seinen Platz, und nichts, was ein Spieler schreibt, macht eine Auslosung ungültig ([tournament.md](families/tournament.md#grundsatz-wer-entscheidet)).

## Uhren

`created_at` setzt der Autor selbst; es gibt keine vertrauenswürdige Zeit (Entscheidung 0001 Punkt 10).

- **Zukunft:** Leser wenden nichts an, was mehr als 900 s vor ihrer Uhr liegt (`future_timestamp`, wie strfry). Das ist „noch nicht“: Wird das Event später erneut gelesen, kann es gelten.
- **Entscheidungen nach ihrer Grundlage datieren:** Wer auf Basis anderer Events entscheidet (Annahme einer Anfrage, Zuweisung, Freigabe, Übergabe), setzt `created_at` mindestens eine Sekunde nach das späteste davon (`createdAtAfter`), auch wenn die eigene Uhr nachgeht. Sonst stünde die Entscheidung beim Abspielen vor ihrer Grundlage und würde als `stale_predecessor` beziehungsweise „unbekannt“ abgelehnt. Ein Beitritt wird nach seiner Einladung datiert; einer davor ist `invite_unknown`.
- **Vorgehende Uhr eines Boards:** Relays verwerfen Events über 900 s in der Zukunft; Schreiber klemmen `created_at` an die Zeit, die ein Relay meldet (`lib/nostr`, PR-11 c).
- **Flüchtige Nachrichten** (Kopplung, Board) gelten beim Leser höchstens 600 s; die Sitzung selbst endet nach 10 beziehungsweise 60 Minuten.

### Ende einer Befugnis

Wer eine Befugnis abgibt, behält seinen Schlüssel und kann danach weiter Datensätze in seine Amtszeit zurückdatieren; ohne vertrauenswürdige Zeit sieht niemand, dass sie später entstanden (Entscheidung 0001 Punkt 10, Recherche PR-10). Wie bei Spielsitzungen („Sitzungen und Widerruf“) gilt deshalb, unabhängig von der Datierung (`handoverChain` und `pinRule` in [`replay.ts`](../../lib/protocol/replay.ts)):

1. **Übergabeketten** (Turnierleitung, Club-Eigentum: Angebot, Rückzug, Annahme) werden zuerst für sich abgespielt. Ein Angebot, das die angebotene Person angenommen hat, bindet seinen Autor: Ein Rückzug oder ein neues Angebot von ihm, das vor dieser Annahme einsortiert ist, gilt nicht (`superseded`), ebenso ein anderes Angebot von ihm auf derselben Basis. Kreuzen sich ein echter Rückzug und die Annahme, gewinnt also die Annahme; zurückgeben geht mit einer neuen Übergabe.
2. **Der beendende Datensatz nennt den Stand, den sein Autor sah:**

| Ende | nennt | festgehalten wird |
| --- | --- | --- |
| `tournament.handover.accept` | `core`: letzte Änderung des Turnierkerns | Angaben, Regeln, Phase, Festlegung und Auslosung des bisherigen Veranstalters |
| `club.owner.accept` | `info`: letzte `club.update`; `member`: letzte eigene Mitgliedsänderung (Beitritt oder Rolle) | Clubangaben, Sichtbarkeit und Archiv des bisherigen Eigentümers; seine Rollenänderungen und Entfernungen der übernehmenden Person |
| `club.role`, die einen Admin herabstuft; `club.remove` eines Admins | `info` (Pflicht, sonst `invalid_content`) | Clubangaben des bisherigen Admins |

Ein Datensatz der abgebenden Person über einen festgehaltenen Gegenstand, der vor dem Ende einsortiert ist, gilt nur, wenn er der genannte Stand oder einer seiner Vorgänger ist; sonst ist er `superseded`. Fehlt dem Leser der genannte Stand, wartet der Datensatz. Was die übernehmende Person beim Übernehmen nicht kannte, gilt damit auch dann nicht, wenn es echt war: maßgeblich ist der übernommene Stand. Herabstufungen von Admins findet erst das Abspielen; der Club wird dann ein zweites Mal mit ihnen abgespielt. Vektoren: `tournament` › `former-organizer-backdates`, `club` › `former-owner-backdates`, `ex-admin-backdates`.

**Grenze (bekannt, PR-10):** Gegenstände mit eigener Basis je Teilnehmerplatz, Board, Spiel, Mitglied, Termin oder Ergebnis werden nicht festgehalten: Ihre Köpfe passen nicht in ein Event (bis 128 Plätze, rund 250 Spiele, bis 100 Mitglieder), und Annahmen, Einladungen, Saisons und Schlüsselfreigaben haben keine Basis. Dort kann eine abgegebene Befugnis weiter zurückdatieren:

- **Turnier:** Plätze (aufnehmen, Warteliste, herausnehmen, Gäste, Verknüpfen, Check-in für andere), Boards, Zuweisungen, eigene Ergebnisse, Freigaben und Korrekturen. Ein zurückdatiertes Herausnehmen vor der Auslosung macht diese ungültig (`draw_mismatch`); ein zurückdatiertes Board kann Ergebnisse einreichen. Vektor `former-organizer-backdates` zeigt das mit einem Gast.
- **Club:** Annahmen, Einladungen, Rollen und Entfernungen anderer Mitglieder, Saisons, Ergebnisentscheidungen, Termine, Schlüsselfreigaben (Vektor `ex-admin-backdates`: die Entfernung zählt). Ein herabgestufter Turnierleiter bei Ergebnissen und Terminen, bei Clubturnieren (`clubRoleAt` prüft die Zeit der Gründung) und ein früherer Admin bei Clubauszeichnungen (`mayIssueClubBadge`). Wer selbst austritt, setzt keine Grenze.
- **Zwei Schlüssel im Zusammenspiel:** Bietet die abgebende Person rückdatiert einem eigenen zweiten Schlüssel an, der rückdatiert annimmt, spaltet sich die Übergabekette; es gilt, was zuerst einsortiert ist.

Gegenmittel sind Produktentscheidungen (PR-10: mehrere Eigentümer, Ersatzveranstalter) und in `lib/clubs` und `lib/tournaments` ein Hinweis unter „Erweitert“, wenn ein Datensatz einer abgegebenen Befugnis erst nach deren Ende eintrifft (lokale Beobachtung, ändert keinen Zustand).

## Einladungen

Ohne Server gibt es kein atomares „einmal benutzen“ und keine vertrauenswürdige Zeit (PR-16, NB-16). Deshalb:

| Fall | Entscheidet | Begründung |
| --- | --- | --- |
| Persönliche Einladung, Anfrage ohne Einladung | die annehmende Person (`club.accept`) in ihrer Reihenfolge; die Höchstzahl wird bei der Annahme geprüft | ein Beitretender kann seinen Zeitstempel frei wählen |
| Zwei Personen mit derselben persönlichen Einladung | die erste **Annahme**; jede weitere Annahme oder spätere Nutzung: `invite_exhausted` | die Annahme kommt von der berechtigten Rolle |
| Gruppenlink in einem Club mit Höchstzahl | wie eine Anfrage: die annehmende Person | Kapazität wäre sonst ein Wettlauf um den kleinsten `created_at` |
| Gruppenlink ohne Höchstzahl | der gültige Nachweis; Ablauf und Widerruf nach `created_at` des Beitritts | es gibt keine knappe Ressource; Beitritt ohne Admin online (Entscheidung 0002 §6) |
| Gruppenlink eines geschlossenen Clubs ohne eigene Höchstzahl, an der Grenze von 100 Mitgliedern | ab der Grenze wie eine Anfrage; `club.accept` erst, wenn wieder Platz ist (`club_full`) | jedes versiegelte Event muss alle Mitglieder verpacken; welche Beitritte noch vor der Grenze lagen, folgt aus ihren Zeitstempeln (Vektor `member-limit`) |
| Kopierter Nachweis | nie gültig (`invite_proof_invalid`) | Signatur des Einladungsschlüssels über den eigenen Pubkey |
| Leser, der die Einladung nicht öffnen kann | der Beitritt bleibt eine Anfrage (`unverified`); eine Annahme, eine Rollenänderung oder Entfernung mit dem Beitritt als `prev` oder ein Eigentumsangebot an die Person nimmt sie für diesen Leser auf, mit den Prüfungen der Annahme | Eigentümer und Admins können den Nachweis prüfen; ihr Datensatz bestätigt ihn. Wer den Nachweis selbst geprüft hat, führt eine solche Annahme als `already_member`; Mitglied und Basis sind für beide Leser dieselben |
| Dieselbe Person tritt erneut bei | `already_member` beziehungsweise `duplicate` | |

Grenze, die die App nicht anders darstellt: Ein Gruppenlink ist ein Inhabergeheimnis. Wer ihn hat, kann einen Beitritt vor den Widerruf oder Ablauf datieren; das erkennt niemand. Gegenmittel ist das Entfernen; für knappe Plätze gibt es die persönliche Einladung und die Höchstzahl.

## Turnieranmeldung

Anmeldeschluss, Kapazität und Warteliste entscheidet der Veranstalter, nicht der Zeitstempel der Anmeldung: Anmeldungen warten (`pending`), aufgenommen wird mit `tournament.admit` (Kapazität wird dort geprüft), die Warteliste hat die Reihenfolge der Veranstalterentscheidungen. Eine Anmeldung nach dem angekündigten Schluss wird markiert (`late`), nicht verworfen; der Veranstalter entscheidet (Vektor `registration-and-admission`).

## Sitzungen und Widerruf

Eine Übergabe macht die alte Sitzung ab dann wertlos; Ergebnisse zählen nur von der letzten Sitzung, auch gegen Rückdatierung (Vektor `match` › `session-handover`). Ein Widerruf wirkt erst, wenn andere Geräte ihn lesen (Entscheidung 0001 Punkt 11).

## Ablehnungsgründe

Unter „Erweitert“ sichtbar, nie in normalen Ansichten.

| Grund | Bedeutung |
| --- | --- |
| `invalid_event` | keine gültige Event-Form (oder Rumor-ID passt nicht zum Inhalt) |
| `not_blueline` | BlueLine-Labels fehlen oder sind doppelt |
| `wrong_kind` | falsche Kind für den Typ; Zahlungsanfrage nicht verpackt |
| `invalid_tags` | Wurzel-, `d`- oder `enc`-Tag falsch; Verschlüsselungsform nicht erlaubt |
| `tag_too_long` | ein Tag-Wert über 1 024 Byte |
| `too_large` | Event über 32 KiB |
| `invalid_content` | Inhalt passt nicht zum Schema oder Querregeln verletzt (etwa eine Einladungsbezeichnung im Klartext, die Herabstufung eines Admins ohne `info`) |
| `future_timestamp` | mehr als 900 s vor der Uhr des Lesers (noch nicht anwendbar) |
| `expired_message` | flüchtige Nachricht oder Code abgelaufen |
| `wrong_root` | gehört zu einem anderen Club, Turnier oder Match; zweite Gründung |
| `before_founding` | vor der Gründung datiert |
| `duplicate` | eine Anfrage derselben Person wartet schon |
| `unknown_version` | neuere Version; aufbewahrt, nicht ausgeführt |
| `sealing_required` | muss verschlüsselt sein (geschlossener Club, Einladung, Schlüsselfreigabe, privates Spiel) |
| `not_authorized` | die Rolle des Autors erlaubt das an dieser Stelle nicht |
| `stale_predecessor` | `prev` ist nicht mehr die aktuelle Basis (sichtbarer Konflikt) |
| `superseded` | von einer abgegebenen Befugnis vor deren Ende datiert, aber nicht Teil des Stands, den das Ende nennt; oder ein Rückzug beziehungsweise Gegenangebot zu einem angenommenen Angebot ([Ende einer Befugnis](#ende-einer-befugnis)) |
| `not_member` / `already_member` | Mitgliedschaft passt nicht |
| `removed_requires_new_invite` | entfernt; braucht eine Einladung von nach der Entfernung |
| `club_full` | Höchstzahl erreicht (bei der Annahme); einen Club mit mehr als 100 Mitgliedern schließen |
| `club_archived` | Club archiviert |
| `invite_unknown` | Einladung unbekannt, ungültig oder später datiert als der Beitritt |
| `invite_expired` / `invite_revoked` / `invite_exhausted` | Einladung abgelaufen / beendet / persönliche Einladung schon verwendet |
| `invite_proof_invalid` | Nachweis gilt nicht für diesen Schlüssel; Link öffnet die Vorschau nicht |
| `request_unknown` | keine solche wartende Anfrage |
| `owner_cannot_leave` | Eigentümer übergibt erst |
| `no_open_offer` | kein offenes Angebot |
| `season_unknown` / `season_exists` / `season_version_mismatch` / `season_ended` | Saison unbekannt / ID vergeben / falsche Regelversion / beendet |
| `rules_change_needs_reason` | Regeländerung nach Saisonbeginn ohne Begründung |
| `phase_invalid` | in dieser Turnierphase nicht möglich |
| `registration_closed` | Feld schon ausgelost |
| `tournament_full` | Kapazität erreicht oder unterschritten |
| `not_registered` / `already_registered` | Teilnahme passt nicht |
| `guest_unknown` | kein solcher Gastplatz |
| `seed_not_committed` / `seed_mismatch` | keine Festlegung / Seed öffnet sie nicht |
| `draw_mismatch` | Feld oder Reihenfolge der Auslosung stimmt nicht |
| `board_unknown` / `board_not_assigned` | kein aktives Board / Spiel einem anderen Board zugewiesen |
| `result_unknown` / `already_approved` | kein solches Ergebnis / schon freigegeben (Korrektur nutzen) |
| `rules_locked` | Regeln nach der Auslosung fest |
| `session_unknown` / `session_superseded` / `session_expired` / `session_mismatch` | Sitzung unbekannt / übergeben / außerhalb des Fensters / falsche eingebettete Berechtigung |
| `not_a_player` | nicht der Spieler dieses Platzes |
| `stake_requires_private` | Einsatz nur in einem privaten, verschlüsselten Match |
| `amount_mismatch` / `invoice_mismatch` / `invoice_expired` | Zahlungsanfrage passt nicht zu Einsatz oder Rechnung / abgelaufen |
| `issuer_mismatch` / `recipient_missing` / `occasion_mismatch` / `evidence_missing` / `evidence_revoked` | Auszeichnung: falscher Aussteller / ohne Empfänger / ohne Anlass / ohne Nachweis / Nachweis korrigiert oder aufgehoben |
| `wrong_flow` | Code oder Nachricht des anderen Ablaufs (Board statt Kopplung und umgekehrt) |
| `session_taken` / `no_free_seat` | anderes Gerät schon verbunden / kein freier Platz |
| `out_of_order` | Kopplungsschritt in falscher Reihenfolge |
| `mac_invalid` | Code oder Paket-Hash stimmt nicht |
