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

Die Schritte: ein 301 als Gast (ohne Profil und ohne Verbindung) → „Deine Ergebnisse mitnehmen“ → zweites Gerät koppeln → Sicherungsdatei → Wiederherstellung auf einem dritten Gerät → Club gründen und per Link einladen → Beitritt als Gast → Clubspiel aus dem Club, live mit Zuschauerin → Ben bestätigt auf seinem Telefon → Turnier mit 4 Plätzen (Anna, Ben, Carla, Gast Mia), K.-o., Board-Gerät: Check-in, Auslosung, Aufruf, Meldung vom Board, Freigabe, Finale, Ende mit Auszeichnungen → Auszeichnung von der Turnierseite auf Bens Profilkarte → Einsatz 500 sats: Bens Telefon zeigt den Zahlungscode, Anna zahlt mit Doppeltipp, die Wallet zahlt genau einmal → Ben (Mitglied) zeigt seinen Einladelink mit Code, Carl tippt den Code unter „Code scannen“, fragt an, Anna sieht „Eingeladen von Ben“ und nimmt ihn auf → Anna schickt Carla eine Einladung direkt an ihr Profil (Profilcode, Name bestätigen, senden), die bei Carla unter Clubs erscheint; Carla fragt an, Anna bestätigt, Carlas Telefon sagt „Du bist dabei“ ohne Neuladen. Geprüft wird jeweils, was die Spieler sehen; pro Schritt entsteht ein Screenshot in Gerätegröße.

`expect` prüft den Ablauf (ein Fehler hält den Abend an). `expect.note` hält Befunde an der App fest, ohne den Abend anzuhalten (NOTE).

Mit `MATRIX=1` folgt der HIG-Durchgang (`hig-matrix.mjs`): Spielen, Rangliste, Clubs, Club, Turniere, Turnier, Profil und der Ergebnisbildschirm mit Einsatz, in DE hell und EN dunkel, bei 320×548, 390×844, 568×320, 768×1024 und 1024×768, aus Annas Zustand nach dem Abend. Dazu kommen der Spielbildschirm mit 1 bis 6 Spielern als ein fester Bildschirm und die leeren und Offline-Zustände eines Gastgeräts. Jeder Screenshot bekommt die Layoutprüfung aus `lib.mjs` (Auslassungspunkte, abgeschnitten, waagerechtes Scrollen, Ziele unter 44 pt) und eine Suche nach Protokollwörtern.

## Ausführen

```sh
NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:20350,ws://127.0.0.1:20351 npm run build
npx next start -p 3345 &
node docs/implementation/evidence/P8/scripts/darts-night.mjs            # nur der Abend, etwa 2 min
MATRIX=1 node docs/implementation/evidence/P8/scripts/darts-night.mjs   # mit HIG-Matrix, etwa 7 min
```

Optional: `BASE`, `OUT` (Screenshots, Standard `$TMPDIR/blueline-p8`), `RELAY_PORTS`. Das Skript startet seine Relays selbst und bricht ab, wenn ein Port schon belegt ist (alte Daten). Am Ende beendet es Browser, Wallets und Relays. Exit-Code 0 heißt: jeder Schritt bestanden.

## Letztes Ergebnis (2026-10-26, Arbeitsstand des Zweigs `ux/clubs-turniere-einladen` nach Stufe 1 bis 3 des UX-Umbaus, Skript wie in diesem Stand, Laborwerte auf einem ausgelasteten Entwicklungsrechner)

Lauf mit `MATRIX=1`, Relays auf 127.0.0.1:20350 und :20351, Server auf Port 3345.

| # | Step | Result | Checks | Notes | Time (lab) |
| --- | --- | --- | --- | --- | --- |
| 1–16 | wie bisher (Gast, Profil, Geräte, Sicherung, Club, Clubspiel, Turnier, Auszeichnung, Einsatz) | pass | 72/72 | 0 | 91.6 s |
| 17 | Ben (Mitglied) lädt Carl per Code ein, Anna nimmt ihn auf | pass | 5/5 | 0 | 7.5 s |
| 18 | Anna lädt Carla direkt an ihr Profil ein | pass | 6/6 | 0 | 11.0 s |
| 19 | Ganzer Abend: nur lokale Verbindungen, keine Seitenfehler | pass | 15/15 | 0 | 0.2 s |
| | Whole evening | pass | 83/83 | 0 | 110.3 s |

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
- `screens/` – 34 repräsentative Screenshots (JPEG, Qualität 70) aus dem letzten Lauf, darunter 38 bis 44 für den Code eines Mitglieds, den getippten Code, „Eingeladen von“, die Einladung an ein Profil und ihr Ankommen
