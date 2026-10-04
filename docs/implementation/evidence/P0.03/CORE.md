# P0.03 Core-Abdeckung: nostr-core 1.0.4 in Browser und Next.js

Erfasst am 4. Oktober 2026 im Branch `wave1/nostr` (Basis `fd4e6c5`, Integrationsbranch `nostr-expansion`). Grundlage: [Entscheidung 0001](../../../decisions/0001-kein-eigenes-backend.md), [Entscheidung 0002](../../../decisions/0002-architektur.md) Abschnitte 2, 4 und 5, die Quellprüfung von nostr-core aus P0.01 (Befunde NC-01 bis NC-23, PR-xx, DR-xx, OP-xx im [Risikobericht](../P0.01/RISKS-P0.02-P0.07.md)) und die Tests dieses Branches.

## Ergebnis in Kürze

- **nostr-core 1.0.4 ist installierbar und läuft** in Node 25.2.1 und 22.23.3, in Next.js 15.5.27 (Produktionsbuild) sowie in Chromium 153 und WebKit 26.6: Schlüssel erzeugen, signieren, prüfen, NIP-44, Relay-Verbindung, Veröffentlichen und Wiederlesen über `nak serve`.
- **Der Gastweg bleibt unberührt.** `/` hat nach dem Einbau dieselben Werte wie 1.0.0 (46,6 kB, First Load JS 246 kB, gemeinsam 103 kB) und dieselben Chunk-Dateien. Beim Öffnen der Startseite wird kein nostr-core-Code geladen und keine WebSocket-Verbindung geöffnet.
- **Bundle:** Die Nostr-Schicht lädt bei Bedarf einen nostr-core-Chunk von **21,7 KB gzip** (62,5 KB minifiziert). Ein wörtliches `import("nostr-core")` hätte 116,3 KB gzip gekostet, ohne `optimizePackageImports` 54,7 KB.
- **Lücken:** Drei für den Plan zwingende Bausteine fehlen in nostr-core (NIP-49, NIP-55, der nostrconnect://-Ablauf von NIP-46); acht weitere sind unvollständig oder fehlerhaft. Alle sind generisch in `lib/nostr/ext/` ergänzt, getestet und als Upstream-Beitrag vorbereitet. Jede Lücke ist mit einem minimalen Beispiel gegen die Bibliothek selbst reproduziert ([`tests/nostr-core-gaps.test.ts`](../../../../tests/nostr-core-gaps.test.ts) und die unten genannten Tests).
- **Neuer Befund:** Das synchrone scrypt von `@noble/hashes` lief in einem Chromium-Worker rund zehnmal langsamer als die asynchrone Variante (3,1 s gegen 0,3 s bei log_n 16). Der NIP-49-Worker nutzt deshalb die asynchrone Variante.

## Paket

| Punkt | Wert |
| --- | --- |
| Version | `nostr-core` 1.0.4, fest eingetragen (ohne `^`), MIT |
| Integrität | `sha512-dd5v8PtZ3K1NijJjl6gbwukqa3a+ztaM9UvmVRRcABXQ74Gn8yaieOWD9h/O1JQ9+dWfrL5z68wj5YTzA2kffA==` (`package-lock.json`), gleich dem in P0.01 geprüften Paket |
| Quellstand | `gitHead` 0df7655, direkter Vorgänger von `main` 02ab4c8; beide unterscheiden sich nur in `src/rss.ts` und Blog-Dateien (P0.01, NC-01; nicht erneut geprüft) |
| Modulformat | Nur ESM mit `import`-Bedingung, kein `sideEffects`-Feld (NC-02), keine Node-Importe |
| Kryptobausteine | Direkt eingebunden und gleich den Versionen, die nostr-core nutzt: `@noble/hashes` 1.8.0, `@noble/ciphers` 1.3.0, `@noble/curves` 1.9.7, `@scure/base` 1.2.6 |
| Neue Abhängigkeiten in diesem Arbeitspunkt | Keine |

## Einbindung in die App

Nur `lib/nostr/` berührt nostr-core ([Entscheidung 0002](../../../decisions/0002-architektur.md), Abschnitt 2). Die Grenze prüft [`tests/nostr-boundary.test.ts`](../../../../tests/nostr-boundary.test.ts).

| Datei | Aufgabe |
| --- | --- |
| `lib/nostr/core.ts` | `loadCore()`: der einzige Weg zur Laufzeit, ein zwischengespeichertes dynamisches `import("./runtime.ts")`; ein Ladefehler (offline) wird nicht gemerkt, der nächste Aufruf versucht es erneut |
| `lib/nostr/runtime.ts` | Das einzige Modul mit nostr-core-Code: benannte Importe der tatsächlich genutzten Funktionen. Erreichbar nur über `core.ts` |
| `lib/nostr/types.ts` | Reine Typ-Reexporte für alle anderen Module |
| `lib/nostr/relays.ts` | Relay-Katalog nach Abschnitt 5: Rollen Profil und Allgemein, Betreibergruppen (nos.lol und nostr.mom ein Betreiber), „veröffentlicht“ ab zwei Betreibern, Ersatz durch `NEXT_PUBLIC_BLUELINE_RELAYS` |
| `lib/nostr/client.ts` | `publish`, `query`, `subscribe`, NIP-42 mit Signer |
| `lib/nostr/time.ts` | Uhrzeit für `created_at` mit Korrektur einer falsch gehenden Geräteuhr |
| `lib/nostr/signers.ts` | `verifyingSigner`, `createLocalSigner`, `connectNip07`, `connectBunker`, `startNostrConnect`, `resumeNip46` |
| `lib/nostr/ext/` | Fehlende generische Bausteine, je Datei mit dem Kopfvermerk „To be upstreamed to nostr-core“: `nip49.ts` (+ `nip49.worker.ts`, `nip49.offthread.ts`), `nostrconnect.ts`, `nip55.ts`, `crypto.ts`, `validate.ts`, `lists.ts` |

**Abweichung vom Auftragstext:** `loadCore()` importiert nicht wörtlich `import("nostr-core")`, sondern `import("./runtime.ts")`, das benannte Importe aus nostr-core weiterreicht. Gemessen ist das um den Faktor 5,4 kleiner (Tabelle unten), weil webpack bei einem Namensraum-Import das ganze Paket einbindet. Die Grenze bleibt dieselbe: nostr-core-Code wird nur über einen dynamischen Import erreicht. Wer eine weitere Funktion braucht, trägt ihren Namen in `runtime.ts` ein.

## Bundle-Messung

Aufbau: `next build` (Next.js 15.5.27) im Worktree, `next start -p 3202`, Chromium über Playwright 1.63, Service Worker blockiert. Eine temporäre Messseite `/nostr-probe` ([Quelle](scripts/nostr-probe.page.tsx.txt), wieder entfernt) lädt die Nostr-Schicht per Klick. Das Skript [`scripts/measure.mjs`](scripts/measure.mjs) zeichnet alle JS-Dateien und WebSockets je Schritt auf und berechnet die gzip-Größe (Stufe 9) aus `.next`.

| Variante | nostr-core-Chunk beim ersten `loadCore()` | Startseite `/` |
| --- | --- | --- |
| **A, gewählt:** `runtime.ts` mit benannten Importen, `experimental.optimizePackageImports: ["nostr-core"]` | **21,7 KB gzip** (62.486 Byte minifiziert), plus 0,4 KB | 46,6 kB, First Load JS 246 kB |
| B: wie A, ohne `optimizePackageImports` | 54,7 KB gzip, enthält `turndown` (RSS/Markdown) | unverändert |
| C: wörtliches `import("nostr-core")`, mit `optimizePackageImports` | 116,3 KB gzip, enthält RSS, Markdown, alles | unverändert |
| 1.0.0 (Baseline P0.01) | nicht vorhanden | 46,6 kB, First Load JS 246 kB, gemeinsam 103 kB |

- `optimizePackageImports` spart bei Variante A 33 KB gzip und verändert keine Datei des Gastwegs (gleiche Chunk-Hashes für `/` in A und B, abweichend nur die webpack-Laufzeit mit der Chunk-Tabelle).
- Der Chunk der Variante A enthält weder den XML-Parser noch `turndown` noch die BIP-39-Wortliste (NC-03 entfällt damit vorerst).
- Gastweg: 16 JS-Dateien, 259,0 KB gzip, kein Treffer für nostr-core-Merkmale (`verifyEventSignature`, `XMLParser`, `turndown`, `nostrconnect`, `ncryptsec`, `scrypt`), keine WebSocket-Verbindung. WebSockets entstehen erst nach dem Klick auf der Messseite, und nur zum lokalen Relay.
- Laden der Schicht: 25 bis 100 ms bis `loadCore()` fertig ist (lokaler Server, schwankend).
- Der Produktionsbuild ohne Messseite hat dieselbe Routentabelle wie 1.0.0: nur statische Seiten, keine serverseitige Route (A25).

## Browserprüfung

Mit der Messseite, `nak serve` auf `ws://127.0.0.1:10547`, je ein Lauf in Chromium 153.0.8010.12 und WebKit 26.6 (Playwright):

| Prüfung | Chromium | WebKit |
| --- | --- | --- |
| nostr-core laden, Schlüssel erzeugen, signieren, Signatur prüfen | ja | ja |
| NIP-44-Probe über den Signer (verschlüsseln an sich selbst, entschlüsseln) | ja | ja |
| NIP-49 im Web Worker (`new Worker(new URL(...), { type: "module" })`) | ja, Worker aktiv | ja, Worker aktiv |
| NIP-49 log_n 16: verschlüsseln / entschlüsseln | 0,27 bis 0,54 s / 0,26 bis 0,45 s | 0,42 bis 0,69 s / 0,31 s |
| Datenschlüssel-Umschlag hin und zurück | ja | ja |
| Veröffentlichen und Wiederlesen über `client.ts` | `ok`, `complete: true`, Event gefunden | dasselbe |
| Relay-Katalog ohne Build-Variable | vier allgemeine, fünf Profil-Relays nach Abschnitt 5 | dasselbe |
| Relay-Katalog mit `NEXT_PUBLIC_BLUELINE_RELAYS="ws://127.0.0.1:10547, ws://localhost:10547/"` | beide Rollen ersetzt, Schreibweise vereinheitlicht, Veröffentlichung dorthin | nicht separat |

### scrypt im Worker

Der erste Stand des Workers rief das synchrone `scrypt` auf. In Chromium dauerten log_n 16 damit 2,7 bis 3,5 s pro Vorgang, auf dem Hauptthread mit `scryptAsync` dagegen 0,25 bis 0,3 s; Node braucht 0,22 s. Ein reiner Speicher-Benchmark ([`scripts/worker-bench.mjs`](scripts/worker-bench.mjs), 64 MiB mit Zufallszugriffen) lief im Worker so schnell wie auf dem Hauptthread (81 gegen 88 ms), und log_n 12 im Worker brauchte proportional 0,21 s. Es liegt also an der einen langen Schleife des synchronen scrypt, nicht am Worker. Mit `scryptAsync` im Worker: 0,26 bis 0,54 s. Die Ursache in V8 ist nicht weiter untersucht.

Außerdem gibt `scryptAsync` nur an Mikrotasks ab: Auf dem Hauptthread kann die Seite während der Rechnung weder zeichnen noch Eingaben annehmen (gemessen: kein einziger 10-ms-Timer lief). Der Rückfallweg ohne Worker blockiert die Seite also für die ganze Rechnung; das steht so in den Kommentaren.

Telefone wurden nicht gemessen. Für die Sicherungsdatei (P2.04) ist log_n 16 auf schwachen Android-Geräten und älteren iPhones noch zu prüfen (DR-16).

## Abdeckung nach Bereich

Status: **vorhanden** (wie benötigt nutzbar), **teilweise** (vorhanden, aber mit Lücke oder Fehler), **fehlt**. „Nachweis“ nennt den Test, der Lücke und Ersatz zeigt. Alle Testdateien liegen unter `tests/`; `relay/…` läuft mit `npm run test:relay` gegen nak.

| Bereich | nostr-core 1.0.4 | Status | Ersatz in BlueLine | Vorgeschlagene Änderung in nostr-core | Nachweis |
| --- | --- | --- | --- | --- | --- |
| Paket und Tree-Shaking (NC-02) | Kein `sideEffects`, `rss.js` erzeugt beim Laden einen XML-Parser | teilweise | `runtime.ts` mit benannten Importen, `optimizePackageImports`, nur dynamisch geladen | `"sideEffects": false`, RSS als eigener Unterpfad `nostr-core/rss` | Messung oben; `nostr-core-gaps` NC-02 |
| Doppelte Kryptobibliotheken (NC-03) | `@scure/bip32`/`bip39` 2.x ziehen `@noble/*` 2.x nach | teilweise | Mnemonik-Funktionen werden nicht importiert; Chunk ohne Wortliste | Alle `@noble/*`/`@scure/*` auf eine Hauptversion | Chunk-Inhalt oben |
| Events, Signaturen | `finalizeEvent`, `verifyEventSignature` (Hash und Signatur), `getEventHash` | vorhanden | – | – | `nostr-signers`, `relay/interop` (nak verify) |
| NIP-44 v2 | Alle offiziellen Vektoren bestanden (P0.01, DR-19) | vorhanden | – | Testvektoren ins Repository | `relay/interop` (nak encrypt/decrypt in beide Richtungen) |
| NIP-19 | Kodieren und Dekodieren | vorhanden | – | – | `nostr-nip55` (npub in Antwort) |
| Relay: Antworten und Leerstand (NC-10) | `querySync` liefert `[]`, wenn kein Relay antwortet; künstliches EOSE nach 4,4 s; `publish` ohne URL und Grund; OK-Präfixe nicht ausgewertet; offene Timer nach `publish` auf getrennter Verbindung | teilweise | `client.ts`: Ergebnis je Relay mit Präfix (`duplicate`, `rate-limited`, `auth-required`, `mute`, `blocked`, `invalid`, …) oder `timeout`/`unreachable`; `query` mit echtem EOSE, `answered`, `failed`, `complete`; „kein Relay hat geantwortet“ ist unbekannt, nicht leer; Entdoppelung und neueste Fassung je Koordinate; keine unbehandelten Ablehnungen | EOSE-Grund, Ergebnis je Relay, ausgewertete Präfixe, Fehler statt `[]`, Timer-Leck beheben | `nostr-client`, `relay/relay`, `nostr-core-gaps` NC-10 |
| Abos und Grenzen (OP-13, PR-21) | Ein Filter je `subscribe`, keine Begrenzung | teilweise | `subscribe` bündelt Filter, höchstens 15 REQs je Relay (10 dauerhaft, 5 für Abfragen), Wiederverbindung, erneuter Versuch bei anfangs nicht erreichbaren Relays | Mehrere Filter, Budget je Relay | `nostr-client` (30 Abos, höchstens 15 offen), `relay/relay` (30 Abos, Neustart des Relays) |
| NIP-42 | Vorlage und `Relay.onauth`/`auth` von Hand, Pool ohne AUTH | teilweise | `client.ts`: AUTH mit dem Signer nur, wenn ein Relay `auth-required:` sagt, danach ein Wiederholungsversuch; je Aufruf abschaltbar; nach Wiederverbindung erneut | AUTH-Handler mit Signer in `Relay`/`RelayPool`, Wiederholen nach AUTH | `nostr-client`, `relay/relay` mit `nak serve --auth` |
| Zeit für `created_at` (OP-09) | Geräteuhr | fehlt | `time.ts`: Abweichung über den `Date`-Header der eigenen Seite, höchstens 600 s voraus, Ersatz immer neuer als der Vorgänger | – (App-Sache) | `nostr-client` (Uhr) |
| Signer-Schnittstelle, lokaler Schlüssel | `Signer`, `createSecretKeySigner` | vorhanden | `createLocalSigner` mit Prüfung | – | `nostr-signers` |
| Prüfung signierter Events (NC-22) | `Nip07Signer` und `NostrConnect` reichen alles ungeprüft durch, auch ein unsigniertes Objekt | teilweise | `verifyingSigner`: gültige Signatur, erwarteter Schlüssel, Kind/Inhalt/Tags/Zeit unverändert, saubere Kopie; Identitätswechsel wird erkannt | Optionaler prüfender Wrapper | `nostr-signers`, `nostr-core-gaps` NC-22 |
| NIP-07 (DR-14) | `Nip07Signer` liest `window.nostr` beim Erzeugen; `nip44` immer vorhanden, wirft erst beim Aufruf | teilweise | `connectNip07`: kurzes Warten auf spät eingefügtes `window.nostr`, NIP-44-Erkennung, `probeNip44` als echter Rundlauf | Fähigkeitsabfrage | `nostr-signers` |
| NIP-46 bunker:// (NC-05) | Handshake vorhanden; `connect`-Parameter veraltet, kein perms/Metadaten, `auth_url` wird Fehler, kein ping/switch_relays/logout, nur ein Relay, kein Fortsetzen ohne erneutes `connect` (das Geheimnis ist einmalig) | teilweise | `connectBunker`: Handshake mit `NostrConnect`, danach `Nip46Signer` aus `ext/nostrconnect.ts` mit Fortsetzen, `auth_url` als Rückruf, ping, switch_relays, logout, alle Relays; Zeitüberschreitung heißt „unbekannt“ | Spec-konforme Parameter, `auth_url`-Rückruf, neue Methoden, Mehr-Relay, `resume()` | `relay/nip46` (nak bunker, Neuladen ohne zweites `connect`), `nostr-nip46` |
| NIP-46 nostrconnect:// (NC-04) | Fehlt; `parseConnectionURI` liest den Host (Client-Schlüssel) als Signer-Schlüssel | fehlt | `createClientUri` (Client-Schlüssel, Relays, Geheimnis, perms, name/url/image), `waitForSigner` (Geheimnis prüfen, Signer-Schlüssel lernen, dann `get_public_key`), `startNostrConnect` | `NostrConnect.createClientUri()` plus `waitForSigner()`, Doku korrigieren | `relay/nip46` (nak bunker connect), `nostr-nip46` (falsches Geheimnis, Abbruch), `nostr-core-gaps` NC-04 |
| NIP-49 (NC-06) | Fehlt | fehlt | `ext/nip49.ts`: scrypt, XChaCha20-Poly1305, NFKC, Schlüsselsicherheits-Byte, log_n bis 20; Worker mit Rückfallweg | `nip49.encrypt/decrypt` mit Testvektor | `nostr-nip49` (offizieller Vektor, NFKC-Beispiel der Spec), `relay/interop` (nak key encrypt/decrypt in beide Richtungen, Umlaute komponiert und zerlegt), Browserprüfung |
| NIP-55 (NC-07) | Fehlt | fehlt | `ext/nip55.ts`: `buildSignerUrl` für `get_public_key` und `sign_event`, Rückgabe-URL mit Fragment, `parseCallback` inklusive `Signer1`+gzip, Zuordnung über Anfrage-ID und Alter; keine Entschlüsselung über NIP-55 | `nip55`-Modul | `nostr-nip55` |
| Signer-basierte Verschlüsselung (NC-08, PR-06) | NIP-59, NIP-17, NIP-51, NIP-78 nur mit Rohschlüssel; `unwrap` prüft die Rumor-ID nicht; kein Kind 21059 | teilweise | `ext/crypto.ts`: `sealWithSigner`, `giftWrapWithSigner` (1059 und 21059), `unwrapWithSigner` mit beiden Signaturen, Autorbindung und Rumor-ID | Signer-Varianten, Rumor-ID-Prüfung, Kind 21059 | `nostr-crypto` (gefälschte ID), `relay/interop` (nak gift wrap/unwrap in beide Richtungen) |
| Private App-Daten (NC-21, Abschnitt 4) | `createAppDataTemplate` mit lesbarem `d`; Selbstverschlüsselung nur mit Rohschlüssel | teilweise | Datenschlüssel-Umschlag (XChaCha20-Poly1305, Version, Datensatz als Zusatzdaten), einmal per NIP-44 an sich selbst verpackt; `opaqueDTag` = HMAC-SHA256(Datenschlüssel, Datensatz-ID) | Signer-Variante für NIP-78 | `nostr-crypto` |
| NIP-51 (NC-09) | Nicht lesbare private Einträge erscheinen als leere Liste; ohne Schlüssel verschwinden sie beim Schreiben | teilweise | `ext/lists.ts`: `privateStatus` `none`/`decrypted`/`undecryptable`/`no-key`, NIP-04-Altformat, unbekannte Tags bleiben, Schreiben über unlesbare Einträge wird verweigert, private Einträge bleiben ohne ausdrückliche Änderung erhalten | Status, Rohinhalt, Fehler statt stillem Verlust | `nostr-lists`, `nostr-core-gaps` NC-09 |
| NIP-65 (NC-16) | `parseRelayList` wirft bei einer ungültigen URL | teilweise | `parseRelayListSafe`: überspringt und meldet ungültige Einträge, vereint Doppelte, behält andere Tags | Ungültige Einträge melden statt werfen | `nostr-lists` |
| NIP-58 (NC-15, PR-04) | `validateBadgeAward` prüft weder Aussteller noch Signaturen noch Empfänger; Profilauswahl nur als altes 30008 | teilweise | `validateBadgeAward` (Aussteller gleich Definitionsautor, beide Signaturen, genau diese Definition, Empfänger), Profilauswahl 10008 lesen und schreiben, 30008 lesen und übernehmen, fremde Tags bleiben | Strenge Prüfung, 10008-Schreibweg | `nostr-validate` (Fälschung, die nostr-core annimmt), `nostr-lists` |
| NIP-57 (NC-14, OP-23) | `validateZapReceipt` prüft nur die eigene Signatur | teilweise | `validateZapReceipt` (Signer gleich `nostrPubkey`, Betrag, Beschreibungshash, Empfänger, Absender, Event, LNURL) | Vollständige Prüfung nach Anhang F | `nostr-validate` (Fälschung, die nostr-core annimmt) |
| BOLT11 | `decodeBolt11` | vorhanden | `checkInvoice` (Betrag, Restlaufzeit, Beschreibungshash, Nullbetrag) | Betragsprüfung in den LNURL-Abrufen | `nostr-validate` (eigene signierte Testrechnungen) |
| NWC (NC-11, NC-12, NC-13, OP-16) | Kein `encryption`-Tag; `pay_invoice` wird nach unlesbarer Antwort erneut gesendet; kein `expiration`, kein `lookup_payment`, `lud16` geht verloren | teilweise | Nicht Teil dieses Arbeitspunkts (P7b). Reproduziert: doppelte Zahlung ohne, einfache Zahlung mit `connect({ verifyEncryption: true })` | `encryption`-Tag, keine Wiederholung nicht-idempotenter Methoden, `expiration`, `lookup_payment`, `lud16`, NWC-07/08 | `nostr-core-gaps` NC-11/NC-12 |
| NIP-13 (NC-17) | `minePow` rechnet mit Platzhalter-Schlüssel, Ergebnis nach dem Signieren ungültig | fehlerhaft | Nicht verwendet | `minePow(template, difficulty, pubkey)` | `nostr-core-gaps` NC-17 |
| Weitere (NIP-09, NIP-40, Schema- und Policy-Bausteine, Kurs-API) | Vorhanden (P0.01, PR-22) | vorhanden | Für spätere Arbeitspunkte | – | nicht in diesem Arbeitspunkt geprüft |

## Tests

| Befehl | Ergebnis (4. Oktober 2026) |
| --- | --- |
| `npm test` (Node 25.2.1) | 129 von 129 bestanden; davon 89 neue Tests für `lib/nostr` in 11 Dateien |
| `npx -p node@22 node --test tests/*.test.ts` (Node 22.23.3) | 129 von 129 bestanden |
| `npm run test:relay` (nak serve, nak bunker, nak als Gegenimplementierung) | 15 von 15 bestanden |
| `npm run lint`, `npm run typecheck`, `npm run build` | bestanden; siehe Aufgabenkarte P0.03 |

`npm test` braucht kein nak. Die Relay-Tests starten `nak serve` und `nak bunker` auf `127.0.0.1` mit Wegwerfschlüsseln und eigenem `HOME` für nak ([`tests/support/nak.ts`](../../../../tests/support/nak.ts)); öffentliche Relays und Wallets werden nie angesprochen. Ohne Prozess und Port arbeiten die Unit-Tests mit einem Relay-Netz im Speicher ([`tests/support/fake-relay.ts`](../../../../tests/support/fake-relay.ts)).

## Nicht geprüft

- Echte Geräte, Safari auf iOS, Firefox, installierte PWA.
- Echte externe Signer: Browser-Erweiterungen (Alby, nos2x, Nostash), Amber über NIP-46 und NIP-55, nsec.app, Clave. Der NIP-46-Ablauf ist nur gegen `nak bunker` geprüft, NIP-55 nur mit erzeugten Antworten. Insbesondere ungeprüft: ob Amber an eine Rückgabe-URL mit Fragment anhängt (DR-15) und wie Signer nach dem Wechsel in den Hintergrund antworten (DR-02).
- Öffentliche Relays: absichtlich nicht angesprochen (Freigabe des Schreibtests steht aus, P0.06). Ihre Grenzen (Ereignisgröße, Ratenbegrenzung, AUTH-Pflicht) sind daher nur aus NIP-11 und Quellcode bekannt.
- NWC mit echten Wallets (P7b).
- Laufzeit der Signaturprüfung pro empfangenem Event auf Telefonen (NC-20) und scrypt auf Telefonen.
- Andere Next.js-Versionen als 15.5.27.

## Upstream

Alles in `lib/nostr/ext/` hängt nur von nostr-core und dessen Kryptobibliotheken ab und hat eigene Tests. Vorgeschlagene Reihenfolge der Beiträge (NC-23): (1) `sideEffects` und RSS-Unterpfad, (2) NWC: `encryption`-Tag und keine Wiederholung von `pay_invoice`, (3) NIP-51-Status, (4) nostrconnect:// und NIP-46-Korrekturen, (5) NIP-49, (6) NIP-58, (7) NIP-57-Prüfung, (8) NWC-07/08/09, (9) NIP-55, dazu Relay-Ergebnisse je Relay mit NIP-42-Handler und die Signer-Varianten für NIP-59. Zusammenführen und Veröffentlichen kann nur ein Maintainer; danach wird die neue Version fest eingetragen, die Lückentests in `tests/nostr-core-gaps.test.ts` schlagen dann fehl und zeigen, welcher Ersatz entfallen kann.
