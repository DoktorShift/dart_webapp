# P6.01 Turnierengine: Regeln

Stand: 4. Oktober 2026 nach Review-Runde 1, Branch `wave1/tengine`. Diese Regeln setzt `lib/tournaments/` um; die erwarteten Turnierbäume, Tabellen und Plätze in `tests/tournament-engine.test.ts` sind von Hand aus diesen Regeln hergeleitet. Ändert sich eine Regel, ändern sich Engine, Tests, dieser Text und die Regeltexte in `lib/i18n/features/tournaments.*.ts` gemeinsam.

Die Engine ist reines TypeScript ohne Netz, Uhr und React. Ein Turnier besteht aus Auslosung, festem Spielplan und den seither getroffenen Entscheidungen (Ergebnisse, kampflose Spiele, Boards, Rückzüge). Alles, was eine Ansicht zeigt, wird daraus berechnet (`resolveTournament`). Das Turnier ist reines JSON und trägt die Regelversion `engine: 1`; eine spätere Regeländerung bekommt eine neue Nummer, damit gespeicherte Turniere nie ihre Paarungen ändern. Eine unbekannte Nummer wird abgewiesen, nicht geraten.

## Formate und Grenzen

| Format | Mindestens | Höchstens | Spiele |
| --- | --- | --- | --- |
| K.-o.-System | 2 | 128 | n − 1 |
| Doppel-K.-o. | 3 | 128 | 2n − 2, mit Entscheidungsspiel 2n − 1 |
| Jeder gegen jeden | 2 | 64 | n(n − 1)/2, mit Hin- und Rückrunde doppelt |
| Gruppen, dann K.-o. | 3 | 128, je Gruppe höchstens 64 | Gruppenspiele plus K.-o.-Runde |

Jeder gegen jeden ist auf 64 begrenzt: 128 Spieler wären 8128 Spiele in 127 Runden, kein spielbares Turnier. Große Felder spielen Gruppen.

## Setzliste und Auslosung

- Die Teilnehmer stehen in Setzreihenfolge. Die ersten *k* (Einstellung „gesetzt“) behalten ihren Platz; alle anderen werden ausgelost. *k* = 0 lost alle aus, *k* = n übernimmt die Reihenfolge.
- **Auslosung:** Jeder nicht gesetzte Teilnehmer bekommt die Zahl SHA-256(`blueline-draw-v1` ↵ Auslosungscode ↵ Teilnehmer-ID); sie werden aufsteigend nach dieser Zahl einsortiert. Derselbe Code und dasselbe Feld ergeben immer dieselbe Reihenfolge, egal in welcher Reihenfolge die Namen eingegeben wurden. Eine Nachmeldung schiebt sich nur dazwischen; die anderen behalten ihre Reihenfolge untereinander.
- **Auslosungscode:** 128 Bit Zufall (`createDrawSeed`). Die Turnierleitung kann vor Ende des Check-ins die Zusage SHA-256(`blueline-seed-v1` ↵ Code) zeigen (`commitSeed`) und bei der Auslosung den Code; jeder kann dann Zusage und Paarungen nachrechnen (`verifySeed`). So kann die Leitung nach der Anmeldung nicht mehr so lange neue Codes probieren, bis ihr eine Auslosung gefällt.
- **Nachmeldung und Abmeldung vor der Auslosung** ändern nur die Teilnehmerliste (`addEntry`, `removeEntry`). Die Auslosung ist das Anlegen des Turniers (`createTournament`); danach ändert sich das Feld nur noch über Rückzug oder Disqualifikation.

## K.-o.-Baum, Setzung und Freilose

- Das Feld wird auf die nächste Zweierpotenz aufgefüllt (5 → 8, 13 → 16). Die Plätze im Baum folgen der üblichen Setzordnung, in der Setzplatz *s* in Runde 1 auf Setzplatz Größe + 1 − *s* trifft:
  - 4: 1 4 2 3
  - 8: 1 8 4 5 2 7 3 6
  - 16: 1 16 8 9 4 13 5 12 2 15 7 10 3 14 6 11
- So treffen 1 und 2 frühestens im Finale aufeinander, die ersten vier frühestens im Halbfinale.
- **Freilose** sind die Plätze über der Feldgröße. Sie fallen damit auf die bestgesetzten Spieler (bei 13 auf 1, 2 und 3). Ein Freilos ist kein Spiel: Es erscheint nirgends als gespielt, der Spieler steht direkt in seinem Zweitrundenspiel.
- Spielkennungen: `K<Runde>-<Position>` mit der Position im vollen Baum; eine erste Runde mit Freilosen hat deshalb Lücken (13 Spieler: K1-2, K1-3, K1-4, K1-6, K1-8).
- Runden heißen vom Ende her Finale, Halbfinale, Viertelfinale, Achtelfinale, davor „Runde *n*“. Maßgeblich ist die Größe des Baums: Bei 5 Spielern ist die erste Runde das Viertelfinale.

## Doppel-K.-o.

- **Gewinnerrunde** (`W…`) wie das K.-o.-System.
- **Verliererrunde** (`L…`) bei einem Baum der Größe 2^k mit 2(k − 1) Runden:
  - L1: die Verlierer der ersten Runde gegeneinander, Verlierer von W1-1 gegen Verlierer von W1-2 usw.
  - L2, L4, …: Die Sieger der vorigen Verliererrunde treffen auf die Verlierer der nächsten Gewinnerrunde. Diese kommen **paarweise über Kreuz** herein: Wer aus dem Bereich von W2-1 kommt, trifft den Verlierer von W2-2 und umgekehrt.
  - L3, L5, …: Die Sieger der Runde davor spielen gegeneinander.
- Folge der Überkreuzung: Bei vollem Feld trifft niemand in seinem ersten Spiel nach dem Abstieg auf jemanden, gegen den er in der Gewinnerrunde schon gespielt hat. Ausnahme ist nur der Verlierer des Finales der Gewinnerrunde, weil sein Bereich der ganze Baum ist. Mit Freilosen ist die Verliererrunde kürzer; dann kann eine sofortige Wiederbegegnung unvermeidbar sein (bei 5 Spielern trifft der Verlierer von 4 gegen 5 nacheinander auf die Verlierer beider Zweitrundenspiele, und jeder davon kann sein früherer Gegner sein).
- Verliererspiele, denen durch Freilose ein Spieler fehlt, entfallen; der vorhandene Spieler rückt weiter. Ganz leere Verliererrunden entfallen, die Rundenzählung wird ohne Lücken neu gezählt (bei 5 und 6 Spielern heißt L2 „Verliererrunde 1“).
- **Finale** (`GF`): Sieger der Gewinnerrunde gegen Sieger der Verliererrunde.
- **Entscheidungsspiel** (`GF2`, Voreinstellung an): Gewinnt im Finale der Spieler aus der Verliererrunde, hat jeder einmal verloren, und es wird noch einmal gespielt. Gewinnt der Spieler aus der Gewinnerrunde, entfällt das Entscheidungsspiel. Ohne Entscheidungsspiel entscheidet das eine Finale.
- Beispiel 8 Spieler (von Hand durchgespielt im Test): Plätze 1, 2, 3, 4, 5–6, 7–8.

## Jeder gegen jeden

- **Kreismethode:** Spieler 1 bleibt fest, alle anderen rücken jede Runde einen Platz weiter. Bei ungerader Zahl kommt ein Platzhalter dazu; wer auf ihn trifft, hat spielfrei. Der besser Gesetzte steht vorn; in der Rückrunde sind die Seiten getauscht.
- Beispiel 4 Spieler: Runde 1: 1–4, 2–3; Runde 2: 1–3, 2–4; Runde 3: 1–2, 3–4.
- Beispiel 5 Spieler: Runde 1: 2–5, 3–4 (1 spielfrei); Runde 2: 1–5, 2–3 (4 spielfrei); Runde 3: 1–4, 3–5 (2 spielfrei); Runde 4: 1–3, 2–4 (5 spielfrei); Runde 5: 1–2, 4–5 (3 spielfrei).
- Alle Spiele sind von Anfang an bereit, weil keines auf ein anderes wartet. Die Board-Vorschläge gehen in Spielreihenfolge vor; ein späteres Spiel kommt nur dran, wenn seine Spieler frei sind und frühere Spiele noch nicht aufgerufen werden können.

## Tabelle

Ein Sieg bringt 2 Punkte, eine Niederlage keinen; Unentschieden gibt es nicht. Bei Gleichstand entscheidet der Reihe nach:

1. Punkte
2. Satzdifferenz (nur wenn in Sätzen gespielt wird)
3. Legdifferenz
4. Gewonnene Legs
5. Direkter Vergleich, stufenweise: Siege in den Spielen der danach noch Gleichstehenden untereinander. Wer danach immer noch gleich steht, wird erneut verglichen, jetzt nur über die Spiele dieser Spieler untereinander (bei zwei Spielern ist das ihr direktes Spiel). Das wiederholt sich, bis eine Stufe niemanden mehr trennt.
6. Los: SHA-256(`blueline-lot-v1` ↵ Auslosungscode ↵ Teilnehmer-ID), die kleinere Zahl steht vorn. Das Los steht mit der Auslosung fest, bevor ein Pfeil geworfen ist. Es entscheidet nur zwischen Spielern, die der direkte Vergleich nicht trennen kann, etwa bei einem Ring (A schlägt B, B schlägt C, C schlägt A).

Beispiel für den stufenweisen Vergleich (im Test): Fünf Spieler; A, B, C und D haben je 4 Punkte und 8:8 Legs, E hat 4 Punkte und 7:7 und steht wegen weniger gewonnener Legs dahinter. Siege der vier untereinander: A 2 (gegen B und C), B 2 (gegen C und D), C 1 (gegen D), D 1 (gegen A). Die erste Stufe trennt A und B von C und D; die zweite vergleicht jedes Paar für sich, also ihr direktes Spiel: A hat B geschlagen, C hat D geschlagen. Reihenfolge A, B, C, D, E, mit jedem Auslosungscode.

Jede Zeile nennt das Kriterium, das sie von der Zeile darüber trennt. Ein kampflos gewonnenes Spiel zählt als Sieg ohne Legs; geben beide auf, verlieren beide. Ein Spiel, das von einer Korrektur betroffen ist, zählt erst wieder, wenn die Leitung entschieden hat; bis dahin ist die Tabelle nicht abgeschlossen.

## Gruppen, dann K.-o.

- **Schlangenverteilung:** Setzplätze 1 bis G gehen in die Gruppen A bis G, die nächsten G von G zurück nach A, und so weiter. Die Gruppen unterscheiden sich um höchstens einen Spieler. Beispiel 8 Spieler, 2 Gruppen: A = 1, 4, 5, 8; B = 2, 3, 6, 7.
- In jeder Gruppe spielt jeder gegen jeden; die Runden laufen über alle Gruppen gemeinsam.
- Die besten *m* jeder Gruppe gehen weiter. Gruppensieger sind die K.-o.-Setzplätze 1 bis G (in Gruppenreihenfolge), danach die Zweiten, Dritten usw. Jeder dieser Plätze nimmt die Gruppe, deren Spieler er am spätesten treffen kann; bei Gleichheit die Partnergruppe seines ersten Gegners (A↔B, C↔D, …), sonst die erste. Ergebnis:
  - 2 Gruppen, je 2: A1–B2, B1–A2
  - 4 Gruppen, je 2: A1–B2, D1–C2, B1–A2, C1–D2 (jeder Zweite in der anderen Hälfte als sein Gruppensieger)
  - 2 Gruppen, je 4: A1–B4, B2–A3, B1–A4, A2–B3
  - 3 Gruppen, je 2: Freilose für A1 und B1; B2–C2, C1–A2
- Ein K.-o.-Platz wird besetzt, sobald seine Gruppe vollständig gespielt ist.

## Spiele

| Zustand | Bedeutung |
| --- | --- |
| Gegner steht noch nicht fest (`pending`) | mindestens ein Spieler offen |
| Bereit (`ready`) | beide bekannt, nicht begonnen; ein Board kann zugewiesen sein |
| Läuft (`live`) | begonnen |
| Beendet (`finished`) | mit Ergebnis in Legs und gegebenenfalls Sätzen |
| Kampflos (`walkover`) | nicht angetreten, aufgegeben, zurückgezogen oder Freilos, weil die Gegenseite leer bleibt |
| Entfällt (`void`) | beide Seiten leer oder Entscheidungsspiel nicht nötig |

Jeder Spielplatz nennt seine Herkunft: Setzplatz, Sieger von, Verlierer von oder Gruppenplatz. Ein Ergebnis muss das Spiel beenden können: genau eine Seite erreicht die Legs zum Sieg; in Sätzen genau eine Seite die Sätze zum Sieg, und die Legs passen dazu (gewonnene Sätze mit den Legs zum Sieg, verlorene mit weniger). Finale, Doppel-K.-o.-Finale und Entscheidungsspiel können länger gespielt werden (`rules.final`).

## Korrekturen

Eine Korrektur ist ein erneut eingetragenes Ergebnis.

- Folgespiele, die **noch nicht begonnen** haben, bekommen einfach ihre neuen Spieler.
- Folgespiele, die **begonnen oder beendet** sind und nicht mehr zu den Spielern passen, werden **nicht still neu besetzt** (PLAN.md Zeile 392). Sie werden als „Betroffen von einer Korrektur“ markiert: Der Eintrag bleibt, wie er ist, und von ihm rückt niemand weiter; alles danach wartet. Die Leitung entscheidet: neu spielen (`resetMatch`) oder das Ergebnis der neuen Paarung eintragen. Wird die Korrektur zurückgenommen, passt der Eintrag wieder.
- Eine Korrektur mit demselben Sieger ändert nichts nach dem Spiel.
- Vor dem Übernehmen zeigt `previewChange` die Folgen je Spiel: „Neues Ergebnis“, „Neue Paarung“, „Muss entschieden werden“, „Passt wieder“.
- Ein Gruppenergebnis, das nach Beginn der K.-o.-Runde korrigiert wird und die Tabelle ändert, markiert die betroffenen K.-o.-Spiele genauso.
- Ein aufgerufenes Spiel, das nach einer Korrektur wieder warten muss, gibt sein Board frei, sobald das Board einem anderen Spiel zugewiesen wird.
- Nimmt die Leitung ein Ergebnis oder ein kampfloses Spiel zurück (`resetMatch`), verliert das Spiel auch das Board, an dem es gespielt wurde: Dieses Board kann inzwischen ein anderes Spiel tragen. Ein zurückgenommener Start behält sein Board, denn solange ein Spiel läuft, kann niemand sonst sein Board bekommen.
- Solange ein Spiel betroffen ist, gibt es keinen Turniersieger, auch wenn das Finale schon entschieden aussieht. Beispiel Doppel-K.-o.: Das Entscheidungsspiel wurde gespielt, dann wird das Finale zugunsten des Spielers aus der Gewinnerrunde korrigiert. Das Entscheidungsspiel ist nun nicht mehr nötig, aber gespielt, also betroffen; erst wenn die Leitung es zurücknimmt, entfällt es, und das Turnier ist beendet.

## Nicht angetreten, Rückzug, Disqualifikation

- **Nicht angetreten oder aufgegeben** betrifft ein einzelnes Spiel: Der Gegner gewinnt kampflos, der Spieler bleibt im Turnier (im Doppel-K.-o. steigt er in die Verliererrunde ab, in der Tabelle ist es eine Niederlage ohne Legs).
- **Rückzug nach der Auslosung:** Gespielte Ergebnisse bleiben. Jedes noch nicht entschiedene Spiel, auch ein laufendes, verliert er kampflos („Zurückgezogen“). Ziehen beide Spieler eines Spiels zurück, rückt niemand weiter, und der nächste Gegner hat ein Freilos. Im Doppel-K.-o. verliert er in beiden Runden kampflos und scheidet in der Verliererrunde aus.
- In einer Tabelle steht, wer zurückzieht, am Ende und kommt nicht weiter. **Ausnahme Gruppen:** War die eigene Gruppe beim Rückzug schon fertig, bleibt der Tabellenplatz (die gezeigten K.-o.-Paarungen bleiben), und das K.-o.-Spiel gewinnt der Gegner kampflos.
- **Disqualifikation** wirkt wie ein Rückzug, aber ohne Platz; die anderen rücken auf. Ein Rückzug kann später zur Disqualifikation werden.
- Für die Spiele, die ein Zurückgezogener oder Disqualifizierter kampflos verliert, lässt sich weder ein Ergebnis noch ein anderer kampfloser Ausgang eintragen. Korrigieren lässt sich nur, was vor dem Rückzug für dieselben zwei Spieler als Ergebnis oder kampflos eingetragen war. Wurde ein beim Rückzug laufendes Spiel in Wahrheit noch zu Ende gespielt: Rückzug zurücknehmen, Ergebnis eintragen und, wenn das Turnier danach weitergeht, wieder zurückziehen. Das geht auch, wenn erst der Rückzug das Turnier beendet hat (siehe unten).
- Niemand gewinnt ein Turnier, nachdem er zurückgezogen hat oder disqualifiziert wurde. Möglich wäre das nur auf einem Umweg: Das entscheidende Spiel war gespielt, beim Rückzug aber durch eine Korrektur betroffen, und die Korrektur wird danach zurückgenommen. Dann bleibt das Spiel betroffen, bis die Leitung entscheidet: neu spielen (der Gegner gewinnt kampflos), das Ergebnis korrigieren oder den Rückzug zurücknehmen.
- Ein Rückzug kann zurückgenommen werden (`reinstate`); vor Turnierende werden bereits darauf aufbauende Spiele dann als betroffen markiert.
- Nach Turnierende sind Rückzug und Disqualifikation nicht mehr möglich. Zurücknehmen lässt sich ein Rückzug oder eine Disqualifikation dann nur noch, wenn dadurch kein Spiel betroffen wird: Kein eingetragenes Ergebnis ändert sich, es öffnen sich nur die Spiele wieder, die der Rückzug kampflos vergeben hat. Das ist der Fall, wenn erst der Rückzug das Turnier beendet hat, etwa wenn ein Finalist versehentlich zurückgezogen oder disqualifiziert wurde oder im Jeder gegen jeden das letzte offene Spiel kampflos vergeben wurde. Im Jeder gegen jeden baut kein Spiel auf einem anderen auf; dort öffnen sich nach der Rücknahme alle Spiele wieder, die der Spieler kampflos verloren hat. Nach der Rücknahme ist dieses Spiel wieder bereit (oder läuft wieder, wenn es schon begonnen hatte), im Doppel-K.-o. ist auch das Entscheidungsspiel wieder möglich, und das Turnier geht weiter. Wurde ein Spieler erst nach seinem Ausscheiden disqualifiziert, öffnet sich kein Spiel; er bekommt nur seinen Platz zurück. Bauen dagegen gespielte Spiele auf dem Rückzug auf (Beispiel: Rückzug vor der ersten Runde, der kampflose Sieger hat danach das Finale gespielt), bleibt der Rückzug bestehen (`tournamentComplete`), denn die Rücknahme würde diese Spiele betreffen. Was sich öffnet, zeigt vorher die Vorschau der Folgen (`previewChange`). Eine Ergebniskorrektur nach Turnierende bleibt ohnehin möglich; sie öffnet das Turnier wieder und markiert, was darauf aufbaut.

## Plätze

- **K.-o. und Doppel-K.-o.:** Wer in derselben Runde ausscheidet, teilt sich den Platz: Platz = Feldgröße − Ausgeschiedene bis einschließlich dieser Runde + 1, bis Feldgröße − Ausgeschiedene vor dieser Runde. Im Doppel-K.-o. scheidet man nur in der Verliererrunde oder im Finale aus. Ein Platz steht fest, sobald der Spieler ausgeschieden ist.
  - 8 Spieler: 1, 2, 3–4, 5–8; 13 Spieler: 1, 2, 3–4, 5–8, 9–13; 5 Spieler: 1, 2, 3–4, 5.
- **Jeder gegen jeden:** Tabellenplatz, sobald alle Spiele entschieden sind.
- **Gruppen, dann K.-o.:** Die K.-o.-Runden stehen über der Gruppenphase. Wer in der Gruppe ausscheidet, teilt sich den Platz mit den Gleichplatzierten der anderen Gruppen (bei 2 × 4 mit je 2 weiter: Dritte 5–6, Vierte 7–8).
- **Disqualifizierte** bekommen keinen Platz und zählen nicht mit: Die anderen teilen sich die Plätze 1 bis Feldgröße − Disqualifizierte.

## Boards und nächste Spiele

- Ein Board trägt höchstens ein bereites oder laufendes Spiel. Beendete Spiele behalten ihr Board als Ort, an dem sie gespielt wurden. Ein Spieler kann nicht zwei Spiele gleichzeitig spielen.
- Ein Spiel, das ohne Board-Angabe startet, nimmt das Board, zu dem es aufgerufen wurde, und nur, wenn dieses frei ist.
- `suggestBoards` verteilt bereite Spiele in Spielreihenfolge auf freie Boards, ohne jemanden doppelt aufzurufen, der gerade spielt oder schon aufgerufen ist.
- `nextMatch` nennt je Spieler das laufende Spiel, sonst das erste bereite, sonst das erste, in dem der Gegner noch offen ist; nichts für Ausgeschiedene und Zurückgezogene. Ein betroffenes Spiel erscheint bei seinen neuen Spielern als wartend, bis die Leitung entschieden hat, und bekommt kein Board.
- `roundProgress` zählt je Runde entschiedene, laufende, bereite und wartende Spiele (entfallende nicht).

## Leistung

Gemessen am 4. Oktober 2026 mit [scripts/measure-load.mjs](scripts/measure-load.mjs), Node 25.2.1, macOS, Apple Silicon, reine Engine ohne Darstellung. Jede Änderung einschließlich der neuen Gesamtberechnung; 16 Boards, alle Spiele bis zum Ende.

| Format | Spiele | Auslosung kalt / warm (ms) | Board-Aufruf p50 / p99 / max (ms) | Ergebnis p50 / p99 / max (ms) |
| --- | --- | --- | --- | --- |
| K.-o., 128 | 127 | 9,3 / 2,4 | 0,1 / 0,4 / 0,9 | 0,1 / 1,0 / 1,8 |
| Doppel-K.-o., 128 | 255 | 2,3 / 1,4 | 0,2 / 1,2 / 2,6 | 0,1 / 0,5 / 1,4 |
| Gruppen 32 × 4, dann K.-o., 128 | 255 | 5,3 / 2,0 | 0,2 / 0,9 / 3,7 | 0,2 / 0,5 / 1,9 |
| Gruppen 2 × 64, dann K.-o., 128 | 4039 | 6,8 / 5,9 | 2,9 / 14,8 / 105,3 | 2,0 / 11,2 / 41,9 |
| Jeder gegen jeden, 64 | 2016 | 11,7 / 4,4 | 2,4 / 12,6 / 28,7 | 1,5 / 10,9 / 34,9 |

Die einzelnen Spitzen über 50 ms bei 4039 Spielen sind vermutlich Speicherbereinigungen (nicht einzeln nachgewiesen); p99 bleibt bei allen Formaten unter 15 ms.

**Nach Review-Runde 1** (stufenweiser direkter Vergleich, Board-Regeln beim Zurücknehmen), am selben Tag: Der Rechner war stark ausgelastet (Load Average um 13, andere Builds liefen parallel); Wanduhrzeiten schwankten deshalb bis in den Sekundenbereich, beim alten Stand genauso. Gemessen wurde darum die Prozessorzeit des Threads (`measure-load.mjs --cpu`):

| Format | Spiele | Auslosung kalt / warm (ms) | Board-Aufruf p50 / p99 / max (ms) | Ergebnis p50 / p99 / max (ms) |
| --- | --- | --- | --- | --- |
| K.-o., 128 | 127 | 12,9 / 2,7 | 0,3 / 0,6 / 0,9 | 0,3 / 1,6 / 1,9 |
| Doppel-K.-o., 128 | 255 | 4,0 / 2,4 | 0,3 / 0,8 / 2,7 | 0,3 / 1,2 / 2,6 |
| Gruppen 32 × 4, dann K.-o., 128 | 255 | 9,5 / 3,0 | 0,4 / 1,0 / 2,0 | 0,3 / 0,9 / 4,8 |
| Gruppen 2 × 64, dann K.-o., 128 | 4039 | 9,4 / 9,2 | 5,7 / 12,0 / 30,5 | 4,8 / 8,9 / 45,0 |
| Jeder gegen jeden, 64 | 2016 | 12,3 / 9,5 | 2,9 / 8,7 / 31,7 | 1,9 / 4,8 / 17,6 |

Alter und neuer Tabellenstand im Wechsel, je zwei Läufe, ebenfalls Prozessorzeit: Gruppen 2 × 64 Board-Aufruf p99 10,1–11,3 ms (alt) gegenüber 9,1–9,7 ms (neu), Ergebnis p99 8,4–8,7 gegenüber 7,3–7,7 ms; Jeder gegen jeden 64 Board-Aufruf p99 5,4–6,9 gegenüber 4,5–6,3 ms, Ergebnis p99 3,3–3,7 gegenüber 3,5–3,8 ms. Der stufenweise Vergleich kostet also nichts Messbares.

Der Test `load: 128 participants and 16 boards` prüft in jedem Lauf von `npm test` Auslosung (schnellste von drei) und das 99. Perzentil von Board-Aufrufen und Ergebnissen gegen 50 ms Prozessorzeit. Messungen auf Telefonen und mit Darstellung gehören zu P6.04.
