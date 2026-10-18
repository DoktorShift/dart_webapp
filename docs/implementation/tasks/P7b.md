# P7b.01–P7b.03 Direkte Zahlungen

**Status:** Umgesetzt, Nachweis offen: echte Wallets und sats, Wallet-App-Rücksprung, Zap- und LNURL-Dienste mit CORS (E12), Signet mit Screenreader (A28)
**Paket:** P7b · **Planstelle:** [PLAN.md](../PLAN.md), Zeilen 451–489 (Direkte Zahlungen und vereinbarte Einsätze, Freiwillige Zaps) und 505–523 (Zahlungssignet), Zeilen 720–724

## Ziel

Spieler verbinden ihre eigene Bitcoin-Wallet (NWC), vermerken vor dem Spiel einen Einsatz („Verlierer zahlt“), bezahlen und empfangen nach dem Ergebnis direkt von Wallet zu Wallet und gratulieren anderen Spielern freiwillig, öffentlich (Zap nach NIP-57) oder privat. BlueLine verwahrt kein Geld, zahlt nie ohne Bestätigung und nie zweimal.

## Produktregeln und Abnahmekriterien

- **A17:** Abbrüche, doppelte Klicks und unbekannter Status lösen keine zweite Zahlung aus.
- **A26:** Bezahlen und Empfangen; fehlende Empfangsfunktion, fehlender Kontostand, ausgeschöpfte Freigabe, Wallet offline und getrennte Geräteberechtigungen werden richtig angezeigt.
- **A27:** Rechnungszahlungen und Zaps sachlich richtig; fehlender Beleg nach Zahlung, Neustart, mehrere Tabs und verspätete Antworten führen nicht zur Doppelzahlung.
- **A28:** Originale Bitcoin- und NWC-Zeichen klein und groß, hell und dunkel; Beschriftung ohne Kenntnis der Logos verständlich.
- [Entscheidung 0001](../../decisions/0001-kein-eigenes-backend.md) F4 (Euro-Näherung über nostr-core, entfällt still bei Fehler), [0002](../../decisions/0002-architektur.md) §2 und §8, Recherche NC-11 bis NC-14, OP-15 bis OP-25, `_coordination/NOSTR-DESIGN-RULES.md` (kein Fachjargon außerhalb von „Erweitert“, „Mehr erfahren“, ruhige Bestätigung, Gäste ohne Profilzwang).

## Voraussetzungen

Sitzung, Tresor und öffentliche Profile der Profilspur (`lib/profile/session.ts`, `vault.ts`, `metadata.ts`, `public-profile.ts`, Slot-Listen `profile.rows` und `profile.actions`). Die Profilspur rendert `profile.rows` auch in der Gast-Ansicht (vom Koordinator zugesagt, nicht in diesem Branch).

## Umsetzung

- `lib/nostr/wallet.ts`: NWC über die `NWC`-Klasse von nostr-core. Jede Verbindung beginnt mit `get_info`; danach ist die Verschlüsselung festgelegt und nostr-core wiederholt keine Anfrage im anderen Verfahren (NC-11/NC-12). Fehler als `WalletError`; `no-answer` heißt „kann ausgeführt worden sein“. `lud16` aus der Verbindung (OP-16).
- `lib/nostr/ext/lnurl.ts`: LNURL-pay und Zap-Anfragen; die gelieferte Rechnung wird gegen Betrag, Ablauf und Beschreibungshash geprüft (NC-14). `ext/validate.ts`: `checkInvoice` nennt den Grund.
- `lib/payments/journal.ts`: Zahlungsjournal (IndexedDB `payments`), ID = Payment-Hash, Eintrag vor dem Bezahlen, Web Locks je Aktion, unbekannter Ausgang nur per `lookup_invoice` klären, nie neue Rechnung solange offen, „Vor Ort erledigt“ getrennt.
- `lib/payments/wallet.ts`: Verbindung mit dem Tresor versiegelt unter kv `profile.wallet` (nicht in Export, Sicherung, Link oder Event; Abmelden löscht sie), offene Verbindungen schließen bei `onSessionEnd`.
- `lib/payments/{invoices,recipient,zap,stake,hooks}.ts`: Zahlungscodes, Empfangsadresse aus dem Profil, Zaps mit strenger Belegprüfung, Einsatz zwischen zwei Spielern.
- `lib/payments/wallet-return.ts`: „Wallet-App öffnen“ (NWC-07) vermerkt eine zufällige Anfrage (localStorage, 10 Minuten); nur eine Antwort `/#wallet-return=<Anfrage>?value=…` auf diese Anfrage zählt, und nur einmal. Behalten wird die Verbindung erst nach „Diese Wallet verbinden?“ mit Name, Rechten und dem Hinweis, wenn sie die verbundene ersetzt.
- Journal: Jeder Eintrag nennt die Wallet-Verbindung, die zahlte oder die Rechnung machte (`connection`, Schlüssel der Wallet und der App, nie das Geheimnis). Nur diese Verbindung kann eine Zahlung ausschließen; jede andere kann sie nur bestätigen. Wo die Wallet nicht gefragt werden kann, vermerkt die Person selbst („In deiner Wallet nachgesehen?“, `resolveByHand`; „nicht bezahlt“ erst nach Ablauf). Eine zweite Web-Lock-Sperre je Rechnung verhindert, dass zwei Aktionen dieselbe Rechnung gleichzeitig bezahlen.
- LNURL-Anfragen haben ein Zeitlimit von 10 s; bis die Wallet die Zahlung hat, heißt es „Zahlungscode wird angefragt“ bzw. „Zahlung wird vorbereitet“ und lässt sich abbrechen (`AbortSignal` in `pay`).
- `components/payments/`: Zahlungen (Profil), Wallet verbinden (Scan, Einfügen, Wallet-App), Erweitert, Einsatz in der Einrichtung (Zeile mit Texten aus dem Startkatalog, Sheet lädt beim Öffnen), Zahlungszeile im Ergebnis, Bezahlen/Empfangen/Gratulieren als Sheets, Signet aus den unveränderten Originalen. Ergebnis- und Profilzeile stehen hinter `gate.tsx`: Sie laden erst, wenn auf dem Gerät eine Wallet verbunden ist, eine Zahlung im Journal steht oder ein Einsatz vereinbart wurde.
- Texte: `lib/i18n/features/payments.screens.de/en.ts` (mit `useAreaT(PAYMENTS_TEXTS)`); im Startkatalog nur Bildschirmtitel, die Profilzeile, die Einsatzzeile und „sats“.
- Gemeinsame Teile, klein gehalten: `LinkKind` „wallet-return“ (`lib/shell/links.ts`, `registry.ts`), `ShareActions` mit `copyLabel`, `SecretPurpose` „wallet-connection“.

## Fehlerfälle (mit Tests)

Bezahlen, Rechnung erstellen und nachsehen, Timeout nach erfolgter Zahlung (genau eine Zahlung, danach „Status prüfen“), Wallet-Fehler (Guthaben, Budget, Ablehnung), Wallet nur NIP-04, ohne `make_invoice`, Wallet offline, Relay weg, falscher Betrag, abgelaufener Code, Code ohne Betrag, Wallet-Verbindung statt Zahlungscode gescannt, Doppelklick, zweiter Tab, Neustart mitten im Bezahlen, Zap-Belege echt und gefälscht (anderer Signierer, anderer Zap, geändert, anderer Empfänger, anderer Betrag), wiederholte Belege.

## Review-Runde 1

Behoben: unverlangte Wallet-Rückkehr (hoch), „nichts bezahlt“ nach Wallet-Wechsel (hoch), abgeschnittene Ergebniszeile, Sackgasse bei unbekanntem Ausgang ohne `lookup_invoice`, LNURL ohne Zeitlimit, überlappende Abfragen beim Empfangen, Sperre je Rechnung, zweites Fenster bei wiederholbaren Zahlungen, Gastpfad, Großbuchstaben-Rechnungen, doppelte Logik. Browserablauf: [scripts/payments-review.mjs](../evidence/P7b/scripts/payments-review.mjs) (heute mit den Szenarien beider Runden) mit [Bildern](../evidence/P7b/review1/).

## Review-Runde 2

Behoben: Die Antwort der Wallet-App kehrt dorthin zurück, wo sie angefragt wurde (hoch: Ergebnis und Einsatz-Sheet bleiben offen, auch nach einem frischen Laden; der Verbinden-Bildschirm zeigt „Verbunden“ statt des alten Panels), abgeschnittene Ergebniszeile (hoch: die Zeile bleibt in ihrer Rasterspalte, kurze Worte im Querformat, 44 pt bis 740 pt Höhe), „Zahlungen“ immer im Profil, Hinweise über den Knöpfen und damit auf dem iPhone SE im Blick, Sheets im Querformat ohne Scrollen, Abbrechen bis zur Übergabe an die Wallet, kein „Status prüfen“ über eine andere Verbindung, Zahlungscode für den vereinbarten Betrag sofort, „Abbrechen“ bis ein Code da ist, gefülltes „Fertig“ bei „Erhalten“, Nachsehen-Gruppe nur wo die Wallet nichts sagen kann, Fokusring des Sheets, Prüfung ohne Namen beginnt mit dem Betrag, Hinweis „Vor Ort erledigt“ als Frage, Sheet-Titel der Zahlung, „NIP‑47“ auf einer Zeile, Texte ohne verbundene Wallet. Browserablauf: [scripts/payments-review.mjs](../evidence/P7b/scripts/payments-review.mjs) mit [Bildern](../evidence/P7b/review2/). Gemessene Grenzen außerhalb dieses Pakets: Auf einem Telefon im Querformat (568×320) liegt die Symbolzeile des Ergebnisses (Teilen, Statistik, Aufnahmen, Rangliste) schon ohne Zahlungszeile 7 px unter dem Bildschirmrand; mit der 44-pt-Zeile entsprechend tiefer. Auf dem iPhone SE (320×548) zeigt die Statistiktabelle mit der Zeile zwei volle Zeilen und eine angeschnittene dritte; eine ganze dritte Zeile bräuchte etwa 30 px mehr aus dem Ergebnisbildschirm der App-Hülle.

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch | `wave2/payments` |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | siehe Bericht des Branches: `lint`, `typecheck`, `npm test`, `npm run test:relay`, `build`, Browserablauf [scripts/payments-ui.mjs](../evidence/P7b/scripts/payments-ui.mjs) mit [Bildern](../evidence/P7b/screens/) (320×548 bis 1440×900, hell und dunkel, Deutsch und Englisch) |
| Nicht ausgeführte Prüfungen | Echte Wallets und echte Beträge (Nutzerfreigabe nötig, OP-19), echter Zap-Empfangsdienst mit CORS (OP-22), Wallet-App-Rücksprung (NWC-07) auf Geräten, Safari/Firefox, VoiceOver |
| Verbleibende Einschränkungen | Gebühren vor dem Bezahlen sind unbekannt („Je nach Wallet“), da NIP-47 keine Gebührenabfrage kennt. Ein Budget wird nur über Albys `get_budget` angezeigt. Empfang wird nur bei geöffneter App erkannt (F8). Öffnet eine Wallet-App die Antwort in einem anderen Browser als dem, in dem BlueLine läuft (etwa installierte PWA auf iOS), fehlt dort die Anfrage: Die Antwort wird abgelehnt, die Verbindung muss eingefügt werden (auf Geräten nicht geprüft). |

## Stand im Integrationszweig (16. Oktober 2026)

| Punkt | Wert |
| --- | --- |
| Zusammengeführt | Spur `wave2/payments`, Endstand `7247f00`, zusammengeführt in `4117c31` (16. Oktober 2026); Zahlungszeile auf `ResultRow` (`057803a`) |
| Review | Review 1 (2 hoch, 4 mittel, 5 niedrig) → Korrektur `ed5fcf9`; Review 2: beide hohen Befunde halten, 3 mittel, 5 niedrig; HIG 1 (2 hoch, 1 mittel, 9 niedrig) → Korrektur `7247f00`; Koordinator-Review |
| nostr-core-Version | 1.0.6 (NWC über `lib/nostr`) |
| Prüfungen der Spur | 16. Oktober 2026 auf `7247f00`: `npm test` 488/488, Relay 31/31, `build` bestanden, Browser [payments-review.mjs](../evidence/P7b/scripts/payments-review.mjs) 48/49 (Fehler im Messhelfer) plus Wiederholung 11/11, 78 Bilder ohne abgeschnittenen Text; jede Einsatzzahlung zahlt genau einmal |
| Prüfungen auf `nostr-plan` `4c4ce92` | 16. Oktober 2026, Prüfung beim Zusammenführen: `lint` und `typecheck` ohne Meldung, `npm test` 662 von 662, `npm run test:relay` 80 von 80 gegen lokale nak-Relays, `build` bestanden (`/` 71,1 kB, First Load 278 kB). Kein Browserlauf auf genau diesem Stand (P8.01). |
| Offen für die Abnahme | Echte Wallets und Beträge; Wallet-App-Rücksprung auf Geräten; Zap- und LNURL-Dienste; Safari, VoiceOver; STATUS PY-01 |

## Nächster Schritt

E12; danach kontrollierte Praxistests mit Kleinstbeträgen und die Upstream-PRs für nostr-core.
