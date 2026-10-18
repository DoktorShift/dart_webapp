# P0.01 Ausgangsstand

Erfasst am 4. Oktober 2026 im Arbeitsbranch `nostr-expansion`. Dieser Bericht hält fest, wie BlueLine Darts 1.0.0 vor der Erweiterung funktioniert, damit spätere Änderungen dagegen geprüft werden können.

## Codestand und Arbeitsbaum

| Punkt | Wert |
| --- | --- |
| Basiscommit | `e6ff77edc575eae2cf6a9dd61112edb2400fb05d` auf `main`, identisch mit `origin/main` (nach `git fetch` am 4. Oktober 2026) |
| App-Version | `blueline-darts` 1.0.0 (`package.json`) |
| Arbeitsbranch | `nostr-expansion`, abgezweigt von `main` |
| Arbeitsbaum | Eigener Git-Worktree `/Users/drshift/dart_webapp-nostr`. Der Haupt-Checkout `/Users/drshift/dart_webapp` bleibt unverändert auf `main`. |
| Übernommene Arbeitsdateien | `docs/implementation/PLAN.md`, `docs/implementation/HANDOFF.md`, `docs/ux/blueline-comfort-prototype.html`. Sie wurden aus dem Haupt-Checkout kopiert; die SHA-256-Summen stimmen überein (`3ad4025b…` PLAN, `3fb43d62…` HANDOFF, `4e50dd77…` Prototyp). Im Haupt-Checkout liegen sie weiterhin unversioniert. |

## Laufzeit und Pakete

| Punkt | Wert |
| --- | --- |
| Betriebssystem | macOS (Darwin 24.6.0, arm64) |
| Node lokal | v25.2.1 |
| Node auf Netlify | `NODE_VERSION = "22"` in `netlify.toml`; nachgeprüft mit Node v22.23.3 (`npx -p node@22`) |
| Node-Anforderung | `"engines": { "node": ">=22.18" }`; die Tests führen TypeScript direkt mit `node --test` aus |
| Paketmanager | npm 11.6.2, `package-lock.json` mit `lockfileVersion` 3 |
| Installation | `npm ci --no-audit --no-fund` im frischen Worktree: 398 Pakete in rund 10 s, Exit 0. Einziger Hinweis: `eslint@9.39.5` gilt als nicht mehr unterstützt. |
| Wichtige Versionen | next 15.5.27, react und react-dom 19.3.0, typescript 5.9.3, tailwindcss 3.4.19, framer-motion 13.5.0, vaul 1.1.2, eslint 9.39.5 |
| Laufzeitabhängigkeiten | Keine Nostr-, Lightning- oder Netzwerkbibliothek. Kein eigener Server; Netlify liefert die statisch erzeugte Next.js-App aus. |

`npm ls` meldet `@emnapi/runtime` und `@img/sharp-wasm32` als „extraneous“. Sie stehen absichtlich im Lockfile (Commit `af159cd`, „optional @emnapi packages npm ci needs“) und stören weder Installation noch Build.

## Vorhandene Prüfungen

Alle Befehle stammen aus `package.json` und liefen im Worktree am 4. Oktober 2026 zwischen 00:39 und 00:45 UTC.

| Befehl | Node 25.2.1 | Node 22.23.3 | Bemerkung |
| --- | --- | --- | --- |
| `npm run lint` (`eslint .`) | bestanden, keine Meldungen | nicht separat ausgeführt | |
| `npm run typecheck` (`tsc --noEmit`) | bestanden | nicht separat ausgeführt | |
| `npm run test` (`node --test tests/*.test.ts`) | 40 von 40 bestanden | 40 von 40 bestanden | Node 22 warnt `MODULE_TYPELESS_PACKAGE_JSON`, weil `package.json` kein `"type"` setzt; ohne Auswirkung |
| `npm run build` (`next build`) | bestanden, 42 s | bestanden, 83 s | 53 statische Seiten |

Bundlegröße laut Build: Startseite `/` 46,6 kB, First Load JS 246 kB; gemeinsam geladenes JS 103 kB. Diese Werte sind die Vergleichsbasis für die Vorgabe, dass Netzwerk- und Wallet-Code den Gaststart nicht ausbremsen darf (A01).

## Gastablauf praktisch geprüft

Prüfaufbau: Produktionsbuild aus dem Worktree mit `next start -p 3100`, eigener Chromium-Browser über Playwright, Viewport 390 × 844, Touch, Sprache `de-DE`, Service Worker blockiert (für reproduzierbare Läufe). Skript: [`scripts/guest-flow.mjs`](scripts/guest-flow.mjs). Das ist eine Browserprüfung mit emulierter Größe, kein Test auf einem echten Telefon.

| Schritt | Beobachtung | Bild |
| --- | --- | --- |
| App öffnen | Startseite mit Übungsscheibe und „Neues Spiel“ (X01, Cricket, Around the Clock). Tab-Leiste „Spielen“, „Rangliste“, „Einstellungen“. Kein Login, keine Einrichtung. | [Start](screens/flow-01-home.jpg) |
| Spiel einrichten | X01 öffnet die Einrichtung: Spieler in Wurfreihenfolge, Startpunkte, Double In/Out, Legs. 301, Anna und Ben. | [Einrichtung](screens/flow-02-setup-x01.jpg) |
| Spiel starten | Spielbildschirm mit Spielstand, Aufnahmefeld und Tastenfeld auf einem Bildschirm. | [Spielbeginn](screens/flow-03-game-start.jpg) |
| Eingeben | Anna T20, T20, 20: Rest 161, „Ø 140“. | |
| Korrigieren | Ben 20, versehentlich 5, „Rückgängig“, dann 19 und 20: Rest 242, „Ø 59“. Der falsche Dart verschwindet vollständig aus dem gespeicherten Wurflog. | [Korrektur](screens/flow-04-game-correcting.jpg) |
| Fortsetzen | Neuladen der Seite öffnet direkt wieder den Spielbildschirm mit identischem Stand. | [Nach Neuladen](screens/flow-05-after-reload.jpg) |
| Abschließen | Anna T20, T17, Bull: Ergebnisfenster „Anna gewinnt“, 3-Dart-Average 150,5, Checkout 161, Checkout-Quote 100 %, Aktionen „Revanche“, „Neues Spiel“, „Teilen“, „Statistik“, „Aufnahmen“, „Rangliste“. | [Ergebnis](screens/flow-06-result.jpg) |
| Leg-Wechsel | Bei „First to 2“ erscheint nach Leg 1 das Leg-Fenster mit „Nächstes Leg, Ben beginnt“. | [Leg gewonnen](screens/flow-legwon.jpg) |

Keine JavaScript-Fehler in der Konsole während des Ablaufs.

## Datenhaltung heute

Alle Daten liegen in `localStorage` des Browsers. IndexedDB, sessionStorage und Server werden nicht benutzt. Gemessen im obigen Ablauf ([Protokoll](flow-log.txt), Beispieldaten [während des Spiels](storage-mid-game.json) und [nach dem Spiel](storage-finished.json)):

| Schlüssel | Inhalt | Wann geschrieben |
| --- | --- | --- |
| `dart-scorer.settings.v1` | Ton, Ansage, Eingabemodus, Double-Nachfrage | Beim ersten Öffnen |
| `dart-scorer.rules.v1` | Zuletzt gewählte Regeln je Spielart | Beim Spielstart |
| `dart-scorer.last-game.v1` | Letzte Spielkonfiguration samt Spielern mit IDs | Beim Spielstart |
| `dart-scorer.last-players.v1` | Letzte Spielernamen als Liste | Beim Spielstart |
| `dart-scorer.current-match.v1` | Laufendes Spiel: Match-ID, Konfiguration mit Spieler-IDs (`pmut3oeo50`), vollständiges Wurflog | Nach jedem Dart (390 → 602 → 743 → 815 → 1028 Zeichen im Ablauf) |
| `dart-scorer.matches.v1` | Historie für die Rangliste: Match-ID, Zeitpunkt, Spielart und je Spieler nur Name, Sieg, Darts, Punkte | Beim Spielende |

Für P1 wichtig: Das laufende Spiel kennt bereits Spieler-IDs, die Historie aber nur Namen. Die Rangliste fasst Spieler über den kleingeschriebenen Namen zusammen (`lib/leaderboard.ts:42`). Wurfdetails gehen beim Übertrag in die Historie verloren. Eine genaue Analyse aller Schlüssel, Schreibzeitpunkte und Fehlerfälle steht im [Risikobericht](RISKS-P0.02-P0.07.md).

## Darstellung auf Referenzgrößen

Skript: [`scripts/matrix.mjs`](scripts/matrix.mjs). Startseite und X01-Spielbildschirm mit 2 und 6 Spielern, darunter lange Namen wie „Maximilian-Alexander“.

| Größe | Startseite scrollt | Spiel scrollt | Horizontaler Überlauf | Innere Scrollbereiche | Mit „…“ gekürzt |
| --- | --- | --- | --- | --- | --- |
| iPhone SE Safari 320 × 548 | nein | nein | nein | keine | 0 |
| iPhone SE quer 568 × 320 | nein | nein | nein | keine | 0 |
| iPhone 13 390 × 844 | nein | nein | nein | keine | 0 |
| iPhone 13 quer 844 × 390 | nein | nein | nein | keine | 0 |
| iPad hoch 768 × 1024 | nein | nein | nein | keine | 0 |
| iPad quer 1024 × 768 | nein | nein | nein | keine | 0 |
| Desktop 1440 × 900 | nein | nein | nein | keine | 0 |

Bilder: [SE 6 Spieler](screens/matrix-game-6p-se-safari.jpg), [SE quer](screens/matrix-game-6p-se-landscape.jpg), [iPhone 13](screens/matrix-game-2p-iphone-13.jpg), [iPhone 13 quer](screens/matrix-game-6p-iphone-13-landscape.jpg), [iPad hoch](screens/matrix-game-6p-ipad-portrait.jpg), [iPad quer](screens/matrix-game-6p-ipad-landscape.jpg), [Desktop](screens/matrix-game-6p-desktop.jpg), [Start SE](screens/matrix-home-se-safari.jpg), [Start iPad quer](screens/matrix-home-ipad-landscape.jpg).

Die Bilder wurden angesehen, nicht nur erzeugt. Die Werte gelten für Chromium mit emulierter Größe; Safari-Toolbars, echte Geräte und vergrößerte Schrift sind damit nicht geprüft.

## Befunde im Bestand

| ID | Befund | Auswirkung | Umgang |
| --- | --- | --- | --- |
| BL-01 | Nach dem matchentscheidenden Dart zeigt die Spielstandskachel des Siegers einen zu hohen Live-Average (im Ablauf „Ø 231“ statt 150,5). Ursache: `components/game/scoreboards.tsx:173` rechnet die laufende Aufnahme noch einmal hinzu, obwohl sie nach Spielende bereits in `st.points` steckt (`(301 + 161) / 6 × 3 = 231`). Zwischen zwei Legs stimmt der Wert. Skript: [`scripts/avg-check.mjs`](scripts/avg-check.mjs). | Gering: Das Ergebnisfenster verdeckt die Kachel auf allen geprüften Größen und zeigt 150,5 korrekt. Der Wert steht trotzdem im DOM. | Nicht in diesem Branch behoben, weil 1.0.0 unverändert bleiben soll. Vorschlag: eigener kleiner Fix auf `main` (Bedingung `state.winner === null`), Entscheidung beim Nutzer. |
| BL-02 | Spielernamen sind bei der Eingabe auf 16 Zeichen begrenzt (`components/setup-screen.tsx:84`). Es wird nichts abgeschnitten; längere Eingaben sind nicht möglich. | Keine im heutigen Gastspiel. Für P2: Nostr-Anzeigenamen können länger sein und dürfen laut HIG-Vorgabe nicht mit „…“ gekürzt werden. | Als Gestaltungsvorgabe in P0.02 und P2.01 aufnehmen. |
| BL-03 | Node 22 warnt `MODULE_TYPELESS_PACKAGE_JSON` beim Testlauf. | Keine; nur Logausgabe. | Offen lassen. `"type": "module"` würde andere Dateien betreffen und gehört nicht in diese Lieferung. |
| BL-04 | Auf GitHub liegt der Dependabot-Branch `next-15.5.15`, das Lockfile enthält bereits next 15.5.27. | Keine. | Kann geschlossen werden; Nutzerentscheidung. |

## Nicht geprüft

- Cricket und Around the Clock wurden nur über die gemeinsame Startseite berührt, nicht vollständig durchgespielt. Die 40 Tests decken Regeln, Checkouts und Korrekturen ab.
- Englische Oberfläche, Safari, Firefox, echte Telefone und Tablets, installierte PWA und Service-Worker-Updates.
- Ältere Datenstände aus früheren App-Versionen in `localStorage`.
- Leistungsmessungen wie Eingabelatenz, LCP, INP und CLS. Messverfahren und Ziele legt P0.07 fest.
