# P8.01 Gesamter Spielabend – Nachweis

Ein zusammenhängender Playwright-Lauf (Chromium) spielt einen ganzen Abend mit mehreren Browser-Kontexten als Geräte, gegen einen Produktions-Build. Alles bleibt lokal: zwei frische `nak serve`-Relays auf 127.0.0.1, NIP-47-Wallet-Simulatoren (`tests/support/fake-wallet.ts`). Jede andere Anfrage wird abgewiesen und gezählt; nur der Wechselkurs bekommt einen festen Wert, wie in den P7b-Skripten.

## Was der Lauf abdeckt

| Gerät | Größe | Rolle |
| --- | --- | --- |
| anna-phone | 390×844, DE, hell | Gast → Profil, Club-Eigentümerin, Turnierleitung und Mitspielerin, zahlt den Einsatz |
| anna-second | 320×548, DE, dunkel | zweites eigenes Gerät (Kopplung per getipptem Code) |
| anna-third-en | 390×844, EN, dunkel | drittes Gerät, Wiederherstellung aus der Sicherungsdatei |
| ben-phone | 390×844, DE, hell | Freund: tritt per Link als Gast bei und hat danach ein Profil, bestätigt das Clubergebnis, spielt das Turnier, empfängt den Einsatz |
| carla-phone | 320×548, DE, hell | Zuschauerin des Live-Spiels, danach Turnierteilnehmerin; bekommt am Ende eine Einladung direkt an ihr Profil |
| carl-phone | 390×844, DE, hell | kommt über den gesagten Code eines Mitglieds in den Club |
| board-tablet | 1024×768, DE, hell | Board 1 des Turniers |

Die Schritte: ein 301 als Gast (ohne Profil und ohne Verbindung) → „Deine Ergebnisse mitnehmen“ → zweites Gerät koppeln → Sicherungsdatei → Wiederherstellung auf einem dritten Gerät → Club gründen und per Link einladen → Beitritt als Gast → Clubspiel aus dem Club, live mit Zuschauerin → Ben bestätigt auf seinem Telefon → Turnier mit 4 Plätzen (Anna, Ben, Carla, Gast Mia), K.-o., Board-Gerät: Check-in, Auslosung, Aufruf, Meldung vom Board, Freigabe, Finale, Ende mit Auszeichnungen → Auszeichnung von der Turnierseite auf Bens Profilkarte → Rangliste auf Annas Telefon: „Hier gespielt“ mit Zeitraum „Heute“ (Anna und Ben in der Wertung, Siegquote mit Spielen), Bereich Clubs mit der Saisontabelle, Bereich Turniere mit Annas Platz → Anna importiert eine Tabelle mit sechs früheren Spielen (`fixtures/spielverlauf.csv`, darunter drei Trainings in diesem Monat): Vorschau mit Spielen, Zeitraum und Namen, ihr Name vorgewählt, danach zählen die Spiele für sie und „Jonas“ steht als importiert in der Rangliste → Einsatz 500 sats: Bens Telefon zeigt den Zahlungscode, Anna zahlt mit Doppeltipp, die Wallet zahlt genau einmal → Ben (Mitglied) zeigt seinen Einladelink mit Code, Carl tippt den Code unter „Code scannen“, fragt an, Anna sieht „Eingeladen von Ben“ und nimmt ihn auf → Anna schickt Carla eine Einladung direkt an ihr Profil (Profilcode, Name bestätigen, senden), die bei Carla unter Clubs erscheint; Carla fragt an, Anna bestätigt, Carlas Telefon sagt „Du bist dabei“ ohne Neuladen → Anna und Ben werden Freunde: aus der Zeile „Freunde hinzufügen“ auf Annas Profilkarte in das Blatt und Ben aus „Zuletzt gespielt mit“, „1 Anfrage“ auf Bens Profil-Tab und auf seiner Profilkarte, Annas Anfrage als Karte mit „Annehmen“ unter Bens Profilkarte, Annehmen in der Zeile, Annas Liste folgt von selbst, „Befreundet“ auf der Spielerseite, Rangliste › Freunde, Ben als ein Chip mit Profil in der Spielvorbereitung; die Anfrage steht als Zahl auf Bens Profil-Tab, bis er antwortet, und Annas zweites Gerät wie ihr aus der Sicherung wiederhergestelltes zeigen Ben von selbst unter Freunde. Geprüft wird jeweils, was die Spieler sehen; pro Schritt entsteht ein Screenshot in Gerätegröße.

`expect` prüft den Ablauf (ein Fehler hält den Abend an). `expect.note` hält Befunde an der App fest, ohne den Abend anzuhalten (NOTE).

Mit `MATRIX=1` folgt der HIG-Durchgang (`hig-matrix.mjs`): Spielen, Rangliste mit ihren vier Bereichen (Hier gespielt, Freunde, Clubs, Turniere), Profil › Freunde mit dem Blatt „Freund hinzufügen“, Clubs, Club, Turniere, Turnier, Profil mit Statistik, Training (nach einem Training allein und den drei importierten, mit gesetztem Ziel 60 als Linie im Verlauf, dem Blatt dazu und dem Bild-Blatt vor dem Teilen), Sichtbarkeit, Spielverlauf und die Vorschau eines Imports, und der Ergebnisbildschirm mit Einsatz, in DE hell und EN dunkel, bei 320×548, 390×844, 568×320, 768×1024 und 1024×768, aus Annas Zustand nach dem Abend. Dazu kommen der Spielbildschirm mit 1 bis 6 Spielern als ein fester Bildschirm und die leeren und Offline-Zustände eines Gastgeräts. Jeder Screenshot bekommt die Layoutprüfung aus `lib.mjs` (Auslassungspunkte, abgeschnitten, waagerechtes Scrollen, Ziele unter 44 pt) und eine Suche nach Protokollwörtern.

## Ausführen

```sh
NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20350,ws://127.0.0.1:20351 npm run build
npx next start -p 3345 &
node docs/implementation/evidence/P8/scripts/darts-night.mjs            # nur der Abend, etwa 2 min
MATRIX=1 node docs/implementation/evidence/P8/scripts/darts-night.mjs   # mit HIG-Matrix, etwa 7 min
```

Optional: `BASE`, `OUT` (Screenshots, Standard `$TMPDIR/blueline-p8`), `RELAY_PORTS`. Das Skript startet seine Relays selbst und bricht ab, wenn ein Port schon belegt ist (alte Daten). Am Ende beendet es Browser, Wallets und Relays. Exit-Code 0 heißt: jeder Schritt bestanden.

## Letztes Ergebnis (2026-10-26, Arbeitsstand des Zweigs `ux/profil-rangliste` nach dem UX-Umbau von Profil und Rangliste, Skript wie in diesem Stand, Laborwerte auf einem ausgelasteten Entwicklungsrechner)

Lauf mit `MATRIX=1`, Relays auf 127.0.0.1:20350 und :20351, Server auf Port 3345.

| # | Step | Result | Checks | Notes | Time (lab) |
| --- | --- | --- | --- | --- | --- |
| 1 | Gast spielt 301 ohne Profil und ohne Netz | pass | 4/4 | 0 | 5.2 s |
| 2 | Ergebnisse vom Ergebnisbildschirm in ein neues Profil | pass | 5/5 | 0 | 4.2 s |
| 3 | Zweites eigenes Gerät koppeln (Code getippt) | pass | 4/4 | 0 | 7.3 s |
| 4 | Profil in eine Sicherungsdatei sichern | pass | 4/4 | 0 | 2.6 s |
| 5 | Sicherung auf einem dritten Gerät öffnen (Englisch, dunkel) | pass | 2/2 | 0 | 3.4 s |
| 6 | Club gründen und Ben per Link einladen | pass | 5/5 | 0 | 2.7 s |
| 7 | Ben tritt per Link als Gast bei und hat danach ein Profil | pass | 3/3 | 0 | 2.5 s |
| 8 | Clubspiel aus dem Club, live mit Zuschauerin | pass | 5/5 | 0 | 8.4 s |
| 9 | Ben bestätigt das Clubergebnis auf seinem Telefon | pass | 1/1 | 0 | 4.9 s |
| 10 | Turnier anlegen: 4 Plätze, ein Gast, Board 1 | pass | 4/4 | 0 | 4.1 s |
| 11 | Ben und Carla melden sich an | pass | 2/2 | 0 | 3.0 s |
| 12 | Check-in und Auslosung | pass | 1/1 | 0 | 3.6 s |
| 13 | Board-Gerät: Aufruf, Spiel, Meldung, Freigabe (2 Halbfinals) | pass | 4/4 | 0 | 14.6 s |
| 14 | Finale, Turnier beenden mit Auszeichnungen | pass | 4/4 | 0 | 8.9 s |
| 15 | Auszeichnung erscheint auf Bens Profilkarte | pass | 2/2 | 0 | 4.2 s |
| 16 | Rangliste heute Abend: Hier gespielt, Clubs, Turniere auf Annas Telefon | pass | 5/5 | 0 | 4.1 s |
| 17 | Einsatz 500 sats: Anna zahlt Ben mit der Wallet, genau einmal | pass | 8/8 | 0 | 17.6 s |
| 18 | Ben (Mitglied) lädt Carl per Code ein, Anna nimmt ihn auf | pass | 5/5 | 0 | 7.7 s |
| 19 | Anna lädt Carla direkt an ihr Profil ein | pass | 6/6 | 0 | 11.4 s |
| 20 | Ganzer Abend: nur lokale Verbindungen, keine Seitenfehler | pass | 15/15 | 0 | 0.2 s |
| | Whole evening | pass | 89/89 | 0 | 120.4 s |

HIG-Matrix: 204 von 204 Prüfungen halten. Layoutprüfung: 222 Screenshots, 2 mit Hinweisen (dieselbe Stelle in DE und EN: Spielerkacheln 145×29 bei 6 Spielern auf 320×548, Befund 8). Neu im Abend: Schritt 16 (Rangliste heute Abend) prüft die drei Bereiche des Tabs auf Annas Telefon; Schritt 2 prüft die Sportkarte des neuen Profils („Siege 100 % · 1 von 1“, „X01 gegen andere“). Neu in der Matrix: die Bereiche Clubs und Turniere der Rangliste, die Profilbildschirme Statistik, Training (Anna spielt dafür ein 301 allein), Sichtbarkeit und das Blatt Spielverlauf, je Sprache und Größe. Alle Screenshots ohne Auslassungspunkte, abgeschnittenen Text oder waagerechtes Scrollen; der eine Hinweis ist die bekannte Stelle (Spielerkacheln bei 6 Spielern auf 320×548, Befund 8).

### Ergebnis vom 2026-10-26 (Zweig `ux/freunde-profil`, Freunde auf der Profilkarte und „Weiter spielen“, Skript wie in diesem Stand)

Ganzer Abend bestanden, 117 von 117 Prüfungen in 22 Schritten (Laborwerte). Schritt 21 „Anna und Ben werden Freunde“ (23 von 23) läuft jetzt über die neuen Orte: Annas Profilkarte trägt die Zeile „Freunde hinzufügen“, die Profil › Freunde mit offenem Blatt öffnet; nach der Anfrage sagt Bens Profil-Tab „1 Anfrage“ als Zahl auf dem Symbol, während er auf Spielen ist, dann die Freundeszeile seiner Profilkarte („Freunde · 1 Anfrage“), und Annas Anfrage steht als Karte mit „Anfrage von Anna annehmen“ unter seiner Profilkarte; die Liste zeigt sie unter Anfragen, nach dem Annehmen „Freunde seit“ beziehungsweise die gemeinsamen Spiele mit dem letzten Datum, und die Zahl auf dem Tab ist weg; Annas Liste folgt von selbst, ebenso auf ihrem gekoppelten zweiten und ihrem aus der Sicherung wiederhergestellten dritten Gerät (Englisch: „games together“ oder „Friends since“). Behoben dabei: ohne Datensatz auf den Relays fiel die Zeile bei jeder Änderung im Speicher auf „Freunde“ ohne Zahl zurück (`use-friends.ts`, `load()` las eine Gerätekopie, die es nicht gibt). HIG-Matrix: 304 von 304 Prüfungen halten; neu je Größe und Sprache: die Rangliste mit einem verlassenen Spiel als „Weiter spielen“-Streifen über der Tab-Leiste (auf dem Telefon quer tritt der Streifen beiseite, das Spiel wartet auf Spielen) und die Profilkarte mit der Freundeszeile. Die zwei Bemerkungen der Layout-Prüfung (Spielerkacheln bei 6 Spielern auf 320×548) sind der bekannte Stand, Befund 8.
### Ergebnis vom 2026-10-26 (Zweig `feat/freunde`, Freunde, nach drei Review-Runden, Skript wie in diesem Stand)

Ganzer Abend bestanden, 114 von 114 Prüfungen in 22 Schritten (Laborwerte). Neu: Schritt 21 „Anna und Ben werden Freunde“ (20/20): Profil › Freunde beginnt leer mit „Freund hinzufügen“ und ohne Abgleich-Hinweis, das Blatt nennt Ben unter „Zuletzt gespielt mit“, ein Tipp sendet („Anfrage an Ben gesendet.“), Annas Liste zeigt Ben unter Gesendet; Bens Profil-Tab sagt „1 Anfrage“, ohne dass etwas geöffnet war, die Zahl „1 Anfrage“ steht auf dem Symbol seines Profil-Tabs, während er auf Spielen ist, seine Liste zeigt Anna unter Anfragen mit „Annehmen“ in der Zeile, danach „Freunde seit“ und die Zahl auf dem Tab ist weg; Annas Liste folgt von selbst, ebenso Profil › Freunde auf ihrem gekoppelten zweiten Gerät und auf dem aus der Sicherung wiederhergestellten (Englisch), ohne Hinweis auf fehlenden Abgleich; Bens Spielerseite sagt „Befreundet“; Rangliste › Freunde nennt Ben mit dem Satz, was sie zeigt; die Spielvorbereitung bietet Ben einmal, als Chip mit Profil, der Sitz ist verbunden. HIG-Matrix: 284 von 284 Prüfungen halten, darunter je Größe und Sprache Rangliste › Freunde (die vier Bereiche als Reihe von Pills, jedes Wort ganz), Profil › Freunde und das Blatt „Freund hinzufügen“. Zwei Bemerkungen der Layout-Prüfung (kleine Schrift im Spiel mit sechs Spielern auf 320 px) sind der bekannte Stand, nicht Teil dieses Zweigs.

### Ergebnis vom 2026-10-26 (Zweig `ux/profil-rangliste-stufe3`, Stufe 3 des Profil-Umbaus nach zwei Review-Runden, Skript wie in diesem Stand)

Ganzer Abend bestanden, 94 von 94 Prüfungen in 21 Schritten (119,1 s, Laborwerte). Neu: Schritt 17 „Anna importiert ihren Spielverlauf aus einer Tabelle“ (5/5: Vorschau „6 Spiele vom 12. Sept. 2026 bis 17. Okt. 2026: 3 gegen andere, 3 Trainings. 2 Namen.“, Annas Name vorgewählt, „6 Spiele importiert. Spiele als „Anna“ zählen zu dir.“ mit „Training anzeigen“ und „Import rückgängig machen“, Jonas als importiert in der Rangliste). HIG-Matrix: 254 von 254 Prüfungen halten (497 s), darunter je Größe und Sprache das Zielblatt mit − und +, die Zeile „Ziel“, die Ziellinie im Verlauf des Trainings, das Bild-Blatt vor dem Teilen und die Importvorschau mit der Frage nach dem eigenen Namen. Layoutprüfung: 254 Screenshots, 2 mit Hinweisen (dieselben Spielerkacheln bei 6 Spielern auf 320×548 wie zuvor).

### Ergebnis vom 2026-10-26 (Zweig `ux/clubs-turniere-einladen` nach Stufe 1 bis 3 des UX-Umbaus, Skript wie in diesem Stand, Laborwerte auf einem ausgelasteten Entwicklungsrechner)

Lauf mit `MATRIX=1`, Relays auf 127.0.0.1:20350 und :20351, Server auf Port 3345.

| # | Step | Result | Checks | Notes | Time (lab) |
| --- | --- | --- | --- | --- | --- |
| 1–16 | wie bisher (Gast, Profil, Geräte, Sicherung, Club, Clubspiel, Turnier, Auszeichnung, Einsatz); Schritt 13 zeigt jetzt auch Bens Telefon mit „Gerade an den Boards“ | pass | 73/73 | 0 | 96.8 s |
| 17 | Ben (Mitglied) lädt Carl per Code ein, Anna nimmt ihn auf | pass | 5/5 | 0 | 7.5 s |
| 18 | Anna lädt Carla direkt an ihr Profil ein | pass | 6/6 | 0 | 11.0 s |
| 19 | Ganzer Abend: nur lokale Verbindungen, keine Seitenfehler | pass | 15/15 | 0 | 0.2 s |
| | Whole evening | pass | 84/84 | 0 | 115.5 s |

HIG-Matrix: 154 von 154 Prüfungen halten. Layoutprüfung: 158 Screenshots, 2 mit Hinweisen (dieselbe Stelle wie bisher, Befund 8). Die Stufen 2 und 3 des Umbaus (Kurzcode, Einladung an ein Profil, gemeinsamer Linkcode der Leitung, Beitrittsregeln, „Zuletzt gespielt mit“, Live-Leiste im Turnier, schwebende Tableiste) laufen in diesem Abend mit; die beiden neuen Schritte prüfen sie von Ende zu Ende gegen die lokalen Relays.

### Ergebnis vom 2026-10-16 (Build von `66305c9` auf `wave3/p8fix`)

Lauf mit `MATRIX=1`, Relays auf 127.0.0.1:20376 und :20377, Server auf Port 3347.

| # | Step | Result | Checks | Notes | Time (lab) |
| --- | --- | --- | --- | --- | --- |
| 1 | Gast spielt 301 ohne Profil und ohne Netz | pass | 4/4 | 0 | 4.8 s |
| 2 | Ergebnisse vom Ergebnisbildschirm in ein neues Profil | pass | 5/5 | 0 | 4.2 s |
| 3 | Zweites eigenes Gerät koppeln (Code getippt) | pass | 4/4 | 0 | 7.1 s |
| 4 | Profil in eine Sicherungsdatei sichern | pass | 4/4 | 0 | 2.6 s |
| 5 | Sicherung auf einem dritten Gerät öffnen (Englisch, dunkel) | pass | 2/2 | 0 | 3.3 s |
| 6 | Club gründen und Ben per Link einladen | pass | 3/3 | 0 | 4.2 s |
| 7 | Ben tritt per Link als Gast bei und hat danach ein Profil | pass | 3/3 | 0 | 2.5 s |
| 8 | Clubspiel aus dem Club, live mit Zuschauerin | pass | 5/5 | 0 | 8.2 s |
| 9 | Ben bestätigt das Clubergebnis auf seinem Telefon | pass | 1/1 | 0 | 5.3 s |
| 10 | Turnier anlegen: 4 Plätze, ein Gast, Board 1 | pass | 2/2 | 0 | 4.7 s |
| 11 | Ben und Carla melden sich an | pass | 2/2 | 0 | 2.9 s |
| 12 | Check-in und Auslosung | pass | 1/1 | 0 | 3.6 s |
| 13 | Board-Gerät: Aufruf, Spiel, Meldung, Freigabe (2 Halbfinals) | pass | 3/3 | 0 | 12.4 s |
| 14 | Finale, Turnier beenden mit Auszeichnungen | pass | 4/4 | 0 | 8.7 s |
| 15 | Auszeichnung erscheint auf Bens Profilkarte | pass | 2/2 | 0 | 4.1 s |
| 16 | Einsatz 500 sats: Anna zahlt Ben mit der Wallet, genau einmal | pass | 8/8 | 0 | 16.3 s |
| 17 | Ganzer Abend: nur lokale Verbindungen, keine Seitenfehler | pass | 13/13 | 0 | 0.1 s |
| | Whole evening | pass | 66/66 | 0 | 95.0 s |

Weitere Laborwerte: Spielen-Tab bis zum X01-Knopf 188 ms; letzter Dart bis zum Bildschirm der Zuschauerin 414 ms; die Wallet wurde trotz Doppeltipp genau einmal um Zahlung gebeten. HIG-Matrix: 154 von 154 Prüfungen halten. Layoutprüfung: 151 Screenshots, 2 mit Hinweisen (dieselbe Stelle in DE und EN: Spielerkacheln 145×29 bei 6 Spielern auf 320×548, siehe Befund 8). Die Auslosung ist zufällig: In diesem Lauf schied Ben im Halbfinale aus, sein Profil zählt danach 2 Spiele (Clubspiel und Halbfinale).

Schritt 15 prüft seit dem Nachbessern den Weg über die beendete Turnierseite (ein Tipp auf „Im Profil zeigen“) statt über Profil › Auszeichnungen; Schritt 9 und 15 prüfen die eigenen Spiele als `expect.note`, beide halten.

### Befunde des Laufs vom 16. Oktober (Build von 4c4ce92) und ihr Stand

1. Einsatz-Zeile: Bitcoin- und NWC-Zeichen überdecken den Text. Behoben (`01cfdf0`): Der Symbolplatz der `ResultRow` setzt nur die Höhe, das zweiteilige Signet behält seine Breite; Leiste und kurze Bildschirme zeigen weiter kein Symbol. Matrix: Abstand Signet–Text bei jeder Größe ≥ 0.
2. Bestätigte Clubspiele und Turnierspiele fehlen in den eigenen Spielen. Behoben (`c05a3e8`): Ein Helfer (`lib/live/copy.ts`, aus dem Live-Weg gelöst) legt die persönliche Kopie unter der Match-ID ab, für „Stimmt“ im Club und für ein freigegebenes Board-Spiel (aus dem Live-Spiel des Boards); Korrektur und Rücknahme nehmen sie wieder heraus, zweimal Bestätigen oder ein zweites Gerät ergeben kein zweites Spiel. Bens Profil zählt die Spiele (Schritte 9 und 15).
3. Auszeichnung erst nach vier Tipps auf der Profilkarte, Versprechen bleibt stehen. Behoben (`6334c2a`): Die beendete Turnierseite sagt, wo die Auszeichnung liegt, und zeigt sie mit einem Tipp im Profil; das Versprechen verschwindet, sobald sie vergeben ist.
4. „Dein Platz: Platz 2“. Behoben (`b7cab13`): „Dein Platz: 2“, „Dein Platz: 3–4“, „Your place: 2nd“.
5. Spielen-Tab bei 568×320: Modus-Namen brechen mitten im Wort. Behoben (`8be9722`): kleineres Symbol über dem Namen.
6. Rangliste: zwei „Ben“ ohne Hinweis. Behoben (`5d2426b`): Die Zeile mit Profil trägt „Kennung …“, wie Club- und Turnierlisten (`sameNames`, jetzt in `lib/storage/players.ts`).
7. Statistiktabelle bei 320×548 endet mitten in einer Zeile. Behoben (`53c233e`): Verlauf am unteren Rand, solange weitere Zeilen folgen.
8. Spielerkacheln 145×29 bei 6 Spielern auf 320×548, Ziehgriff im Setup 36×44. Ziehgriff behoben (`66305c9`, 44×44 bei gleicher Optik). Die Kacheln bleiben offen: drei Zeilen teilen sich etwa 100 pt, mehr als rund 36 pt Trefferhöhe je Kachel geht nur mit Überlappung oder anderem Layout (siehe P8.01).

Neu gesehen, nicht behoben: Auf dem Ergebnis bei 568×320 bricht in Englisch „Leaderboard“ in der unteren Aktionsleiste vor dem letzten Buchstaben um (`components/game/match-result.tsx` `SmallAction`, FitText mit `minScale` 0,75 reicht dort nicht).

### Tipps vom Spielen-Tab (aus dem Lauf gezählt; Tippen von Text nicht mitgezählt)

| Ziel | Tipps |
| --- | --- |
| Gastspiel starten | 2 (X01 → Spiel starten) |
| Profil aus dem Ergebnis | 2–3 (Deine Ergebnisse mitnehmen → [Sitz] → Profil anlegen) |
| Zweites Gerät koppeln (altes Gerät) | 5 (Profil → Geräte → Eigenes Gerät hinzufügen → Öffnen → Zugriff geben) |
| Sicherungsdatei | 5–6 (Profil → Sicherung/Jetzt sichern → Sicherungsdatei erstellen → Kennwort kopieren → Datei speichern → Fertig) |
| Club gründen und Link teilen | 4 (Clubs → Hinzufügen → Club gründen → Link kopieren; das Einladeblatt öffnet sich mit dem Code von selbst). Vor dem Umbau der Clubs- und Turnieransichten (Zweig `ux/clubs-turniere-einladen`) waren es 6. |
| Clubspiel starten | 6 (Clubs → Club → Spiel starten → Gegner → Weiter zur Einrichtung → Spiel starten) |
| Zuschauen lassen | 3 im Spiel (Spieloptionen → Zuschauen lassen → Link kopieren) |
| Clubergebnis bestätigen | 3 (Clubs → Aufgabenzeile → Stimmt) |
| Per gesagtem Code beitreten | 4 (Clubs → Code scannen → Öffnen → Beitritt anfragen; den Code und den Namen tippen) |
| Freund neben dir direkt einladen | 4 nach dem Club (Einladen → An eine Person senden → Profilcode scannen → Einladen); mit „Zuletzt gespielt mit“ entfällt das Scannen |
| Turnier anlegen | 6 + Auswahl (Turniere → Hinzufügen → Weiter ×3 → veröffentlichen); das Teilen-Blatt öffnet sich mit dem Code von selbst, der Link ist einen Tipp entfernt |
| Auszeichnung auf die Profilkarte | 1 auf der beendeten Turnierseite (Im Profil zeigen); vorher 4 (Profil → Auszeichnungen → Auszeichnung → Im Profil zeigen) |
| Einsatz vereinbaren | 3 im Setup (Einsatz → 500 → Übernehmen) |
| Einsatz zahlen, erstes Mal | 4 (Zeile → Verbindung einfügen/Öffnen → Code einfügen/Öffnen → 500 sats zahlen) + Fertig |
| Geld empfangen | 5 (Profil → Zahlungen → Geld empfangen → Betrag → Zahlungscode erstellen) |

## Dateien

- `scripts/darts-night.mjs` – der Abend
- `scripts/hig-matrix.mjs` – der HIG-Durchgang (mit `MATRIX=1`)
- `scripts/lib.mjs` – gemeinsame Helfer: Relays, Geräte mit Netzsperre, Bildschirmprüfung, Schritt-Tabelle
- `screens/` – 43 repräsentative Screenshots (JPEG, Qualität 70) aus dem letzten Lauf, darunter 38 bis 44 für den Code eines Mitglieds, den getippten Code, „Eingeladen von“, die Einladung an ein Profil und ihr Ankommen
