# BlueLine Darts Protokoll

Das offen beschriebene Darts-Format für Nostr: Kinds, Verträge je Eventfamilie, Rechte, Konfliktregeln, Datenschutz, JSON-Schemas und Testvektoren. Grundlage sind das Kapitel „Ereignismodell und eigenes Darts Format“ in [PLAN.md](../implementation/PLAN.md), [Entscheidung 0001](../decisions/0001-kein-eigenes-backend.md) und [Entscheidung 0002](../decisions/0002-architektur.md) §6 und §7.

Stand: **P0.05**, 4. Oktober 2026, nach Review Runde 1 am 5. Oktober 2026, Formatversion 1. Implementierung: [`lib/protocol/`](../../lib/protocol) (reines TypeScript ohne Netzwerk). Die Kind-Nummern sind noch nicht im Kind-Register eingetragen und das Siegelverfahren geschlossener Clubs ist noch nicht extern geprüft (beides Nutzerhandlungen); bis dahin gilt hier nichts als Standard für andere Apps.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| [`kinds.md`](kinds.md) | Kinds 1180 / 31180 / 21180, Labels, Pflicht-Tags, Verschlüsselungsformen, versiegelter Umschlag, Grenzen, Versionsregeln, Prüfreihenfolge |
| [`families/club.md`](families/club.md) | Clubs: Gründung, Rollen, Einladungen (Gruppenlink, persönlich), Beitritt, geschlossene Clubs, Saisons, Termine, Ergebnisentscheidungen |
| [`families/tournament.md`](families/tournament.md) | Turniere: Anmeldung, Warteliste, Check-in, Gäste, Festlegung und Auslosung, Boards, Ergebnisse, Korrekturen, Übergabe |
| [`families/session-authorization.md`](families/session-authorization.md) | Match-Gründung, Sitzungsschlüssel, Schreiberwechsel |
| [`families/match-live.md`](families/match-live.md) | Live-Spielstand und kompakte Wurfkodierung |
| [`families/match-result.md`](families/match-result.md) | Ergebnis, Korrektur, Protokollstücke, Bestätigung |
| [`families/pairing.md`](families/pairing.md) | Eigenes Gerät koppeln, Links und QR-Codes, Code ohne Kamera, Prüfkennung |
| [`families/board-join.md`](families/board-join.md) | Mit dem eigenen Handy an einem Board mitspielen |
| [`families/private-records.md`](families/private-records.md) | Private, verschlüsselte Datensätze des Profils (NIP-78) |
| [`families/badges.md`](families/badges.md) | Auszeichnungen (NIP-58) |
| [`families/payment-request.md`](families/payment-request.md) | Private Zahlungsanfrage zwischen Spielern (NIP-59) |
| [`permissions.md`](permissions.md) | Rechte von Eigentümer, Admin, Turnierleiter, Mitglied, Gast, Veranstalter, Board, Schreiber, Spieler |
| [`conflicts.md`](conflicts.md) | Abspielreihenfolge, erwarteter Vorgänger, Einladungswettläufe, Uhren, alle Ablehnungsgründe |
| [`privacy.md`](privacy.md) | Was öffentliche Relays sehen; Gäste nur als Alias |
| [`schemas/`](schemas/) | JSON-Schemas aller Inhalte, aus dem Code erzeugt |
| [`vectors/`](vectors/) | Deterministische Testvektoren mit von Hand geschriebenen Erwartungen |

## Testvektoren

`node tests/support/make-vectors.ts` erzeugt `vectors/` und `schemas/` byteidentisch neu (feste Schlüssel aus Namen, feste Zeiten, feste Inhaltsschlüssel und Nonces, BIP-340 ohne Zufall). Die Erwartungen (angewandt, abgelehnt mit Grund, nicht angewandt, Zustand) sind je Fall von Hand aus diesen Regeln geschrieben, nicht aus den Reducern errechnet. `npm test` prüft, dass die Dateien aktuell sind, dass jede Signatur mit nostr-core gilt und dass die Implementierung jede Erwartung erfüllt; Ableitungen (HMAC, HKDF, Hashes, Auslosung) rechnet der Test unabhängig mit `node:crypto` nach, Einladungsnachweise prüft er mit der BIP-340-Prüfung, die auch nostr-core verwendet. `node --test tests/relay/nak.test.ts` prüft zusätzlich mit nak als unabhängiger Implementierung: alle Signaturen, das Entpacken der Inhaltsschlüssel (NIP-44) und einen Durchlauf durch ein lokales In-Memory-Relay.

## Feste Regeln

- Alle Nostr-Funktionen der App laufen über nostr-core ([Entscheidung 0001](../decisions/0001-kein-eigenes-backend.md)); `lib/protocol` importiert es nicht, nur Typen über `lib/nostr/types.ts`.
- Es gibt keinen eigenen Relay und keinen eigenen Server. Jede Eventfamilie funktioniert mit öffentlichen Relays und lokaler Speicherung.
- Unbekannte Versionen werden erhalten, aber nicht als bekannte Regeln ausgeführt.
- Keine Protokollbegriffe in normalen Ansichten; Ablehnungsgründe und Technik nur unter „Erweitert“.
