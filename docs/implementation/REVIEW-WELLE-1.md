# Prüfanleitung Welle 1

Stand: 5. Oktober 2026 · Branch `nostr-welle-1` · Grundlage: Version 1.0.0 (`e6ff77e`)

Welle 1 legt die Grundlagen der Nostr-Erweiterung: lokale Datenhaltung, App-Rahmen mit Tabs und Navigation, die Nostr-Schicht über nostr-core, das BlueLine-Protokoll und die Turnierengine. Profile, Abgleich, Geräte, Clubs, Turniere und Zahlungen haben noch keine fertigen Bildschirme; sie folgen in Welle 2 und 3 und docken an die hier gebauten Stellen an.

Der Branch ist nicht veröffentlicht. `main` (1.0.0) ist unverändert.

## Starten

Voraussetzung: Node 22.18 oder neuer.

```sh
git fetch origin
git switch nostr-welle-1
npm ci
npm run dev            # http://localhost:3000
```

Für einen Eindruck wie in Produktion: `npm run build && npm run start`.

Prüfungen:

```sh
npm run lint
npm run typecheck
npm test               # 414 Tests, ohne Netzwerk
npm run test:relay     # 20 Tests gegen lokale Relays; braucht nak unter /opt/homebrew/bin/nak oder in NAK_BIN
```

Die Relay-Tests starten eigene `nak serve`-Relays auf freien Ports und kontaktieren nie öffentliche Relays.

## Was du in der App siehst

1. **Fünf Tabs:** Spielen, Rangliste, Clubs, Turniere, Profil. Auf dem Telefon und dem iPad hochkant als Leiste unten, auf dem iPad quer und am Desktop als Seitenleiste. Während Einrichtung und Spiel sind sie ausgeblendet.
2. **Spielen bleibt wie in 1.0.0:** Einrichtung, Spiel, Ergebnis. Das Spiel ist weiterhin ein fester Bildschirm ohne Scrollen. Neu ist nur, dass die Tabs ihren Zustand behalten: Wer vor dem Spiel in Profil › Einstellungen war, findet sich danach an derselben Stelle wieder.
3. **Rangliste:** stammt jetzt aus dem lokalen Archiv (IndexedDB) mit stabilen Spieler-IDs. Ergebnisse aus 1.0.0 werden einmalig übernommen und als „Importiert“ geführt. Jedes Spiel wird zusätzlich im alten Format gespeichert, damit eine Rückkehr zu 1.0.0 nichts verliert.
4. **Profil (als Gast):** Avatar, „Gast“, die Zahlen dieses Geräts, die Karte „Profil anlegen“ und „Ich habe schon ein Profil“ mit drei Wegen. Diese Wege führen noch zu Platzhaltern mit richtigem Titel; die echten Abläufe kommen in Welle 2. Darunter Einstellungen und „Über die App“.
5. **Einstellungen › Daten:** „Daten exportieren“ (JSON-Datei), „Daten importieren“ (führt zusammen, meldet was neu war) und „Alle Daten auf diesem Gerät löschen“ mit roter Bestätigung.
6. **Speicherfehler:** Schlägt das Speichern fehl, erscheint im Spiel „Dein Spiel konnte nicht gespeichert werden.“ mit „Erneut versuchen“, nur über der Punkteanzeige, nie über den Tasten. Von Hand ist das schwer auszulösen; die Prüfskripte unter `evidence/P1/scripts/` stellen es nach.
7. **Clubs und Turniere:** leere Zustände mit „Club gründen“ bzw. „Turnier erstellen“ und „Einladung öffnen“ (QR-Scanner mit Eingabefeld als Ausweg). Die Folgebildschirme sind noch Platzhalter.
8. **App-Links:** `/#p=…`, `/#club=…`, `/#tournament=…`, `/#watch=…`, `/#board=…`, `/#pair=…` öffnen den passenden Tab. Die Inhalte sind noch Platzhalter.

Gute Stellen für einen kritischen Blick: kleinste Größe (iPhone SE, auch quer), Deutsch und Englisch, hell und dunkel, Zurück-Gesten und Browser-Zurück, ein Spiel mitten in der Navigation.

## Was es noch nicht gibt

- Kein Profil, kein Abgleich, keine Geräte-Kopplung, keine Sicherung, keine Zahlungen, keine Live-Spiele (Welle 2).
- Keine Club-, Turnier- und Auszeichnungs-Bildschirme (Welle 3).
- Die App veröffentlicht noch nichts auf Relays; die dauerhafte Outbox kommt mit dem Abgleich.

## Was ohne Bildschirm fertig ist

| Bereich | Code | Nachweis |
| --- | --- | --- |
| Nostr-Schicht: einziger Zugang zu nostr-core, Relay-Client, geprüfte Signer (NIP-07, NIP-46 inklusive `nostrconnect://`, NIP-55), NIP-49, NIP-44/59 über Signer, strenge Prüfung von Zaps und Auszeichnungen | `lib/nostr/` | [CORE.md](evidence/P0.03/CORE.md), [P0.03](tasks/P0.03.md), [P3a.01](tasks/P3a.01.md) |
| BlueLine-Protokoll: Kinds 1180/31180/21180, Verträge je Familie, Rechte, Konflikte, Testvektoren | `lib/protocol/`, `docs/protocol/` | [P0.05](tasks/P0.05.md), [conflicts.md](../protocol/conflicts.md) |
| Turnierengine: K.-o., Doppel-K.-o., Jeder gegen jeden, Gruppen mit K.-o. | `lib/tournaments/` | [ENGINE.md](evidence/P6.01/ENGINE.md), [P6.01](tasks/P6.01.md) |
| Lokale Daten: Archiv, Spielerverzeichnis, Statistik, Export | `lib/storage/` | [P1.01](tasks/P1.01.md) bis [P1.03](tasks/P1.03.md) |
| App-Rahmen und Erweiterungsstellen für spätere Bereiche | `components/nav/`, `components/shell/`, `lib/shell/` | [SHELL.md](evidence/P0.02/SHELL.md), [DESIGN.md](evidence/P0.07/DESIGN.md) |

nostr-core wird nur in `lib/nostr/` und nur bei Bedarf geladen. Die Startseite für Gäste enthält keinen Nostr-Code.

## Wie geprüft wurde

Jede Spur wurde von einem eigenen Bearbeiter gebaut und von unabhängigen Reviewern geprüft, die den Code nicht geschrieben hatten. Die Turnierengine, die Nostr-Schicht, die lokalen Daten und der App-Rahmen hatten je zwei Review- und Korrekturrunden, das Protokoll drei. Danach wurde alles zusammengeführt und einmal vollständig geprüft (Ergebnisse in [STATUS.md](STATUS.md)).

Nicht geprüft: Safari, Firefox, echte Geräte und Kameras, installierte PWA, VoiceOver, öffentliche Relays, echte Signer-Apps, externe Kryptoprüfung.

## Deine Entscheidungen

Die offenen Produktfragen stehen gesammelt in [STATUS.md › Entscheidungen für den Nutzer](STATUS.md#entscheidungen-für-den-nutzer) (E1 bis E7).

## Rückmeldung

Am hilfreichsten pro Punkt: Bildschirm, Gerät oder Fenstergröße, Sprache, hell oder dunkel, was du erwartet hast und was passiert ist. Ein Bildschirmfoto hilft.
