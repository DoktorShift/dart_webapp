# P8.01 Gesamter Spielabend – Nachweis

Ein zusammenhängender Playwright-Lauf (Chromium) spielt einen ganzen Abend mit mehreren Browser-Kontexten als Geräte, gegen einen Produktions-Build. Alles bleibt lokal: zwei frische `nak serve`-Relays auf 127.0.0.1, NIP-47-Wallet-Simulatoren (`tests/support/fake-wallet.ts`). Jede andere Anfrage wird abgewiesen und gezählt; nur der Wechselkurs bekommt einen festen Wert, wie in den P7b-Skripten.

## Was der Lauf abdeckt

| Gerät | Größe | Rolle |
| --- | --- | --- |
| anna-phone | 390×844, DE, hell | Gast → Profil, Club-Eigentümerin, Turnierleitung und Mitspielerin, zahlt den Einsatz |
| anna-second | 320×548, DE, dunkel | zweites eigenes Gerät (Kopplung per getipptem Code) |
| anna-third-en | 390×844, EN, dunkel | drittes Gerät, Wiederherstellung aus der Sicherungsdatei |
| ben-phone | 390×844, DE, hell | Freund: tritt per Link als Gast bei und hat danach ein Profil, bestätigt das Clubergebnis, spielt das Turnier, empfängt den Einsatz |
| carla-phone | 320×548, DE, hell | Zuschauerin des Live-Spiels, danach Turnierteilnehmerin |
| board-tablet | 1024×768, DE, hell | Board 1 des Turniers |

Die Schritte: ein 301 als Gast (ohne Profil und ohne Verbindung) → „Deine Ergebnisse mitnehmen“ → zweites Gerät koppeln → Sicherungsdatei → Wiederherstellung auf einem dritten Gerät → Club gründen und per Link einladen → Beitritt als Gast → Clubspiel aus dem Club, live mit Zuschauerin → Ben bestätigt auf seinem Telefon → Turnier mit 4 Plätzen (Anna, Ben, Carla, Gast Mia), K.-o., Board-Gerät: Check-in, Auslosung, Aufruf, Meldung vom Board, Freigabe, Finale, Ende mit Auszeichnungen → Auszeichnung auf Bens Profilkarte → Einsatz 500 sats: Bens Telefon zeigt den Zahlungscode, Anna zahlt mit Doppeltipp, die Wallet zahlt genau einmal. Geprüft wird jeweils, was die Spieler sehen; pro Schritt entsteht ein Screenshot in Gerätegröße.

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

## Letztes Ergebnis (2026-10-16, Build von 4c4ce92, Laborwerte auf einem ausgelasteten Entwicklungsrechner)

| # | Step | Result | Checks | Notes | Time (lab) |
| --- | --- | --- | --- | --- | --- |
| 1 | Gast spielt 301 ohne Profil und ohne Netz | pass | 4/4 | 0 | 4.9 s |
| 2 | Ergebnisse vom Ergebnisbildschirm in ein neues Profil | pass | 5/5 | 0 | 4.2 s |
| 3 | Zweites eigenes Gerät koppeln (Code getippt) | pass | 4/4 | 0 | 7.1 s |
| 4 | Profil in eine Sicherungsdatei sichern | pass | 4/4 | 0 | 2.1 s |
| 5 | Sicherung auf einem dritten Gerät öffnen (Englisch, dunkel) | pass | 2/2 | 0 | 3.2 s |
| 6 | Club gründen und Ben per Link einladen | pass | 3/3 | 0 | 4.2 s |
| 7 | Ben tritt per Link als Gast bei und hat danach ein Profil | pass | 3/3 | 0 | 2.4 s |
| 8 | Clubspiel aus dem Club, live mit Zuschauerin | pass | 5/5 | 0 | 8.5 s |
| 9 | Ben bestätigt das Clubergebnis auf seinem Telefon | pass | 1/1 | 1 | 5.3 s |
| 10 | Turnier anlegen: 4 Plätze, ein Gast, Board 1 | pass | 2/2 | 0 | 4.7 s |
| 11 | Ben und Carla melden sich an | pass | 2/2 | 0 | 2.9 s |
| 12 | Check-in und Auslosung | pass | 1/1 | 0 | 3.5 s |
| 13 | Board-Gerät: Aufruf, Spiel, Meldung, Freigabe (2 Halbfinals) | pass | 3/3 | 0 | 12.3 s |
| 14 | Finale, Turnier beenden mit Auszeichnungen | pass | 4/4 | 1 | 8.7 s |
| 15 | Auszeichnung erscheint auf Bens Profilkarte | pass | 1/1 | 2 | 6.7 s |
| 16 | Einsatz 500 sats: Anna zahlt Ben mit der Wallet, genau einmal | pass | 8/8 | 1 | 17.1 s |
| 17 | Ganzer Abend: nur lokale Verbindungen, keine Seitenfehler | pass | 13/13 | 0 | 0.1 s |
| | Whole evening | pass | 65/65 | 5 | 97.8 s |

Weitere Laborwerte: Spielen-Tab bis zum X01-Knopf 173 ms; letzter Dart bis zum Bildschirm der Zuschauerin 414 ms. HIG-Matrix: 148 von 154 Prüfungen halten (die 6 übrigen sind ein Befund, siehe unten). Layoutprüfung: 151 Screenshots, 3 mit Hinweisen (Ziehgriff 36×44 im Setup; Spielerkacheln 145×29 bei 6 Spielern auf 320×548).

### Befunde an der App (NOTE, nicht behoben, nur gemeldet)

1. Die Bitcoin- und NWC-Zeichen der Einsatz-Zeile auf dem Ergebnis überdecken die erste Ziffer („500 sats …“), bei jeder Größe mit Symbol (`ResultRow` gibt dem zweiteiligen `PaymentSignet` `h-5 w-5`).
2. Ein bestätigtes Clubspiel und die Turnierspiele erscheinen nicht in den eigenen Spielen des Spielers: Nach drei Spielen sagt Bens Profil „Noch keine X01-Spiele“.
3. Eine vom Veranstalter vergebene Auszeichnung erscheint erst nach drei weiteren Tipps auf der Profilkarte (Profil › Auszeichnungen › Auszeichnung › Im Profil zeigen); die Turnierseite verspricht „erscheint in deinem Profil“ und zeigt diesen Satz auch dann noch, wenn sie schon vergeben ist.
4. „Dein Platz: Platz 2“ (doppeltes „Platz“).
5. Spielen-Tab bei 568×320: Die Modus-Kacheln brechen mitten im Wort um („Cric/ket“, „Aro/und the/Clo/ck“).
6. Rangliste: zwei Zeilen „Ben“ (Gast-Sitz und Bens Profil) ohne Unterscheidungshinweis.
7. Ergebnis bei 320×548 mit Einsatz-Zeile: Die Statistiktabelle endet mitten in einer Zeile, ohne Hinweis aufs Scrollen.

### Tipps vom Spielen-Tab (aus dem Lauf gezählt; Tippen von Text nicht mitgezählt)

| Ziel | Tipps |
| --- | --- |
| Gastspiel starten | 2 (X01 → Spiel starten) |
| Profil aus dem Ergebnis | 2–3 (Deine Ergebnisse mitnehmen → [Sitz] → Profil anlegen) |
| Zweites Gerät koppeln (altes Gerät) | 5 (Profil → Geräte → Eigenes Gerät hinzufügen → Öffnen → Zugriff geben) |
| Sicherungsdatei | 5–6 (Profil → Sicherung/Jetzt sichern → Sicherungsdatei erstellen → Kennwort kopieren → Datei speichern → Fertig) |
| Club gründen und Link teilen | 6 (Clubs → Club gründen → Club gründen → Mitglieder einladen → Einladung erstellen → Link kopieren) |
| Clubspiel starten | 6 (Clubs → Club → Spiel starten → Gegner → Weiter zur Einrichtung → Spiel starten) |
| Zuschauen lassen | 3 im Spiel (Spieloptionen → Zuschauen lassen → Link kopieren) |
| Clubergebnis bestätigen | 3 (Clubs → Aufgabenzeile → Stimmt) |
| Turnier anlegen | 6 + Auswahl (Turniere → Turnier erstellen → Weiter ×3 → veröffentlichen) |
| Auszeichnung auf die Profilkarte | 4 (Profil → Auszeichnungen → Auszeichnung → Im Profil zeigen) |
| Einsatz vereinbaren | 3 im Setup (Einsatz → 500 → Übernehmen) |
| Einsatz zahlen, erstes Mal | 4 (Zeile → Verbindung einfügen/Öffnen → Code einfügen/Öffnen → 500 sats zahlen) + Fertig |
| Geld empfangen | 5 (Profil → Zahlungen → Geld empfangen → Betrag → Zahlungscode erstellen) |

## Dateien

- `scripts/darts-night.mjs` – der Abend
- `scripts/hig-matrix.mjs` – der HIG-Durchgang (mit `MATRIX=1`)
- `scripts/lib.mjs` – gemeinsame Helfer: Relays, Geräte mit Netzsperre, Bildschirmprüfung, Schritt-Tabelle
- `screens/` – 26 repräsentative Screenshots (JPEG, Qualität 70) aus dem letzten Lauf
