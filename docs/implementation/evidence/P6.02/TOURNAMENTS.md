# P6.02–P6.04 Turniere: Anmeldung, Leitung, Boards, Zuschauer, Druck

Stand: 16. Oktober 2026, Branch `wave3/tournaments`, Basis `f505d7c` (nostr-plan mit nostr-core 1.0.6, Profil- und Live-Track). Bezug: [PLAN.md](../../PLAN.md) Zeilen 380–422, [Entscheidung 0002](../../../decisions/0002-architektur.md), [Protokollfamilie Turnier](../../../protocol/families/tournament.md), Engine [P6.01](../P6.01/ENGINE.md).

## Aufbau

| Schicht | Datei | Aufgabe |
| --- | --- | --- |
| Protokoll | `lib/protocol/links.ts` | Neuer Link-Typ `TB1` unter `#tournament=`: Turnier-ID, Board-ID, Geheimnis des Board-Schlüssels. Ein Board-Gerät wird durch Scannen dieses Codes zum Board; der Veranstalterschlüssel bleibt beim Veranstalter. Zwei Typen teilen sich den Fragmentschlüssel; das Präfix entscheidet, ein Board-Code öffnet nie als Turnierlink. |
| Live | `lib/live/board.ts`, `content.ts`, `follow.ts`, `store.ts` | `goLive(match, { tournament })` gründet das Spiel **öffentlich** (nichts versiegelt, kein Schlüssel im Zuschauer-Link) unter dem autorisierten Board-Schlüssel als Autorität; `agreement.tournament` nennt Turnier und Slot. `watchFoundings({ authors, relays })` findet solche Gründungen nach den Schlüsseln der Boards. Das Turnierprotokoll hat keinen Datensatz „Spiel läuft“; die Live-Gründung ist dieser Hinweis. |
| Turnierdaten | `lib/tournaments/store.ts` | Lokale Kopie je Turnier im Store `objects` (`tournament:<id>`): signierte Events, Relays des Links, **geordnete Liste `unsent`** (unbestätigte eigene Events; der Koordinator legt sie bei der Integration auf `lib/sync/outbox.ts`), Auslosungs-Seeds je Festlegung und versiegelte Board-Schlüssel (Veranstaltergerät). Entwürfe in `kv`, das Board-Gerät in `pending` mit versiegeltem Schlüssel (Vault-Zweck `board-key`) und eigener Ausgangsliste. Nicht an das Profil gebunden: Gäste und Board-Geräte behalten ihre Kopie beim Abmelden. |
| Entwurf | `lib/tournaments/draft.ts` | Die vier Schritte als JSON, Pflichtprüfung (`draftProblems`), Gründungsinhalt (`foundContent`). |
| Datensätze | `lib/tournaments/records.ts` | Eine Vorlage je Datensatztyp auf dem gelesenen Zustand, `prev` aus `head` des Gegenstands, `created_at` nach allem, was der Zustand angewandt hat. Übergabe-Angebote gelten 24 Stunden. |
| Lesen | `lib/tournaments/read.ts` | `readTournament`: `reduceTournament` (Rechte, Phase, Teilnehmer, Freigaben) plus Engine-Spielplan aus `draw.order`. **Entscheidungen gehen in der Reihenfolge des Abspielprotokolls in die Engine** (Aufrufe, Ergebnisse der Leitung, Freigaben, Korrekturen); so markiert die Engine Folgespiele, die auf einem korrigierten Ergebnis aufbauen, statt sie still neu zu besetzen. `dependentSlots` beantwortet dem Protokoll, welche Slots eine Korrektur betrifft. Rückzüge nach der Auslosung und laufende Live-Spiele kommen danach. Was die Engine nicht übernehmen kann, steht in `skipped` (Erweitert). |
| Senden | `lib/tournaments/send.ts` | Signieren, lokal ablegen, dann Relays: Profil-Events über `lib/sync/publish.ts`, Board-Events direkt (das Sync-Modul nimmt nur Events des angemeldeten Profils). „Angekommen“ = zwei Betreiber oder jede Relay-Antwort endgültig (Live-Regel). `resendUnsent` sendet die geordnete Liste erneut; auch beim Öffnen nach einer Relay-Antwort. |
| Abgleich | `lib/tournaments/sync.ts` | Abruf **seitenweise** (400 je Seite, `until` auf die älteste Sekunde): Relays liefern je Anfrage höchstens einige hundert Events (nak und die meisten öffentlichen: 500), ein 128er-Turnier sind rund 650 Datensätze. Abonnement während ein Bildschirm offen ist; Entdecken eigener Turniere über `tournament.found/register/claim`. |
| Board-Gerät | `lib/tournaments/board-device.ts` | `becomeBoard` (Code → versiegelter Schlüssel), `boardGame` (Spiel mit Turnierregeln, Finalregeln im Finale, `config.extras.tournament = { id, slot, board }`), `resultOf` (Sieger, Legs oder Sätze), `reportResult` (signiert mit Board-Schlüssel, Ausgangsliste, nie dasselbe Ergebnis zweimal), `flushBoard`. |
| Export | `lib/tournaments/export.ts` | CSV (Semikolon, Nr., Runde, Spieler, Ergebnis, Sieger, Board, Stand) und JSON (`blueline-tournament` v1: Zusammenfassung plus alle signierten Events). |
| Auszeichnungen | `lib/tournaments/occasion.ts` | `badgeOccasion(read)` spiegelt `BadgeOccasion` des Badges-Tracks Feld für Feld (Sieger, Finalist bei Formaten mit Finale, alle Profile; Gastplätze nur verknüpft). Integrationspunkt: `components/tournaments/organize-screen.tsx`, Dialog „Turnier beenden“ (Aufruf `issueAwards(session.pubkey, occasion, texts)` dokumentiert). |

Oberfläche `components/tournaments/`: `register.ts` (Slot `tournaments.root`, Screens, `game.attachments` und `result.actions`, Link-Handler T1/TB1; die Registrierung für `club.tournaments` steht dokumentiert bereit), `use-tournaments.ts` (ein Store für alle Bildschirme; `useAutoAdmission` nimmt Anfragen bei „automatisch“ nur mit App-eigenem Schlüssel auf, nie über eine Signier-App), `use-live-matches.ts`, `tournaments-home.tsx`, `create-screen.tsx`, `tournament-screen.tsx` + `phase-card.tsx` + `matches-list.tsx` + `bracket-view.tsx`, `organize-screen.tsx` + `organize-sheets.tsx`, `board-screen.tsx`, `reporter.tsx` + `game-pieces.tsx`, `tv-screen.tsx`, `print-screen.tsx`, `club-tournaments.tsx`, `guest-profile.tsx` (gleich dem der Clubs; bei der Integration zusammenführen), `use-names.ts` (dito).

## Abweichungen und Grenzen

- Ergebnisse in Sätzen: `tournament.result.score` trägt zwei Zahlen. Bei Satzspielen sind das die Sätze; die Legs ergeben sich für die Engine als Mindestwert (Tabellen mit Satzspielen zählen daher keine echte Legdifferenz). Bei Legspielen sind es die Legs.
- Das Protokoll kennt kein „Spiel läuft“: Der Aufruf (`tournament.assign`) und die Live-Gründung des Boards sind die Hinweise; ein Board ohne Verbindung spielt und meldet später.
- Club-Turniere: `club` wird in der Gründung geführt und `club.verified` gelesen; versiegelte Datensätze geschlossener Clubs werden nicht geöffnet (kein `open`), die Prüfung der Clubrolle (`clubRole`) ist nicht angebunden. Das Club-Stück wartet auf die Slot-Liste `club.tournaments`.
- Auszeichnungen werden nicht vergeben (Integrationspunkt, siehe oben).
- Die Kalender-Adresse (NIP-52) wird nicht geschrieben.
- Übergabe: angeboten wird nur an angemeldete Spieler mit Profil (die Vorgabe „nur auf einem gerade geladenen Gerät“ wird durch den Abgleich beim Öffnen erfüllt, nicht erzwungen); der „Erweitert“-Hinweis für Übernehmende ohne Clubrolle fehlt (keine Clubanbindung).

## Messung 128 Teilnehmer, 16 Boards

`node docs/implementation/evidence/P6.02/scripts/measure-events.mjs --relay ws://127.0.0.1:20642` (nak serve, leer), Node 25.2.1, Apple Silicon, Laborwerte auf einer Maschine mit weiteren Agenten, keine Feldwerte:

- Einzel-K.-o. 128, 127 Spiele, 11 Runden mit Aufrufen: **657 Datensätze**, 428 kB JSON (275 bis zum Start: Gründung, 128 Anmeldungen, 128 Aufnahmen, 16 Boards, Festlegung/Auslosung, Phase).
- Lesen (Abspielen plus Spielplan, wie jeder Bildschirm): kalt 20 ms, warm 18 ms, Abspielen allein 6 ms, mit 16 Live-Spielen 19 ms.
- Eine Änderung der Leitung (Zustand lesen, Datensatz bauen): Aufruf p50 5,8 / p99 9,4 / max 9,9 ms; Freigabe p50 5,7 / p99 9,4 / max 17 ms.
- Relay: 657/657 angenommen in 143 ms (einzeln nacheinander); Abruf des ganzen Turniers 657 Datensätze in 729 ms über zwei Seiten, danach lesen 18 ms. Vor der Seitenaufteilung lieferte das Relay 501 Datensätze (Limit 500): das ist der Grund für das seitenweise Lesen.
- Abonnements: ein Bildschirm hält eine Subscription für das Turnier (zwei Filter) und eine für die Gründungen der Boards (ein Filter); je verfolgtem Live-Spiel kommt eine Match-Subscription (drei Filter) hinzu, bei 16 Boards also 2 + 16 × 3 = 50 Filter, die lib/nostr auf höchstens 15 REQs je Relay bündelt.

## Prüfungen

- `tests/tournament-read.test.ts` (Node): Entwurf → Gründung, voller Ablauf Anmeldung/Aufnahme/Auslosung/Board/Live/Ergebnis/Freigabe/Korrektur (Finale betroffen)/Rückkorrektur/Ende/Anlass/CSV/JSON; Gruppenabhängigkeiten; Store-Liste `unsent`.
- `tests/relay/tournament.test.ts` (nak serve, Port 20641): derselbe Ablauf über ein echtes Relay mit Board-Gerät, öffentlicher Live-Gründung, Fund über den Board-Schlüssel, Meldung mit Board-Schlüssel, Freigabe, Korrektur; dazu ein Board, dessen Relay weg ist und dessen Ergebnis nach der Rückkehr ankommt.
- `docs/implementation/evidence/P6.02/scripts/tournament-flows.mjs` (Chromium, mehrere Kontexte gegen nak auf 20640, App auf 3322): Anlage in vier Schritten mit Profil nebenbei, Teilen, zwei Spieler melden sich an und werden automatisch aufgenommen, Auslosung, Start, Aufrufe, Board-Code, Board-Gerät übernimmt und startet das Spiel live. Screenshots in `screens/`.
