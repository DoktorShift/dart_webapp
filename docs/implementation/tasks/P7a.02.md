# P7a.02 Profil und Austausch

**Status:** In Prüfung (Korrekturrunde 1 eingearbeitet)
**Paket:** P7a · **Planstelle:** [PLAN.md](../PLAN.md), Zeilen 329, 424–449; NIP-58 (30009, 8, 10008, Altformat 30008); Entscheidung 0002 §6

## Ziel

Die Auszeichnungen eines Profils lassen sich ansehen, annehmen, im Profil zeigen, anordnen und ausblenden. Die Profilauswahl (Kind 10008) gehört allen Apps des Profils: Einträge und Reihenfolge anderer Apps bleiben, das Altformat (30008 `profile_badges`) wird gelesen und beim ersten Schreiben übernommen. Auszeichnungen, Auswahl und Nachweise gehören zur Datendatei und kommen auf einem neuen Gerät von den Relays.

## Produktregeln und Abnahmekriterien

- Betroffene Kriterien: A24, A23 (Anzeige), A20 (Export-Teil).
- Höchstens drei Auszeichnungen auf der Profilkarte, „Alle ansehen“ über die Zeile im Profil.
- Die Auswahl wird nur nach Lesen und Zusammenführen geändert (`changeBase` der Profilspur); ohne antwortendes Relay und ohne bekannten Stand wird nichts geändert.
- „Ausblenden“ macht eine veröffentlichte Vergabe nicht privat; das steht im Detail.
- Korrigierte Ergebnisse: die Vergabe wird markiert, der Aussteller kann eine Löschanfrage (NIP-09) senden; kein versprochener Widerruf.
- Keine Protokollwörter außerhalb von „Erweitert“ (Textprüfung `tests/shell-texts.test.ts` deckt die Badge-Texte mit ab).

## Umfang und Stand

| Teil | Ort |
| --- | --- |
| Profilauswahl lesen (10008 vor 30008), Einträge zeigen/ausblenden/anordnen unter Erhalt aller fremden Tags und Reihenfolgen; Altformat wird übernommen, das alte Event bleibt für Apps, die es noch lesen | `lib/badges/selection.ts`, `lib/protocol/badges.ts` (`readProfileBadges` hält die Tag-Reihenfolge) |
| Auswahl als eigenes Event des Profils (`OWN.profileBadges`, `OWN.legacyProfileBadges`), Änderung auf `changeBase`, Versand mit `submitOwn` ohne Warten | `lib/profile/own-events.ts` (kleine Ergänzung der Profilspur), `lib/badges/store.ts` |
| Profilzeile mit Anzahl und „n neu“ für ungesehene Vergaben bürgender Aussteller (Fremde zählen nie); Profilkarte mit drei Chips (eigenes und fremdes Profil, fremde geprüft über die Relays), eigene Chips mit „Ergebnis korrigiert“, wenn die Vergabe nicht mehr gilt; ein Chip nennt den Besitzer der Vergabe, damit auch ein angemeldetes Profil fremde Chips öffnet | `components/badges/profile-row.tsx`, `profile-line.tsx` |
| Bildschirm Auszeichnungen: Im Profil (mit Anordnen; korrigierte Vergaben grau mit „Ergebnis korrigiert“), Erreicht (auf diesem Gerät, nicht im Profil, erhalten, Ergebnis korrigiert), Erreichbar mit Fortschritt, eine stille Zeile „Weitere erhaltene Auszeichnungen“ für Aussteller, die das Profil noch nicht kennt; Gast je Spieler, importierte mit „Importiert“ | `components/badges/badges-screen.tsx`, `rows.tsx`, `more-screen.tsx` |
| Detail: Bedeutung, Bedingung, Fortschritt (erreichbar), Erreicht/Vergeben am, Ergebnis (öffnet das Spiel, sonst „auf einem anderen Gerät“), Aussteller (Du · Selbst erreicht, sonst Profil), Sichtbarkeit mit einer Hauptaktion und ehrlicher Fußzeile (Spieldaten nur beim ersten Zeigen; „schon veröffentlicht“ danach), Korrektur mit Löschanfrage nach Rückfrage (der Kopf bleibt, die Bestätigung steht an der Stelle der Zeile), Erweitert (Aussteller-Kennung, Event-ID, Definition); fremde Vergabe nach Besitzer, mit Bedingung und erneutem Laden nach Neuladen | `components/badges/badge-screen.tsx` |
| Anordnen mit großen Tasten, Name mit FitText (unter 360 pt ohne Positionsnummer), eine Unterschrift beim Speichern | `components/badges/arrange-screen.tsx` |
| Datendatei: Abschnitt `badges` mit allen Badge-Events des Geräts, Rücknahme mit Signaturprüfung (nostr-core wird erst bei vorhandenen Events geladen), doppelt importieren ändert nichts; generischer Abschnittsmechanismus | `lib/badges/export.ts`, `lib/storage/export-sections.ts`, `lib/storage/data.ts` (kleine Ergänzung der Speicherspur) |
| Gerätewechsel ohne Backend: Vergaben, Definitionen, Nachweise und Liste kommen vom Relay (`fetchBadges`, `lookupOwnEvents`) | `lib/badges/store.ts` |

## Abschlussnachweise

| Nachweis | Ergebnis |
| --- | --- |
| `tests/badges-awards.test.ts`: Altformat mit Relay-Hinweisen, unvollständigem Paar, Badge-Set und unbekanntem Tag wird als 10008 geschrieben, alles bleibt; Ausblenden lässt Fremdes stehen; Anordnen bewegt nur die genannten | bestanden |
| `tests/badges-profile.test.ts`: Altformat auf dem Relay wird mit allem übernommen; Löschanfrage nimmt die Vergabe aus der Liste; zweites Gerät findet alles einmal | bestanden |
| `tests/badges-export.test.ts`: Datei hin und zurück, gefälschte/veränderte Events bleiben draußen, doppelter Import | 2 von 2 |
| `tests/relay/badges.test.ts`: der Export-Abschnitt besteht `nak verify` (unabhängiger Leser) | bestanden |
| `tests/nostr-lists.test.ts`, `tests/protocol-records.test.ts` (Profilauswahl in `lib/nostr` und `lib/protocol`) | in `npm test` |
| Browser [scripts/badges-checks.mjs](../evidence/P7a.01/scripts/badges-checks.mjs): Chips, Liste, Detail, Ausblenden (Liste ohne die Vergabe, Vergabe bleibt), Zeigen, Anordnen (neue Reihenfolge veröffentlicht), Erweitert erst nach Öffnen, fremde Vergabe hinter der stillen Zeile und Bürgen durch Zeigen, Korrektur in Karte und Liste, Chip auf fremder Karte als angemeldetes Profil, Englisch dunkel | siehe P7a.01 (66 von 66) |

Nicht nachgewiesen: fremde Vergaben anderer Apps auf öffentlichen Relays; Badge-Sets (30008 mit anderem `d`) werden nicht angezeigt, nur erhalten; Bilder von Auszeichnungen nur als https-Rasterbild ohne Referrer (keine eigenen Bilder: BlueLine-Meilensteine haben keine URL, Entscheidung 0001 F5/NB-22).

## Nächster Schritt

Review; dann die Abgleich-Spur (Outbox hinter `lib/sync/publish.ts`) und die Spuren Clubs und Turniere.
