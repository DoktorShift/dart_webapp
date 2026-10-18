# P0.07 Gestaltungsgrundlage

Stand: 4. Oktober 2026, Branch `wave1/shell`. Dieses Dokument hält fest, wie BlueLine Darts heute aussieht und sich bedient, nach welchen Regeln neue Ansichten gebaut werden, auf welchen Größen geprüft wird und welche Leistungsziele wie gemessen werden. Es ist verbindlich für alle UI-Arbeit der Erweiterung; Abweichungen werden hier begründet nachgetragen.

Grundlage: der Code von Version 1.0.0 (`e6ff77e`), Apple Human Interface Guidelines (iOS/iPadOS), [PLAN.md](../../PLAN.md) Zeilen 491–560 (Oberfläche, Gestaltungsprinzipien, UX-Modell), 766–772 (Berührungsflächen, Leistungsziele) und Abnahmekriterium A18, [Entscheidung 0002](../../../decisions/0002-architektur.md) §9.

## 1 Das vorhandene visuelle System

Gezählt im Code von 1.0.0 (`components/`, `app/`), damit neue Ansichten dieselben Werte verwenden.

### Schrift

| Rolle | Klasse | Größe | Einsatz heute | Entspricht (HIG) |
| --- | --- | --- | --- | --- |
| Großer Titel | `font-display text-4xl font-semibold tracking-tight` | 36 px | Rangliste, Einstellungen; neu: Wurzel jedes Tabs und gepushte Bildschirme mit großem Titel | Large Title |
| Marke / Held | `font-display text-5xl` bzw. `text-2xl` | 48 / 24 px | „Über“-Kopf, Kopf des Spielen-Tabs | – |
| Titel | `text-xl` / `text-lg font-semibold` | 20 / 18 px | Sheet-Titel, Leerzustände, Kartenköpfe | Title 3 / Headline |
| Fließtext | `text-[1.0625rem]` | 17 px | Zeilen, Buttons, Absätze (62 Stellen) | Body |
| Nebentext | `text-[0.9375rem]` | 15 px | Erklärungen, Untertitel, Sheet-Beschreibungen (44) | Subheadline |
| Fußnote | `text-[0.8125rem]` | 13 px | Gruppentitel, Hinweise unter Zeilen (31) | Footnote |
| Klein | `text-[0.75rem]`, `text-[0.6875rem]` | 12 / 11 px | Tabellenköpfe, Spielstandsdetails | Caption 1/2 |
| Tab-Beschriftung | `text-[0.625rem]` | 10 px | Tab-Leiste hochkant | Tab bar 10 pt |

Schriften: Inter (Text), Barlow Condensed 500/600 als `font-display` für Titel und alle Zahlen am Board; Zahlen immer `tabular-nums`. Namen werden nie mit „…“ gekürzt: `FitText` verkleinert bis 60–80 % und bricht danach um; freie Texte brechen mit `[overflow-wrap:anywhere]`.

### Abstände und Maße

| Element | Wert |
| --- | --- |
| Seitenrand | `px-4` (16 px), mit `max(env(safe-area-inset-*), 1rem)` links/rechts |
| Lesebreite | `max-w-2xl` (672 px) zentriert; „Über“ `max-w-xl` |
| Gruppenabstand | `mt-8`, erste Gruppe `mt-6`; Gruppentitel `mb-2 px-4` |
| Zeilen | `min-h-12` (48 px) einzeilig, `min-h-14` (56 px) mit Hinweis; Innenabstand `px-4 py-2`…`py-3` |
| Bedienelemente | mindestens 44 × 44 pt: `h-11`/`min-h-11` (44), Hauptaktion in Karten `h-12` (48), Hauptaktion am unteren Rand `h-14` (56) |
| Tab-Leiste | 49 px (`h-[3.0625rem]`), Telefon quer 40 px, plus untere Safe Area |
| Navigationsleiste | 44 px (`h-11`) plus obere Safe Area |

### Radien

`rounded-2xl` (16 px) für Karten und Listengruppen (41 Stellen), `rounded-xl` (12 px) für Buttons und Eingaben (27), `rounded-full` für Avatare, Schalter und Chips, `rounded-3xl` (24 px) für hervorgehobene Karten (Installieren, QR-Code). `--radius` ist 0,75 rem.

### Farben und Rollen

Alle Farben sind HSL-Tokens in `app/globals.css`, Dunkel ist Standard, `.light` folgt iOS (gruppiertes Grau, weiße Karten).

| Rolle | Token | Einsatz |
| --- | --- | --- |
| Hintergrund, Text | `background`, `foreground` | Seite; im Dunkeln zusätzlich ein blauer Schein (Board-Licht) |
| Karte | `card` | Listengruppen, Karten |
| Akzent | `primary` | Hauptaktion, Links, gewählter Tab, Zurück-Taste |
| Zweitfläche | `secondary`, `muted` | Segmented Control, ruhige Buttons, Platzhalter |
| Nebentext | `muted-foreground` | im Hellen dunkler als iOS secondaryLabel, damit kleine Schrift AA erreicht |
| Linien | `border` | Trennlinien, Rahmen |
| Ergebnis | `success`, `warning`, `danger` | Checkout, laufende Korrektur, Bust und zerstörende Aktionen |
| Tasten | `key`, `key-quiet`, `key-pressed` | Tastenfeld im Spiel |

Regel: Status nie nur über Farbe. Immer Text, dazu ein Symbol (`InlineStatus`, Häkchen bei „Kopiert“, Kamera-Symbol im Scanner-Zustand), der gewählte Tab zusätzlich fett und mit kräftigerem Symbol.

### Bausteine

Vorhanden: `Group`, `SwitchRow`, `ChoiceRow`, `LinkRow`, `DisclosureRow`, `Segmented`, `Sheet` (vaul), `AlertDialog` (Radix), `Button`, `FitText`, `UndoBanner`, `FallbackScreen`.

Neu in P0.02 (alle in Hell/Dunkel und DE/EN geprüft):

| Baustein | Datei | Zweck |
| --- | --- | --- |
| `ListRow`, `RowIcon` | `components/ui/list-row.tsx` | Zeile mit Pfeil (Navigation), Wert rechts, Symbol im farbigen Quadrat, zerstörend (rot, ohne Pfeil) |
| `EmptyState` | `components/ui/empty-state.tsx` | Symbol, Titel, ein Satz, eine Hauptaktion, höchstens eine ruhige Zweitaktion |
| `Avatar` | `components/ui/avatar.tsx`, Regeln in `lib/shell/avatar.ts` | erzeugtes Bild aus einem Seed (kleines Board, gleiche Farbe und Segmente für denselben Seed), optional https-Foto ohne Referrer mit Rückfall |
| `NavHeader`, `ScreenFrame` | `components/nav/` | Navigationsleiste mit Zurück-Taste, großer Titel, eigener Scrollbereich |
| `StackView` | `components/nav/stack-view.tsx` | Stapel eines Tabs mit Animation, Fokus- und Scrollerhalt |
| `QRCodeView` | `components/common/qr-code-view.tsx` | großer QR-Code (dunkel auf weiß, Ruhezone), Bildunterschrift, Teilen und Kopieren |
| `QRScanner` | `components/common/qr-scanner.tsx` | Kamera mit BarcodeDetector oder jsQR, klare Zustände, immer Eingabefeld |
| `ShareActions`, `shareLink` | `components/common/share-actions.tsx`, `lib/shell/share.ts` | Teilen-Sheet des Systems oder Kopieren, Bestätigung an Ort und Stelle |
| `InlineStatus` | `components/common/inline-status.tsx` | Bestätigung oder Problem im Ablauf statt Toast |

### Dialoge, Sheets und Tabellen

- **Sheet** (`components/ui/sheet.tsx`) für Nebenaufgaben, die man abbrechen kann: Auswahl („Ich habe schon ein Profil“), Hilfe, Spieloptionen. Titel, ein Satz Beschreibung, Inhalt, unten „Abbrechen“ oder „Fertig“.
- **AlertDialog** nur für Bestätigungen vor zerstörenden oder folgenreichen Aktionen; die zerstörende Taste rot und mit Verb („Zurücksetzen“), Abbrechen daneben.
- **Push** für alles, was eigene Inhalte hat und zu dem man zurückkehrt (Einstellungen, Club, Turnier).
- **Tabellen** wie die Rangliste: Kopfzeile in Fußnotengröße, Zahlen rechtsbündig und tabellarisch, Namen umbrechend. Jede Tabelle oder Grafik braucht eine lesbare Listenform (Turnierbaum → Begegnungsliste, PLAN Zeilen 414 und 766).
- **Originalassets** (Bitcoin- und NWC-Signet) gehören zu P7b; die Regeln aus PLAN Zeilen 517–523 gelten dann unverändert.

### Bewegung

Push/Pop: Tween 0,32 s, Kurve `[0.32, 0.72, 0, 1]`; der neue Bildschirm kommt von rechts (100 %), der alte rückt um 25 % nach links und dimmt auf 60 %. Mit „Bewegung reduzieren“ nur Überblendung in 0,15 s. Tabwechsel ohne Animation (wie iOS). Sheets: vaul-Standard.

## 2 Navigationsmodell

```
┌──────────────────────── Tab-Leiste (Telefon, iPad hoch) / Seitenleiste (ab 1024 px) ───────────────────────┐
│ Spielen          Rangliste        Clubs              Turniere            Profil                            │
│  Wurzel           Wurzel           Wurzel             Wurzel              Wurzel                           │
│  (eigener Kopf)   (eigener Titel)  Leerzustand        Leerzustand         Gast / angemeldet (Slot)         │
│   └ gepusht…       └ gepusht…       └ Club gründen     └ Turnier erst.     ├ Einstellungen                  │
│                                     └ Einladung öffnen └ Einladung öffnen  ├ Über die App                   │
│                                        └ Einladung        └ Turnier        └ Profil anlegen …              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
      ▲ Einrichtung und Spiel liegen als Vollbild-Abläufe über allem; Tab-Leiste und Seitenleiste sind dort weg.
```

- **Tabs** behalten ihren Stapel und ihre Scrollposition; erneutes Tippen auf den offenen Tab führt zur Wurzel, an der Wurzel nach oben.
- **Titel**: Wurzeln haben einen großen Titel an derselben Stelle wie die Rangliste. Gepushte Bildschirme haben eine Navigationsleiste mit Zurück-Taste (Titel des vorherigen Bildschirms, sonst „Zurück“, sonst nur der Pfeil) und je nach Inhalt einen großen Titel. Scrollt der große Titel weg, erscheint er klein in der Leiste.
- **Browser-Zurück** wirkt wie die Zurück-Taste. Das Spiel hat keinen eigenen History-Eintrag und verhält sich wie in 1.0.0.
- **App-Links** (`/#club=…` und die anderen in Entscheidung 0002 §9) öffnen den passenden Tab und Bildschirm, beim Start und bei `hashchange`, und verschwinden sofort aus der Adresse. Ein laufendes Spiel wird dabei pausiert und wartet auf „Weiterspielen“.
- **Erweiterungspunkte**: `lib/shell/registry.ts` (Bildschirme, Aktionen, Link-Handler, Slots), eingehängt in `components/shell/extensions.ts`. Die Bereiche laden ihren Code mit `lazyScreen()` erst bei Bedarf.

## 3 Referenzgeräte und Größenmatrix

| Name | CSS-Größe | Steht für | Prüfstand |
| --- | --- | --- | --- |
| SE Safari | 320 × 548 | kleinste unterstützte Fläche (iPhone SE 1. Gen. bzw. Safari mit Leisten auf kleinen Geräten) | Browseremulation |
| SE quer | 568 × 320 | Telefon quer, kleinste Höhe | Browseremulation |
| iPhone | 390 × 844 | iPhone 12–15 | Browseremulation |
| iPhone quer | 844 × 390 | Telefon quer | Browseremulation |
| iPad hoch | 768 × 1024 | iPad (9. Gen.), iPad mini hoch: Tab-Leiste | Browseremulation |
| iPad quer | 1024 × 768 | iPad quer: Seitenleiste | Browseremulation |
| Desktop | 1440 × 900 | Laptop/Desktop | Browseremulation |

Alle Ansichten werden auf diesen Größen in Deutsch und Englisch, hell und dunkel aufgenommen und angesehen; das Skript prüft zusätzlich automatisch auf horizontales Scrollen, Kürzung mit „…“, Text, der aus seiner Taste läuft, und Berührungsflächen unter 44 × 44 pt ([P0.02/scripts/shell-screens.mjs](../P0.02/scripts/shell-screens.mjs)).

Echte Geräte für P8 (Vorschlag, Bestätigung durch den Nutzer, weil die Geräte vorhanden sein müssen): iPhone SE (2./3. Gen.) mit iOS 17/18 in Safari und als Home-Bildschirm-App, ein aktuelles iPhone, Pixel 7 oder vergleichbar mit Chrome (Android 14+), ein Samsung-Mittelklassegerät mit Samsung Internet, iPad (10. Gen.), Mac mit Safari und Chrome, Windows mit Edge. Referenzgerät für die Eingabelatenz: das langsamste davon (vermutlich das Samsung-Mittelklassegerät).

## 4 Leistungsziele

| Ziel | Wert | Quelle |
| --- | --- | --- |
| Gaststart, Größte sichtbare Darstellung (LCP) | ≤ 2,5 s (75. Perzentil, mobil und Desktop getrennt) | PLAN Zeile 770, Web Vitals |
| Reaktion auf Eingaben (INP) | ≤ 200 ms | PLAN Zeile 770 |
| Layoutverschiebung (CLS) | ≤ 0,1 | PLAN Zeile 770 |
| Punkteingabe bis sichtbare Rückmeldung | ≤ 100 ms im 95. Perzentil auf dem Referenzgerät, ohne Netzwerk im Weg | PLAN Zeile 772 |
| Punkteingabe bis lokale Speicherung des laufenden Spiels | ≤ 100 ms im 95. Perzentil (gleiches Gerät); Grundlage für „Dein Spiel ist gespeichert.“ | PLAN Zeile 772 (getrennte Messung von Darstellung und Speicherbestätigung) |
| JavaScript des Gaststarts (`/`, erster Aufruf) | kein nostr-core, kein QR-Leser, kein QR-Erzeuger darin (PLAN A01, A25). Zuwachs gegenüber dem Ausgangsstand (`nostr-expansion` `fd4e6c5`: 242,9 kB gzip): Vorschlag höchstens 5 kB gzip | Die 5-kB-Grenze ist ein Vorschlag des Umsetzers, nicht des Plans; die Aufgabe verlangt „unverändert“. Nutzerentscheidung offen (für STATUS.md beim Koordinator) |

Laborwerte ersetzen keine Felddaten; ohne echte Nutzungsdaten wird kein „erfüllt im Feld“ behauptet.

## 5 Messverfahren

Alle Messungen laufen gegen einen Produktionsbuild (`npm run build`, `npx next start -p <port>`). Der Ausgangsstand wird aus `git archive <commit>` in einem eigenen Ordner mit denselben `node_modules` gebaut.

1. **Bundle** — `node docs/implementation/evidence/P0.07/scripts/route-bundle.mjs <label>` (im Ordner des Builds) liest `.next/app-build-manifest.json`, summiert die Skripte von Layout und Startseite (roh und gzip -9) und sucht in jedem Skript nach Zeichenketten, die nur in nostr-core, jsQR oder qrcode-generator vorkommen. Bei jeder Änderung am Gastweg auszuführen.
2. **Labor-Leistung** — `node docs/implementation/evidence/P0.07/scripts/perf.mjs <url> <label>`, Bedingungen siehe Tabelle.
3. **Bedingungen bleiben fest.** Werden sie geändert, wird der Ausgangsstand mit den neuen Bedingungen neu gemessen und beides berichtet (PLAN Zeile 772).
4. **Grenzen**: Emulation auf einem Mac ist kein Telefon. Die Werte vergleichen Stände miteinander; die Abnahme auf dem Referenzgerät folgt in P8. Lastmittel des Messrechners wird mitberichtet; bei hoher Last sind Absolutwerte eher zu hoch.

### Festgelegte Messbedingungen

| Punkt | Festlegung |
| --- | --- |
| Browser | Chromium aus Playwright 1.63 (headless); Safari und Firefox erst auf echten Geräten (P8) |
| Gerät (Emulation) | 390 × 844 CSS-Pixel, DPR 3, Touch, `de-DE`, Service Worker blockiert, Cache aus |
| CPU | 4× verlangsamt (CDP `Emulation.setCPUThrottlingRate`) |
| Netz (Kaltstart) | 150 ms RTT, 1,6 Mbit/s down, 750 kbit/s up (wie Lighthouse „mobile“); Eingabe und Navigation ohne Netzdrosselung |
| Wiederholungen | Kaltstart 5 Läufe (Median, schlechtester Lauf); Scoreeingabe 60 Taps (1, 5, 20 im Wechsel, 250 ms Abstand); Navigation 5 Runden aus 5 Tabwechseln, Push und Zurück (40 Interaktionen) |
| Datenmengen | Kaltstart: leerer Speicher (Erstbesuch). Eingabe und Navigation: 1.000 gespeicherte Spiele in der Historie, laufendes Spiel X01 501 mit 2 Spielern. Größere Mengen (6 Spieler, 128 Turnierteilnehmer) messen die jeweiligen Bereiche mit demselben Skriptaufbau (P6.04). |
| Messgrößen | FCP, LCP, CLS (PerformanceObserver), übertragenes JS (CDP); Eingabe: Event Timing (Eingabe bis nächste Darstellung, Interaktionen unter 16 ms zählen als 16 ms); lokale Speicherung: Zeit vom `pointerdown` bis zum Schreiben von `dart-scorer.current-match.v1`; ein späterer Abgleich (Sync) existiert noch nicht und wird ab P3 als eigener Wert ergänzt |

## 6 Messergebnisse

Gemessen am 4. Oktober 2026 auf einem Mac (arm64, macOS 15, Darwin 24.6) mit Node 25.2.1 und Chromium aus Playwright 1.63. Ausgangsstand: `nostr-expansion` `fd4e6c5`, aus `git archive` mit denselben `node_modules` gebaut. Neu: `wave1/shell` mit dem App-Rahmen aus P0.02. Der Rechner war durch parallele Arbeiten ausgelastet (Lastmittel 7 bis 20); deshalb liefen beide Stände abwechselnd je zweimal.

### Erstaufruf-JavaScript von `/` (`route-bundle.mjs`)

| | Ausgangsstand | App-Rahmen | Differenz |
| --- | --- | --- | --- |
| Skripte von Layout und Startseite, gzip -9 | 242,9 kB (791,5 kB roh, 11 Dateien) | 246,9 kB (805,4 kB roh, 11 Dateien) | **+4,0 kB gzip (+1,6 %)** |
| davon Seitenchunk `app/page` | 33,5 kB | 37,9 kB | +4,4 kB (Tabs, Stapel, Verlauf, Links, Registry, Clubs-/Turnier-Leerzustand) |
| davon Chunk mit den Texten (DE und EN) | 13,0 kB | 14,7 kB | +1,7 kB (neue Texte `shell` und `profile`) |
| davon Chunk mit den bisherigen Einstellungen | 12,0 kB | 10,5 kB | −1,5 kB (Einstellungen laden jetzt bei Bedarf) |
| Next.js-Anzeige „First Load JS“ für `/` | 247 kB | 251 kB | +4 kB |
| CSS (gzip -9) | 10,8 kB | 11,7 kB | +0,9 kB |
| HTML von `/` (roh) | 101,8 kB | 105,0 kB | +3,2 kB |
| nostr-core / jsQR / qrcode-generator im Erstaufruf | nein / nein / nein | nein / nein / nein | – |

Erst bei Bedarf geladen: jsQR (126,9 kB roh, nur im Scanner), qrcode-generator (19,9 kB roh: QR-Ansicht und die Installationsanleitung in Einstellungen und „Über“), Profil, Einstellungen, Über und der Scanner (je 6 bis 10 kB roh). Profil, Einstellungen, Über und der QR-Erzeuger werden vier Sekunden nach dem Ankommen auf den Tabs im Leerlauf vorgeladen, damit sie offline bereitstehen; nie während eines Spiels.

Bewertung: Das Budget (höchstens +5 kB gzip, keine dieser Bibliotheken im Erstaufruf) ist eingehalten, der Erstaufruf aber nicht byte-gleich. Die Hälfte des Zuwachses sind die neuen Texte in beiden Sprachen; sie liegen, wie alle Bereichstexte, im gemeinsamen Textkatalog (`lib/i18n/de.ts`, `en.ts`). Wer das weiter senken will, lädt die nicht aktive Sprache bei Bedarf; das betrifft alle Bereiche und ist nicht Teil dieser Lieferung.

### Labormessung (`perf.mjs`)

Je zwei Läufe, abwechselnd; Werte als „Lauf 1 / Lauf 2“.

| Messgröße | Ausgangsstand | App-Rahmen | Ziel |
| --- | --- | --- | --- |
| FCP = LCP, Median aus 5 Kaltstarts | 696 / 724 ms | 764 / 780 ms | LCP ≤ 2,5 s |
| LCP, schlechtester Kaltstart | 732 / 816 ms | 1064 / 804 ms | |
| CLS, größter Wert | 0,000 / 0,000 | 0,000 / 0,000 | ≤ 0,1 |
| Übertragenes JS beim Kaltstart | 255,6 kB | 259,6 kB | |
| Scoreeingabe bis Darstellung, p50 / p95 | 64 / 88 ms; 72 / 96 ms | 64 / 80 ms; 72 / 104 ms | p95 ≤ 100 ms (Referenzgerät) |
| Scoreeingabe, langsamster Tap | 360 / 888 ms | 656 / 576 ms | |
| Tap bis lokale Speicherung, p50 / p95 | 21 / 38 ms; 25 / 43 ms | 17 / 34 ms; 26 / 48 ms | p95 ≤ 100 ms |
| Navigation (Tabwechsel, Push, Zurück), p50 / p95 / max | – (keine Tabs dieser Art) | 56 / 104 / 112 ms; 72 / 104 / 160 ms | INP ≤ 200 ms |

Bewertung:

- **Kaltstart:** Der App-Rahmen zeichnet in dieser stark gedrosselten Messung rund 60 ms später (etwa 8 %), passend zu den zusätzlich übertragenen rund 6 kB (JS, CSS, HTML) bei 1,6 Mbit/s und der Streuung unter Last. Beide Stände liegen weit unter 2,5 s.
- **Scoreeingabe und Speicherung:** Der Spielbildschirm ist unverändert; die Werte beider Stände liegen innerhalb der Streuung. In der Emulation liegt das 95. Perzentil um die 100-ms-Grenze (80 bis 104 ms); maßgeblich ist das Referenzgerät (P8).
- **Bestandsbefund:** Der erste Tap nach Spielbeginn dauert in beiden Ständen deutlich länger (360 bis 888 ms bis zur Darstellung). Das liegt vor dem App-Rahmen und gehört in den Spielbildschirm (nicht Teil dieser Lieferung, siehe Offene Punkte).
- **Navigation:** Tabwechsel, Push und Zurück bleiben unter der INP-Grenze von 200 ms.
- Eine erste Messung mit sofortigem Vorladen im Leerlauf ergab 294 kB übertragenes JS beim Kaltstart; seitdem wartet das Vorladen vier Sekunden (siehe oben).

### Nach Review-Runde 1 (5. Oktober 2026)

Gemessen auf `wave1/shell` vor dem Zusammenführen mit `nostr-expansion` („nachher“) gegen den geprüften Stand `c61a108` („vorher“, aus `git archive`, gleiche `node_modules`). **Laborwerte unter paralleler Last:** andere Arbeiten liefen gleichzeitig auf dem Rechner, Lastmittel 4 bis 11 (meist um 7). Die Streuung zwischen Läufen desselben Stands ist größer als die meisten Unterschiede; die Werte sind einmalige Läufe, nicht wiederholt, bis sie passen. Rohdaten in [results/](results/) (`*-review1-*`).

**Bundle** (`route-bundle.mjs`, [bundle-review1-after.txt](results/bundle-review1-after.txt)): 247,5 kB gzip (807,2 kB roh, 11 Dateien), also **+4,6 kB gzip (+1,9 %)** gegenüber dem Ausgangsstand `fd4e6c5` und +0,6 kB gegenüber `c61a108`. Seitenchunk `app/page` 38,6 kB (vorher 38,0), Textchunk 14,7 kB. Der Inhalt von Clubs, Turniere und Profil (Leerzustände, Slots, Gastprofil) lädt jetzt bei Bedarf (ein Chunk, 12,3 kB roh / 4,4 kB gzip, mit dem Gastprofil, das schon vorher nachgeladen wurde) und wird im Leerlauf vorgeladen. Das spart etwa 0,9 kB gzip im Start; hinzugekommen sind die verdeckt erhaltenen Tabs (`TabsLayer`), die Slot-Listen (`SlotItems`) und Spielmenü-Einträge in Einrichtung, Ergebnis und Optionsmenü sowie die Rückkehr in den aufrufenden Tab. nostr-core, jsQR und qrcode-generator sind weiterhin nicht im Erstaufruf. Die 5-kB-Grenze ist eine Annahme dieses Dokuments; die Aufgabe verlangt „unverändert“. Entscheidung beim Nutzer; der Eintrag in STATUS.md folgt bei der Integration durch den Koordinator.

**Labor** (`perf.mjs`; neu `OPEN_TABS=1`: Rangliste mit 1.000 Spielen, Clubs, Turniere und Profil › Einstellungen sind vor dem Spiel geöffnet und bleiben mit dem App-Rahmen verdeckt erhalten; `win-latency.mjs`: der Siegdart mit denselben offenen Tabs, 7 bis 9 Läufe je Stand).

| Messgröße | vorher (`c61a108`) | nachher | Ziel |
| --- | --- | --- | --- |
| LCP-Median aus 5 Kaltstarts | 720 / 720 / 712 / 728 ms | 720 / 708 / 720 / 764 / 776 ms | ≤ 2,5 s |
| Scoreeingabe p50 / p95, nur Spielen geöffnet | 64 / 64 ms; 64 / 64 ms | 64 / 64 ms; 96 / 96 ms (Lauf unter Last 11); 64 / 72 ms | p95 ≤ 100 ms |
| Scoreeingabe p50 / p95, alle Tabs vorher geöffnet | 64 / 72 ms; 64 / 72 ms | 64 / 80 ms; 64 / 96 ms | p95 ≤ 100 ms |
| Tap bis lokale Speicherung p95 | 23 bis 27 ms | 22 bis 39 ms | ≤ 100 ms |
| Navigation p95 | 64 bis 120 ms | 56 bis 96 ms | INP ≤ 200 ms |
| Siegdart bis zur nächsten Darstellung, Median | 96 / 112 / 128 ms | 152 ms (ohne Einfrieren), 128 / 152 ms (eingefroren) | INP ≤ 200 ms |

Bewertung:

- **Erste Messung, ohne Einfrieren:** Mit den verdeckt erhaltenen Tabs rechnete die Rangliste (1.000 Spiele), das Gastprofil und die Einstellungen beim Siegdart synchron im selben Task neu, bevor das Ergebnis erschien (Median 152 gegen 96 ms). Deshalb werden die Tabs, sobald Einrichtung oder Spiel ganz eingeschoben sind, über eine Suspense-Grenze eingefroren (`components/nav/tabs-layer.tsx`, wie `<Activity mode="hidden">`, das die React-Version in Next.js 15 noch nicht exportiert): Zustand und DOM bleiben, Änderungen darin rendert React erst im Leerlauf oder beim Zeigen. Eine Probe mit MutationObserver auf der verdeckten Rangliste zeigt danach in 5 von 5 Läufen keine Änderung innerhalb von 2,5 s nach dem Siegdart; beim Zurückkehren zeigt sie das neue Ergebnis (review1-checks.mjs).
- **Verbleibend:** In diesem Stand ruft das Spielende noch je geöffnetem Bildschirm mit Spielhistorie (Rangliste, Gastprofil, Einstellungen) `readMatches()` synchron auf, also `JSON.parse` der ganzen Historie aus `localStorage`; das liegt in `lib/leaderboard.ts` und wird durch die lokale Datengrundlage aus `nostr-expansion` (asynchrones Archiv) ersetzt. Nach dem Zusammenführen wurde nicht erneut gemessen (Absprache mit dem Koordinator wegen der Rechnerlast).
- **Scoreeingabe:** p50 in allen Läufen 64 ms. p95 schwankt zwischen 64 und 96 ms in beiden Ständen unter wechselnder Last; ein Unterschied über die Streuung hinaus ist nicht nachweisbar. Ein Wurf rendert keinen Tab (memoisierte Wurzeln, `StackView` und `TabsLayer` memoisiert, Tabs eingefroren).

## 7 Offene Punkte

- Echte Geräte, installierte PWA, VoiceOver und TalkBack auf Geräten: nicht geprüft (P8).
- Vergrößerte Schrift (Dynamic Type in Safari, Browser-Zoom 200 %): nicht systematisch geprüft.
- Referenzgerät für die Eingabelatenz: Nutzerentscheidung (Vorschlag oben).
- Originalassets Bitcoin/NWC: P7b.
- Bestandsbefund Spielbildschirm: erster Tap nach Spielbeginn langsam (siehe §6); auf 568 × 320 (iPhone SE quer) läuft „Rückgängig“ im deutschen Tastenfeld an den Rand seiner Taste (im Ausgangsstand identisch, `shell-screens.mjs` meldet es). Beides gehört in eine eigene Änderung am Spielbildschirm, die diese Lieferung nicht vornimmt.
- Nutzerentscheidung: Zuwachs des Gaststarts um 4,6 kB gzip annehmen oder die nicht aktive Sprache bei Bedarf laden (betrifft alle Bereiche).
- Grundlinien der Tab-Beschriftungen: Eine auf Breite verkleinerte Beschriftung („Leaderboard“, „Tournaments“ auf 320 px) sitzt bis zu 1 px höher als die anderen (Rundung der Zeilenhöhe).
