# Reihenfolge, Konflikte und Uhren

Stand: P0.05 (nach Review Runde 2). Code: [`replay.ts`](../../lib/protocol/replay.ts) (`prepare`, `staleOr`, `chainsOf`, `pinRule`, `firstAnswers`, `handoverEnds`, `settleHandovers`), die Reducer und [`tags.ts`](../../lib/protocol/tags.ts) (`byReplayOrder`, `createdAtAfter`). Grundlage: Entscheidung 0002 §6, Entscheidung 0001 Punkte 10 und 11, PLAN.md „Eigentum Berechtigungen und Konflikte“, Recherche PR-10, PR-11, PR-16.

## Abspielen

Club-, Turnier- und Matchzustand ist eine Funktion der **Menge** der vorliegenden Events, nicht ihrer Ankunft:

1. Jedes Event wird geparst ([kinds.md](kinds.md#prüfreihenfolge-beim-lesen)); Kopien derselben ID zählen einmal.
2. Ungültige Events kommen mit Grund in `rejected`, unbekannte Versionen (`unknown`) und nicht zu öffnende verschlüsselte Events (`sealed`) in `unapplied`, Events eines anderen Objekts als `wrong_root` in `rejected`.
3. Die übrigen werden **nach `created_at`, dann nach `id`** (lexikografisch) sortiert und der Reihe nach angewandt. Jede Änderung wird gegen die Rolle ihres Autors **an dieser Stelle** geprüft. Datensätze vor der Gründung: `before_founding`.

Dieselben Events ergeben auf jedem Gerät denselben Zustand; die Tests mischen jede Vektor-Fallmenge zwölfmal und liefern jedes Event doppelt ([`tests/protocol-replay.test.ts`](../../tests/protocol-replay.test.ts)). Verschiedene Leser sehen verschiedene Mengen, wenn Relays verschiedene Kopien haben oder verschlüsselte Datensätze nicht für alle lesbar sind: „kein Konflikt gesehen“ heißt nicht „kein Konflikt“ (PR-10 c). Die App zeigt fehlende Grundlagen als „wartet auf Daten“, nie als Ablehnung. Im Protokoll steht dafür `unapplied` mit `why: "waiting"`: eine Änderung, deren `prev` (bei Spielen auch `replaces`) ein Datensatz ist, den dieser Leser nur versiegelt oder gar nicht hat (Relays sagen keine Aufbewahrung zu, Vektoren `club` › `missing-predecessor`, `match` › `forged-handover`); das Beenden einer Einladung, die er nicht öffnen kann; ein Datensatz einer abgegebenen Befugnis oder eine Annahme, wenn ein Glied des Stands fehlt, den sie nennt (unten). Beitritte über eine Einladung, die der Leser nicht öffnen kann, bleiben Anfragen mit `check: "unverified"` (Vektor `club` › `closed-club-partial-reader`). Ein öffentlicher Club hat keine solchen Lücken: Seine Einladungen stehen im Klartext, jeder prüft die Beitritte (Vektoren `public-club-read-by-*`).

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

Zwei Änderungen auf derselben Basis: Die in der Abspielreihenfolge erste gilt, die zweite ist ein **sichtbarer Konflikt** (`stale_predecessor`), nie eine stille Zusammenführung. Die zuständige Rolle löst ihn mit einer neuen Änderung auf der aktuellen Basis (Vektor `club` › `role-conflict`). `stale_predecessor` heißt immer: Die genannte Basis liegt dem Leser vor, ist aber nicht (mehr) die aktuelle, etwa weil sie ersetzt wurde, selbst ungültig war oder eine unbekannte (neuere) Version hat, die aufbewahrt, aber nicht ausgeführt wird. Hat der Leser die Basis nur versiegelt oder gar nicht, wartet die Änderung (`waiting`, `staleOr`). Verschiedene Gegenstände (zwei Mitglieder, zwei Boards) haben getrennte Basen; Admins stören sich dort nicht.

**Eigene Datensätze eines Spielers verschieben nie die Basis von Veranstalterentscheidungen** über seinen Platz, und nichts, was ein Spieler schreibt, macht eine Auslosung ungültig ([tournament.md](families/tournament.md#grundsatz-wer-entscheidet)).

## Uhren

`created_at` setzt der Autor selbst; es gibt keine vertrauenswürdige Zeit (Entscheidung 0001 Punkt 10).

- **Zukunft:** Leser wenden nichts an, was mehr als 900 s vor ihrer Uhr liegt (`future_timestamp`, wie strfry). Das ist „noch nicht“: Wird das Event später erneut gelesen, kann es gelten.
- **Entscheidungen nach ihrer Grundlage datieren:** Wer auf Basis anderer Events entscheidet (Annahme einer Anfrage, Zuweisung, Freigabe, Übergabe), setzt `created_at` mindestens eine Sekunde nach das späteste davon (`createdAtAfter`), auch wenn die eigene Uhr nachgeht. Sonst stünde die Entscheidung beim Abspielen vor ihrer Grundlage und würde als `stale_predecessor` beziehungsweise „unbekannt“ abgelehnt. Ein Beitritt wird nach seiner Einladung datiert; einer davor ist `invite_unknown`.
- **Vorgehende Uhr eines Boards:** Relays verwerfen Events über 900 s in der Zukunft; Schreiber klemmen `created_at` an die Zeit, die ein Relay meldet (`lib/nostr`, PR-11 c).
- **Flüchtige Nachrichten** (Kopplung, Board) gelten beim Leser höchstens 600 s; die Sitzung selbst endet nach 10 beziehungsweise 60 Minuten.

### Ende einer Befugnis

Wer eine Befugnis abgibt, behält seinen Schlüssel und kann danach weiter Datensätze in seine Amtszeit zurückdatieren; ohne vertrauenswürdige Zeit sieht niemand, dass sie später entstanden (Entscheidung 0001 Punkt 10, Recherche PR-10). Wie bei Spielsitzungen („Sitzungen und Widerruf“) nennt deshalb der Datensatz, der eine Amtszeit beendet, den Stand, den sein Autor übernimmt; was die abgegebene Befugnis vor diesem Ende einsortiert hat und nicht zu diesem Stand gehört, gilt nicht, wie auch immer es datiert ist (`pinRule` in [`replay.ts`](../../lib/protocol/replay.ts)). „Zu einem Stand gehören“ heißt: der genannte Datensatz oder einer seiner Vorgänger über `prev` (bei der Übergabekette: über `prev` des Angebots, das Angebot eines Rückzugs oder einer Annahme).

#### Übergaben (Turnierleitung, Club-Eigentum)

Verbindlich. Code: `firstAnswers`, `handoverEnds`, `settleHandovers`, `buildsOn`, `pinRule` in [`replay.ts`](../../lib/protocol/replay.ts), die Fälle `tournament.handover.*` und `club.owner.*` der Reducer. H ist die Person, die bis dahin leitet oder besitzt; die Vektoren prüfen jede Regel.

| Regel | Inhalt | Vektoren und Tests |
| --- | --- | --- |
| **Ü1 Angebot** | `tournament.handover.offer` und `club.owner.offer` nennen `prev` (letzter Datensatz der Übergabekette), `expires` (nach `created_at`, höchstens 7 Tage danach, `MAX_OFFER_SECONDS`; sonst `invalid_content`) und den Stand, den sie übergeben: beim Turnier `core` (letzte Änderung des Turnierkerns), beim Club `info` (letzte `club.update`) und `member` (letzter Mitgliedsdatensatz der angebotenen Person). | Test „Ü1“ in [`protocol-state.test.ts`](../../tests/protocol-state.test.ts) |
| **Ü2 Annahme** | Eine Annahme gilt nur, wenn (a) das genannte Angebot an ihrer Stelle offen ist und sie von der angebotenen Person kommt; (b) sie spätestens zu `expires` datiert ist, sonst `no_open_offer`; (c) jeder Stand, den sie nennt (`core`; `info` und `member`), der des Angebots ist oder auf ihm aufbaut, sonst `invalid_content` (fehlt dem Leser ein Glied: wartet); (d) die übrigen Prüfungen bestehen: Turnier nicht beendet, bei Clubturnieren Clubrolle; im Club Mitgliedschaft und Versiegelung. | `handover-cancel-then-expired-accept`, `handover-accept-names-older-core`, `owner-accept-names-older-info`, `organizer-handover`, `owner-transfer`, `club-tournament` |
| **Ü3 Eine Antwort** | Nur die erste Annahme der angebotenen Person, die nach dem Angebot einsortiert ist, beantwortet es. Jede weitere ist `no_open_offer`, auch wenn die erste nicht gilt; dann bietet H neu an. | `handover-accept-names-older-core` |
| **Ü4 Ende** | Die Amtszeit von H endet mit der ersten Antwort in Abspielreihenfolge auf ein Angebot, das H in dieser Amtszeit gemacht hat, **wenn das Abspielen sie annimmt, mit den Wirkungen von Ü5**. Nimmt es sie nicht an, ist sie kein Ende und schneidet nichts ab; abgespielt wird dann ohne sie (`settleHandovers`: höchstens eine Runde je Angebot). Antworten auf Angebote von jemandem, dessen Amtszeit schon geendet hat, sind kein Ende. | `offer-recipient-left`, `handover-completed-then-old-offer-accepted`, `later-offer-on-stale-base`; 200 Zufallsverläufe in [`protocol-handover.test.ts`](../../tests/protocol-handover.test.ts) |
| **Ü5 Wirkung** | Für ein Ende A des Angebots O: Datensätze von H, die nach dem Beginn seiner Amtszeit (Gründung oder die Annahme, mit der sie begann) und vor A einsortiert sind, gelten zur Übergabekette nur, wenn sie O oder ein Vorgänger von O sind; zum Turnierkern (`tournament.update`, `.phase`, `.seed`, `.draw`), zu den Clubangaben (`club.update`) und zur Mitgliedschaft der übernehmenden Person (`club.role`, `club.remove`) nur, wenn sie zu dem Stand gehören, den A nennt. Sonst `superseded`. Ab A hat H die Befugnis nicht mehr (`not_authorized`; im Club ist H danach Admin). Wegen Ü2 c bleibt alles, was zum Stand des Angebots gehört; weil ein Ende nicht vor den Beginn der Amtszeit reicht, ändert eine spätere Übergabe nie, ob eine frühere gilt. | `former-organizer-backdates`, `former-owner-backdates`, `handover-crossing-cancel` |
| **Ü6 Grenzen** | (a) Ein Rückzug hält nur ehrliche Geräte auf: Die angebotene Person kann jederzeit eine Annahme in die Gültigkeit datieren, auch vor den Rückzug, und übernimmt dann; was H nach dem Angebot tat und sie nicht nennt, gilt nicht. Ein Angebot ist damit wie ein Gruppenlink in ihrer Hand: nur an Vertraute, kurz gültig (Vorgabe für `lib/clubs` und `lib/tournaments`: 24 Stunden). (b) H und die angebotene Person im Zusammenspiel (etwa zwei Schlüssel derselben Person) können Angebot und Annahme zurückdatieren und so abschneiden, was H danach tat, auch eine laufende Auslosung. | `handover-crossing-cancel` |

Warum die Annahme das Ende ist und nicht eine Bestätigung durch H: Wer den letzten Schritt signiert, kann ihn zurückdatieren. Mit der Annahme als Ende ist eine vollzogene Übernahme vor H sicher; der Preis ist Ü6 a.

#### Herabstufung eines Admins

`club.role`, die einen Admin herabstuft, und `club.remove` eines Admins nennen `info`, die letzte `club.update`, die ihr Autor sah (sonst `invalid_content`). `club.update`-Datensätze des Admins, die nach seiner Ernennung (`club.role` zum Admin, oder die Übergabe, mit der er als Eigentümer Admin wurde) und vor diesem Ende einsortiert sind, gelten nur, wenn sie zu diesem Stand gehören; sonst `superseded`, fehlt ein Glied: wartet. Was vor der Ernennung lag, etwa in einer früheren Amtszeit, berührt das nicht. Herabstufungen findet erst das Abspielen; der Club wird dann ein zweites Mal mit ihnen abgespielt. Vektor `ex-admin-backdates`, Test „demotion“ in [`protocol-state.test.ts`](../../tests/protocol-state.test.ts).

#### Nicht festgehalten

**Grenze (bekannt, PR-10):** Gegenstände mit eigener Basis je Teilnehmerplatz, Board, Spiel, Mitglied, Termin oder Ergebnis werden nicht festgehalten: Ihre Köpfe passen nicht in ein Event (bis 128 Plätze, rund 250 Spiele, bis 100 Mitglieder), und Annahmen, Einladungen, Saisons und Schlüsselfreigaben haben keine Basis. Dort kann eine abgegebene Befugnis weiter zurückdatieren:

- **Turnier:** Plätze (aufnehmen, Warteliste, herausnehmen, Gäste, Verknüpfen, Check-in für andere), Boards, Zuweisungen, eigene Ergebnisse, Freigaben und Korrekturen. Ein zurückdatiertes Herausnehmen vor der Auslosung macht diese ungültig (`draw_mismatch`); ein zurückdatiertes Board kann Ergebnisse einreichen. Vektor `former-organizer-backdates` zeigt das mit einem Gast.
- **Club:** Annahmen, Einladungen, Rollen und Entfernungen anderer Mitglieder, Saisons, Ergebnisentscheidungen, Termine, Schlüsselfreigaben (Vektor `ex-admin-backdates`: die Entfernung zählt). Ein herabgestufter Turnierleiter bei Ergebnissen und Terminen, bei Clubturnieren (`clubRoleAt` prüft die Zeit der Gründung) und ein früherer Admin bei Clubauszeichnungen (`mayIssueClubBadge`). Wer selbst austritt, setzt keine Grenze. Beitritte über Einladungen eines früheren Admins enden dagegen mit seiner Rolle (unten, „Einladungen“), außer sie sind vor sein Ende datiert.

Gegenmittel sind Produktentscheidungen (PR-10: mehrere Eigentümer, Ersatzveranstalter) und in `lib/clubs` und `lib/tournaments` ein Hinweis unter „Erweitert“, wenn ein Datensatz einer abgegebenen Befugnis erst nach deren Ende eintrifft (lokale Beobachtung, ändert keinen Zustand).

## Einladungen

Ohne Server gibt es kein atomares „einmal benutzen“ und keine vertrauenswürdige Zeit (PR-16, NB-16). Deshalb:

| Fall | Entscheidet | Begründung |
| --- | --- | --- |
| Persönliche Einladung, Anfrage ohne Einladung | die annehmende Person (`club.accept`) in ihrer Reihenfolge; die Höchstzahl wird bei der Annahme geprüft | ein Beitretender kann seinen Zeitstempel frei wählen |
| Zwei Personen mit derselben persönlichen Einladung | die erste **Annahme**; jede weitere Annahme oder spätere Nutzung: `invite_exhausted` | die Annahme kommt von der berechtigten Rolle |
| Gruppenlink in einem Club mit Höchstzahl | wie eine Anfrage: die annehmende Person | Kapazität wäre sonst ein Wettlauf um den kleinsten `created_at` |
| Gruppenlink ohne Höchstzahl | der gültige Nachweis; Ablauf und Widerruf nach `created_at` des Beitritts | es gibt keine knappe Ressource; Beitritt ohne Admin online (Entscheidung 0002 §6) |
| Gruppenlink eines geschlossenen Clubs ohne eigene Höchstzahl, an der Grenze von 100 Mitgliedern | ab der Grenze wie eine Anfrage; `club.accept` erst, wenn wieder Platz ist (`club_full`) | jedes versiegelte Event muss alle Mitglieder verpacken. **Ausnahme vom Grundsatz:** Welche Beitritte noch vor der Grenze lagen, folgt aus ihren Zeitstempeln. Ein später, zurückdatierter Beitritt kann ein Mitglied, das in Wirklichkeit früher kam, wieder zur Anfrage machen (Vektoren `member-limit`, `member-limit-displacement`). Deshalb setzt `lib/clubs` ab etwa 90 Mitgliedern `capacity: 100` ([club.md](families/club.md#einladungen-und-beitritt)); offene Nutzerentscheidung |
| Einladung, deren Ersteller nicht mehr Eigentümer oder Admin ist | sie endet mit seiner Rolle: Beitritt `invite_revoked`, Annahme einer Anfrage über seine persönliche Einladung ebenso | in einem geschlossenen Club sehen später ernannte Verantwortliche fremde Einladungen nicht und könnten sie nicht beenden (Vektor `invite-ends-with-role`) |
| Versiegelte Einladung in einem öffentlichen Club | nie gültig: wer sie öffnen kann, lehnt sie ab (`invalid_tags`), wer nicht, sieht eine wartende Anfrage; niemand wird darüber Mitglied | ein öffentlicher Club ist für jeden Leser derselbe (Vektoren `public-club-sealed-invite-read-by-*`) |
| Kopierter Nachweis | nie gültig (`invite_proof_invalid`) | Signatur des Einladungsschlüssels über den eigenen Pubkey |
| Leser, der die Einladung nicht öffnen kann | der Beitritt bleibt eine Anfrage (`unverified`); eine Annahme, eine Rollenänderung oder Entfernung mit dem Beitritt als `prev` oder ein Eigentumsangebot an die Person nimmt sie für diesen Leser auf, mit den Prüfungen der Annahme | Eigentümer und Admins können den Nachweis prüfen; ihr Datensatz bestätigt ihn. Wer den Nachweis selbst geprüft hat, führt eine solche Annahme als `already_member`; Mitglied und Basis sind für beide Leser dieselben |
| Dieselbe Person tritt erneut bei | `already_member` beziehungsweise `duplicate` | |

Grenze, die die App nicht anders darstellt: Ein Gruppenlink ist ein Inhabergeheimnis. Wer ihn hat, kann einen Beitritt vor den Widerruf, den Ablauf oder das Ende der Rolle seines Erstellers datieren; das erkennt niemand. Gegenmittel ist das Entfernen; für knappe Plätze gibt es die persönliche Einladung und die Höchstzahl.

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
| `invalid_tags` | Wurzel-, `d`- oder `enc`-Tag falsch; Verschlüsselungsform nicht erlaubt (auch: versiegelter Datensatz außer `club.keys` in einem öffentlichen Club) |
| `tag_too_long` | ein Tag-Wert über 1 024 Byte |
| `too_large` | Event über 32 KiB |
| `invalid_content` | Inhalt passt nicht zum Schema oder Querregeln verletzt (etwa eine Einladungsbezeichnung im Klartext, die Herabstufung eines Admins ohne `info`, ein Angebot, das nicht nach seinem Datum oder länger als 7 Tage offen ist, eine Annahme, die einen älteren Stand nennt als ihr Angebot) |
| `future_timestamp` | mehr als 900 s vor der Uhr des Lesers (noch nicht anwendbar) |
| `expired_message` | flüchtige Nachricht oder Code abgelaufen |
| `wrong_root` | gehört zu einem anderen Club, Turnier oder Match; zweite Gründung |
| `before_founding` | vor der Gründung datiert |
| `duplicate` | eine Anfrage derselben Person wartet schon |
| `unknown_version` | neuere Version; aufbewahrt, nicht ausgeführt |
| `sealing_required` | muss verschlüsselt sein (geschlossener Club, Einladung, Schlüsselfreigabe, privates Spiel) |
| `not_authorized` | die Rolle des Autors erlaubt das an dieser Stelle nicht |
| `stale_predecessor` | `prev` ist ein vorliegender Datensatz, aber nicht (mehr) die aktuelle Basis (sichtbarer Konflikt); fehlt er dem Leser, wartet die Änderung |
| `superseded` | von einer abgegebenen Befugnis vor deren Ende einsortiert, aber nicht Teil des Stands, den das Ende nennt, etwa ein Rückzug oder ein anderes Angebot vor der Annahme ([Ende einer Befugnis](#ende-einer-befugnis), Ü5) |
| `not_member` / `already_member` | Mitgliedschaft passt nicht |
| `removed_requires_new_invite` | entfernt; braucht eine Einladung von nach der Entfernung |
| `club_full` | Höchstzahl erreicht (bei der Annahme); einen Club mit mehr als 100 Mitgliedern schließen |
| `club_archived` | Club archiviert |
| `invite_unknown` | Einladung unbekannt, ungültig oder später datiert als der Beitritt |
| `invite_expired` / `invite_revoked` / `invite_exhausted` | Einladung abgelaufen / beendet oder ihr Ersteller ist nicht mehr Eigentümer oder Admin / persönliche Einladung schon verwendet |
| `invite_proof_invalid` | Nachweis gilt nicht für diesen Schlüssel; Link öffnet die Vorschau nicht |
| `request_unknown` | keine solche wartende Anfrage |
| `owner_cannot_leave` | Eigentümer übergibt erst |
| `no_open_offer` | kein offenes Angebot: zurückgezogen, ersetzt, abgelaufen (Ü2 b), schon beantwortet (Ü3) oder von jemandem, der nicht mehr leitet (Ü4) |
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
