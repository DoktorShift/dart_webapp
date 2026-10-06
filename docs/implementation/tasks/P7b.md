# P7b.01–P7b.03 Direkte Zahlungen

**Status:** In Prüfung
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
- `components/payments/`: Zahlungen (Profil), Wallet verbinden (Scan, Einfügen, Wallet-App über NWC-07 mit Rückkehr `/#wallet-return`), Erweitert, Einsatz in der Einrichtung, Zahlungszeile im Ergebnis, Bezahlen/Empfangen/Gratulieren als Sheets, Signet aus den unveränderten Originalen.
- Gemeinsame Teile, klein gehalten: `LinkKind` „wallet-return“ (`lib/shell/links.ts`, `registry.ts`), `ShareActions` mit `copyLabel`, `SecretPurpose` „wallet-connection“.

## Fehlerfälle (mit Tests)

Bezahlen, Rechnung erstellen und nachsehen, Timeout nach erfolgter Zahlung (genau eine Zahlung, danach „Status prüfen“), Wallet-Fehler (Guthaben, Budget, Ablehnung), Wallet nur NIP-04, ohne `make_invoice`, Wallet offline, Relay weg, falscher Betrag, abgelaufener Code, Code ohne Betrag, Wallet-Verbindung statt Zahlungscode gescannt, Doppelklick, zweiter Tab, Neustart mitten im Bezahlen, Zap-Belege echt und gefälscht (anderer Signierer, anderer Zap, geändert, anderer Empfänger, anderer Betrag), wiederholte Belege.

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch | `wave2/payments` |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | siehe Bericht des Branches: `lint`, `typecheck`, `npm test`, `npm run test:relay`, `build`, Browserablauf [scripts/payments-ui.mjs](../evidence/P7b/scripts/payments-ui.mjs) mit [Bildern](../evidence/P7b/screens/) (320×548 bis 1440×900, hell und dunkel, Deutsch und Englisch) |
| Nicht ausgeführte Prüfungen | Echte Wallets und echte Beträge (Nutzerfreigabe nötig, OP-19), echter Zap-Empfangsdienst mit CORS (OP-22), Wallet-App-Rücksprung (NWC-07) auf Geräten, Safari/Firefox, VoiceOver |
| Verbleibende Einschränkungen | Gebühren vor dem Bezahlen sind unbekannt („Je nach Wallet“), da NIP-47 keine Gebührenabfrage kennt. Ein Budget wird nur über Albys `get_budget` angezeigt. Empfang wird nur bei geöffneter App erkannt (F8). |

## Nächster Schritt

Nach der Zusammenführung mit der Profilspur: Kontrollierte Praxistests mit freigegebenen Kleinstbeträgen (OP-19) und Upstream-PRs für nostr-core (Verschlüsselungs-Tag, keine Wiederholung bei `pay_invoice`, Rechnungsprüfung bei LNURL, strenge Zap-Belegprüfung).
