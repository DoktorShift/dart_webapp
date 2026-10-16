# P3a.01 Core-Ergänzungen

**Status:** Wartet auf Nachweis
**Paket:** P3a · **Planstelle:** [PLAN.md](../PLAN.md), Zeile 678; Bibliothekskapitel Zeilen 593 bis 608

## Ziel

Die generischen Bausteine, die der Plan braucht und nostr-core 1.0.6 nicht oder fehlerhaft liefert, stehen geprüft zur Verfügung: NIP-49, direkte NIP-55-Anbindung, der nostrconnect://-Ablauf von NIP-46, aktuelle Badge-Formate mit vollständiger Prüfung, sichere private Listen sowie Signer-basierte Verschlüsselung. Sie sind so gebaut, dass sie unverändert in nostr-core übernommen werden können.

## Produktregeln und Abnahmekriterien

- Betroffene Kriterien: A25 (Ergänzungen in der verwendeten Core-Version), A07 und A20 (Sicherungsdatei mit NIP-49), A23 (Aussteller- und Empfängerprüfung), A09 bis A11 (keine stillen Verluste privater Einträge).
- [Entscheidung 0001](../../decisions/0001-kein-eigenes-backend.md) Punkt 3: Bis nostr-core sie enthält, liegen die Ergänzungen upstream-fähig in `lib/nostr/ext/`, nur auf nostr-core, `@noble/*` und `@scure/base` gebaut. Keine weitere Nostr-Bibliothek (PLAN.md Zeile 608).

## Voraussetzungen

- P0.03 (In Prüfung): Lücken mit Beispielen festgehalten.
- Für den Abschluss: Zusammenführen und Veröffentlichen in nostr-core durch einen Maintainer; danach feste Version eintragen (Nutzerhandlung, NC-23). Erste Runde erledigt: 1.0.6 seit dem 16. Oktober 2026 fest eingetragen (Abschlussnachweise).

## Geplante Änderung

| Baustein | Datei | Inhalt |
| --- | --- | --- |
| NIP-49 | `lib/nostr/ext/nip49.ts`, `nip49.worker.ts`, `nip49.offthread.ts` | `encrypt`/`decrypt` (scrypt, XChaCha20-Poly1305, NFKC, Schlüsselsicherheits-Byte, log_n 1 bis 20), asynchrone Varianten, Web Worker mit Rückfallweg, `inspect` |
| NIP-46 nostrconnect:// und bunker:// | `lib/nostr/ext/nostrconnect.ts` | `createClientUri`, `waitForSigner` mit Geheimnisprüfung, Schlüsselnachweis (signierte Challenge, Art 22242), Erkennung eines zweiten Signers (`mismatch`) und Bestätigungsschritt `confirm`, `connectToBunker` mit aktuellen `connect`-Parametern auf allen Relays, `Nip46Signer` über Kind 24133 mit NIP-44 auf allen Relays, `auth_url` hält die Anfrage offen (nur https), ping, switch_relays (nur nutzbare Relays; alte Abos bleiben bis zur Antwort offener Anfragen), logout, `resume` ohne erneutes `connect`. Seit nostr-core 1.0.6 sendet auch dessen `NostrConnect` die heutigen `connect`-Parameter und wartet bei `auth_url`; alles Übrige bleibt hier |
| NIP-55 | `lib/nostr/ext/nip55.ts` | `buildSignerUrl` für `get_public_key` und `sign_event`, Rückgabe-URL mit Fragment, `parseCallback` inklusive `Signer1`+gzip über `DecompressionStream`, `matchPending` mit Anfrage-ID und Höchstalter, geprüfte Ergebnisse; keine Entschlüsselung |
| Signer-basierte Verschlüsselung | `lib/nostr/ext/crypto.ts` | `sealWithSigner`, `giftWrapWithSigner` (1059 und 21059), `unwrapWithSigner` mit Rumor-ID-Prüfung (seit nostr-core 1.0.6 auch im dortigen `unwrap` mit Rohschlüssel); Datenschlüssel-Umschlag (Version 1); `wrapDataKey`/`unwrapDataKey`; `opaqueDTag` = HMAC-SHA256(Datenschlüssel, Datensatz-ID) |
| Prüfung | `lib/nostr/ext/validate.ts` | `validateBadgeAward` (NIP-58 streng), `validateZapReceipt` (NIP-57 Anhang F), `checkInvoice` (BOLT11 über `decodeBolt11`) |
| Listen | `lib/nostr/ext/lists.ts` | NIP-51 mit `privateStatus`, NIP-04-Altformat und Schreibschutz; NIP-65 ohne Ausfall bei einem fehlerhaften Eintrag; NIP-58-Profilauswahl 10008 lesen und schreiben, 30008 lesen |

Nicht dazu: NWC-Korrekturen (P7b), Relay-Client (P0.03/P3a.02), die eigentlichen Pull-Requests an nostr-core.

## Fehlerfälle

| Fall | Sollverhalten | Geprüft in |
| --- | --- | --- |
| Offizieller NIP-49-Testvektor, NFKC-Beispiel der Spec, Umlaut komponiert gegen zerlegt | Gleiches Ergebnis wie die Spec und wie nak | `nostr-nip49`, `relay/interop` |
| Falsches Kennwort, beschädigte Daten, log_n über 20 | `wrong-password`, `malformed`, `unsupported` | `nostr-nip49` |
| nostrconnect-Antwort mit falschem Geheimnis | Ignoriert, die richtige verbindet | `nostr-nip46` |
| nostrconnect-Antwort mit dem richtigen Geheimnis, aber fremdem Schlüssel (QR-Code mitgelesen) | Schlüsselnachweis schlägt fehl, das Warten endet (`invalid`, oder `mismatch`, wenn der echte Signer schon geantwortet hat); nichts Privates geht an die fremde Partei | `nostr-nip46` |
| Zwei verschiedene Signer antworten mit dem Geheimnis (Mitleser mit eigenem Konto zuerst) | `mismatch` während der Prüfung, bis `graceMs` nach dem Nachweis oder solange `confirm` offen ist; nichts herausgegeben oder gespeichert | `nostr-nip46`, `relay/nip46` (zwei nak-Bunker) |
| Nutzer verneint das gezeigte Konto | `rejected`, nichts gespeichert; `onSessionChange` erst nach dem Ja | `nostr-nip46` |
| `auth_url` | Anfrage bleibt offen, Rückruf mit URL, Abschluss auf derselben ID; auch beim bunker://-`connect` | `nostr-nip46` |
| `auth_url` mit `javascript:`, `data:` oder http im Internet | Kein Rückruf, Anfrage schlägt mit `invalid` fehl | `nostr-nip46` |
| switch_relays nennt nur unbrauchbare Relays | Sitzung bleibt, nichts wird gespeichert | `nostr-nip46` |
| Signer wechselt Relays während einer offenen Anfrage | Antwort kommt trotzdem an | `nostr-nip46` |
| NIP-55-Antwort zu alt, fremde ID, anderer Schlüssel, verändertes Event | Abgelehnt | `nostr-nip55` |
| Gift Wrap mit falscher Rumor-ID, fremdem Autor, ungültigen Signaturen | `forged` | `nostr-crypto` |
| Umschlag mit falschem Schlüssel oder für einen anderen Datensatz | `undecryptable` | `nostr-crypto` |
| Signer lehnt das Entpacken des Datenschlüssels oder eines Gift Wraps ab, antwortet nicht oder ist nicht erreichbar | Der Signer-Fehler kommt unverändert an, nie `undecryptable` | `nostr-crypto` |
| Vergabe durch Fremde, falscher Empfänger, falsche Definition | Abgelehnt (nostr-core nimmt die Fälschung an) | `nostr-validate` |
| Zap-Beleg von fremdem Schlüssel, falscher Betrag, Hash, Empfänger, LNURL | Abgelehnt (nostr-core nimmt die Fälschung an) | `nostr-validate` |
| Rechnung abgelaufen, kurz vor Ablauf, ohne Betrag | Abgelehnt | `nostr-validate` |
| Private Listeneinträge nicht lesbar | Status `undecryptable`/`unavailable`/`no-key`, Schreiben verweigert | `nostr-lists` |
| Liste nur öffentlich geändert | Private Einträge bleiben | `nostr-lists` |
| 10002 mit ungültiger URL oder leerem Marker | Eintrag übersprungen und gemeldet beziehungsweise als lesen und schreiben gewertet | `nostr-lists` |
| 10002 mit ws://-Relay im Heimnetz oder über Tor, dann bearbeitet und geschrieben | Eintrag bleibt unverändert erhalten | `nostr-lists` |

## Abschlussnachweise

| Nachweis | Ort |
| --- | --- |
| Abdeckung, Ersatz, Upstream-Vorschlag je Baustein | [evidence/P0.03/CORE.md](../evidence/P0.03/CORE.md), Abschnitt „Abdeckung nach Bereich“ |
| Interop mit unabhängiger Implementierung (nak) für NIP-44, NIP-59, NIP-49, NIP-46 | `tests/relay/interop.test.ts`, `tests/relay/nip46.test.ts` |
| Zusammengeführte Änderungen in nostr-core und feste neue Version | Teilweise. nostr-core 1.0.6 (veröffentlicht am 13. Oktober 2026, fest eingetragen am 16. Oktober 2026) enthält aus dieser Karte die NIP-46-`connect`-Parameter mit Signer-Schlüssel (#77), das Warten bei `auth_url` (#84), perms und Client-Metadaten beim `connect` (#86) sowie die Rumor-ID-Prüfung in NIP-59 (#78); dazu aus P0.03 `publishDetailed` mit Relay-Gründen (#79) und die NIP-42-Wiederholung (#72). Offen: NIP-49, NIP-55, nostrconnect://-Ablauf und fortsetzbarer Signer auf allen Relays, Signer-basierte NIP-59, NIP-51-Status, NIP-58- und NIP-57-Prüfung, NWC (P7b) |

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch | `wave1/nostr` |
| Basiscommit | `fd4e6c51639f1721bd5e1f01619eeaf6f2f22da5` |
| Prüfcommit | Erste Fassung `623540e`; Prüfrunde 1: `94b9873`, `2e110ce`; Prüfrunde 2: der Commit, der diesen Absatz ändert |
| nostr-core-Version | 1.0.6 seit dem 16. Oktober 2026 (Prüfrunden gegen 1.0.4); Ergänzungen in `lib/nostr/ext/` |
| Ausgeführte Prüfungen | Wie [P0.03](P0.03.md): `npm test` 141 von 141 (die erste Fassung meldete fälschlich 129 von 129), `npm run test:relay` 16 von 16, Browserprüfung von NIP-49 im Worker (Chromium 153, WebKit 26.6) |
| Nicht ausgeführte Prüfungen | NIP-55 mit echtem Amber (Anhängen an ein Fragment, Rückkehr in die PWA), NIP-46 mit Amber, nsec.app und Clave (darunter: Schlüsselnachweis ohne zusätzliche Rückfrage, `auth_url` beim `connect`), NIP-49-Laufzeit auf Telefonen |
| Verbleibende Einschränkungen | Erst zum Teil in nostr-core (Abschlussnachweise). Das Planziel „in nostr-core liefern“ ist für die übrigen Bausteine erst mit Veröffentlichung und fester Version erfüllt. Kontotausch beim nostrconnect://-QR-Code nur mit Bestätigung durch den Nutzer abgewehrt (CORE.md, Restrisiken). |

## Nächster Schritt

Für die offenen Bausteine kleine, getrennte Pull-Requests an nostr-core in der Reihenfolge aus CORE.md vorbereiten; der Nutzer stimmt Review und Veröffentlichung mit dem Co-Maintainer ab.
