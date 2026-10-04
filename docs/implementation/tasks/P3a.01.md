# P3a.01 Core-Ergänzungen

**Status:** Wartet auf Nachweis
**Paket:** P3a · **Planstelle:** [PLAN.md](../PLAN.md), Zeile 678; Bibliothekskapitel Zeilen 593 bis 608

## Ziel

Die generischen Bausteine, die der Plan braucht und nostr-core 1.0.4 nicht oder fehlerhaft liefert, stehen geprüft zur Verfügung: NIP-49, direkte NIP-55-Anbindung, der nostrconnect://-Ablauf von NIP-46, aktuelle Badge-Formate mit vollständiger Prüfung, sichere private Listen sowie Signer-basierte Verschlüsselung. Sie sind so gebaut, dass sie unverändert in nostr-core übernommen werden können.

## Produktregeln und Abnahmekriterien

- Betroffene Kriterien: A25 (Ergänzungen in der verwendeten Core-Version), A07 und A20 (Sicherungsdatei mit NIP-49), A23 (Aussteller- und Empfängerprüfung), A09 bis A11 (keine stillen Verluste privater Einträge).
- [Entscheidung 0001](../../decisions/0001-kein-eigenes-backend.md) Punkt 3: Bis nostr-core sie enthält, liegen die Ergänzungen upstream-fähig in `lib/nostr/ext/`, nur auf nostr-core, `@noble/*` und `@scure/base` gebaut. Keine weitere Nostr-Bibliothek (PLAN.md Zeile 608).

## Voraussetzungen

- P0.03 (In Prüfung): Lücken mit Beispielen festgehalten.
- Für den Abschluss: Zusammenführen und Veröffentlichen in nostr-core durch einen Maintainer; danach feste Version eintragen (Nutzerhandlung, NC-23).

## Geplante Änderung

| Baustein | Datei | Inhalt |
| --- | --- | --- |
| NIP-49 | `lib/nostr/ext/nip49.ts`, `nip49.worker.ts`, `nip49.offthread.ts` | `encrypt`/`decrypt` (scrypt, XChaCha20-Poly1305, NFKC, Schlüsselsicherheits-Byte, log_n 1 bis 20), asynchrone Varianten, Web Worker mit Rückfallweg, `inspect` |
| NIP-46 nostrconnect:// | `lib/nostr/ext/nostrconnect.ts` | `createClientUri`, `waitForSigner` mit Geheimnisprüfung, `Nip46Signer` über Kind 24133 mit NIP-44 auf allen Relays, `auth_url` hält die Anfrage offen, ping, switch_relays (alte Abos bleiben bis zur Antwort offener Anfragen), logout, `resume` ohne erneutes `connect` |
| NIP-55 | `lib/nostr/ext/nip55.ts` | `buildSignerUrl` für `get_public_key` und `sign_event`, Rückgabe-URL mit Fragment, `parseCallback` inklusive `Signer1`+gzip über `DecompressionStream`, `matchPending` mit Anfrage-ID und Höchstalter, geprüfte Ergebnisse; keine Entschlüsselung |
| Signer-basierte Verschlüsselung | `lib/nostr/ext/crypto.ts` | `sealWithSigner`, `giftWrapWithSigner` (1059 und 21059), `unwrapWithSigner` mit Rumor-ID-Prüfung; Datenschlüssel-Umschlag (Version 1); `wrapDataKey`/`unwrapDataKey`; `opaqueDTag` = HMAC-SHA256(Datenschlüssel, Datensatz-ID) |
| Prüfung | `lib/nostr/ext/validate.ts` | `validateBadgeAward` (NIP-58 streng), `validateZapReceipt` (NIP-57 Anhang F), `checkInvoice` (BOLT11 über `decodeBolt11`) |
| Listen | `lib/nostr/ext/lists.ts` | NIP-51 mit `privateStatus`, NIP-04-Altformat und Schreibschutz; NIP-65 ohne Ausfall bei einem fehlerhaften Eintrag; NIP-58-Profilauswahl 10008 lesen und schreiben, 30008 lesen |

Nicht dazu: NWC-Korrekturen (P7b), Relay-Client (P0.03/P3a.02), die eigentlichen Pull-Requests an nostr-core.

## Fehlerfälle

| Fall | Sollverhalten | Geprüft in |
| --- | --- | --- |
| Offizieller NIP-49-Testvektor, NFKC-Beispiel der Spec, Umlaut komponiert gegen zerlegt | Gleiches Ergebnis wie die Spec und wie nak | `nostr-nip49`, `relay/interop` |
| Falsches Kennwort, beschädigte Daten, log_n über 20 | `wrong-password`, `malformed`, `unsupported` | `nostr-nip49` |
| nostrconnect-Antwort mit falschem Geheimnis | Ignoriert, die richtige verbindet | `nostr-nip46` |
| `auth_url` | Anfrage bleibt offen, Rückruf mit URL, Abschluss auf derselben ID | `nostr-nip46` |
| Signer wechselt Relays während einer offenen Anfrage | Antwort kommt trotzdem an | `nostr-nip46` |
| NIP-55-Antwort zu alt, fremde ID, anderer Schlüssel, verändertes Event | Abgelehnt | `nostr-nip55` |
| Gift Wrap mit falscher Rumor-ID, fremdem Autor, ungültigen Signaturen | `forged` | `nostr-crypto` |
| Umschlag mit falschem Schlüssel oder für einen anderen Datensatz | `undecryptable` | `nostr-crypto` |
| Vergabe durch Fremde, falscher Empfänger, falsche Definition | Abgelehnt (nostr-core nimmt die Fälschung an) | `nostr-validate` |
| Zap-Beleg von fremdem Schlüssel, falscher Betrag, Hash, Empfänger, LNURL | Abgelehnt (nostr-core nimmt die Fälschung an) | `nostr-validate` |
| Rechnung abgelaufen, kurz vor Ablauf, ohne Betrag | Abgelehnt | `nostr-validate` |
| Private Listeneinträge nicht lesbar | Status `undecryptable`/`no-key`, Schreiben verweigert | `nostr-lists` |
| Liste nur öffentlich geändert | Private Einträge bleiben | `nostr-lists` |
| 10002 mit ungültiger URL oder leerem Marker | Eintrag übersprungen und gemeldet beziehungsweise als lesen und schreiben gewertet | `nostr-lists` |

## Abschlussnachweise

| Nachweis | Ort |
| --- | --- |
| Abdeckung, Ersatz, Upstream-Vorschlag je Baustein | [evidence/P0.03/CORE.md](../evidence/P0.03/CORE.md), Abschnitt „Abdeckung nach Bereich“ |
| Interop mit unabhängiger Implementierung (nak) für NIP-44, NIP-59, NIP-49, NIP-46 | `tests/relay/interop.test.ts`, `tests/relay/nip46.test.ts` |
| Zusammengeführte Änderungen in nostr-core und feste neue Version | Ausstehend |

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch | `wave1/nostr` |
| Basiscommit | `fd4e6c51639f1721bd5e1f01619eeaf6f2f22da5` |
| Prüfcommit | Der Commit, der diese Karte einführt |
| nostr-core-Version | 1.0.4; Ergänzungen in `lib/nostr/ext/` |
| Ausgeführte Prüfungen | Wie [P0.03](P0.03.md): `npm test` 129 von 129, `npm run test:relay` 15 von 15, Browserprüfung von NIP-49 im Worker (Chromium 153, WebKit 26.6) |
| Nicht ausgeführte Prüfungen | NIP-55 mit echtem Amber (Anhängen an ein Fragment, Rückkehr in die PWA), NIP-46 mit Amber, nsec.app und Clave, NIP-49-Laufzeit auf Telefonen |
| Verbleibende Einschränkungen | Noch nicht in nostr-core. Das Planziel „in nostr-core liefern“ ist erst mit Veröffentlichung und fester Version erfüllt. |

## Nächster Schritt

Kleine, getrennte Pull-Requests an nostr-core in der Reihenfolge aus CORE.md vorbereiten; der Nutzer stimmt Review und Veröffentlichung mit dem Co-Maintainer ab.
