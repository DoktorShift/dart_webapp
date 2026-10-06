# P7a.01 Voraussetzungen und Vergabe

**Status:** In Prüfung
**Paket:** P7a · **Planstelle:** [PLAN.md](../PLAN.md), Zeilen 424–449 (Auszeichnungen); Entscheidung 0001 F3; Entscheidung 0002 §6; [Familie badges](../../protocol/families/badges.md)

## Ziel

Persönliche Meilensteine entstehen aus dem Archiv dieses Geräts nach einem versionierten Katalog und erscheinen nach einem fertigen Spiel als kleine, wegklickbare Erfolgskarte. Gäste erreichen sie „Auf diesem Gerät“; ein Profil veröffentlicht sie erst mit „Im Profil zeigen“ als selbst vergebene Auszeichnung mit Nachweis. Club- und Turnierauszeichnungen vergibt der benannte Veranstalter von seinem Gerät, je Anlass genau einmal. Empfangene Vergaben werden vor dem Anzeigen streng geprüft.

## Produktregeln und Abnahmekriterien

- Betroffene Kriterien: A23 (Fassung aus Entscheidung 0001), A24 (Teil).
- Kein BlueLine-Ausstellerschlüssel (Entscheidung 0001 F3): Aussteller ist der Veranstalter oder, als „Selbst erreicht“ gekennzeichnet, der Spieler selbst.
- Nur vollständige Spieldaten: importierte 1.0.0-Summen zählen für Spiele und Siege, nie für Meilensteine, die Würfe brauchen.
- Die Karte unterbricht das Spiel nie, ist eine Zeile auf dem Ergebnis, lässt sich für dieses Spiel wegklicken und beachtet Reduce Motion. Nichts wird von allein veröffentlicht; ein Gast sieht kein Profilangebot (das steht als „Deine Ergebnisse mitnehmen“ schon im Ergebnis).
- Darts-Night-Test (Designregeln): ein Tipp zeigt die Auszeichnungen, ein Knopf zeigt sie im Profil; keine Protokollwörter außerhalb von „Erweitert“.

## Umfang und Stand

| Teil | Ort |
| --- | --- |
| Versionierter Katalog: 15 persönliche Meilensteine (erster Sieg, 10/50/100 Spiele, erste 100+/140+/180, Finish ab 100, perfektes Leg, Schnitt 40/60/80, Cricket 3 Marks pro Runde und neun Marks, Clock in 30) mit Regel, Datenbasis und Version; Veranstalterauszeichnungen (Turniersieg, Finalist, dabei, Saisonsieg, regelmäßig dabei); Anerkennung | `lib/badges/catalog.ts` |
| Auswertung aus dem Archiv in Spielreihenfolge, Fortschritt („7 von 10 Spielen“), erneute Bewertung nach Korrektur (`holdsIn`) | `lib/badges/milestones.ts` |
| Nachweis `badge.evidence` (Kind 1180): versionierte Bedingung, Spiel-ID, Datum, Spielart, Wert; nie Gegner oder andere Spiele | `lib/protocol/badges.ts`, [badges.md](../../protocol/families/badges.md), Vektor `self-earned` |
| Selbstvergabe: Definition (30009, einmal je Regelversion), Nachweis, Vergabe (8, Anlass `once`); ein zweiter Versuch wiederholt keinen Schritt | `lib/badges/self-award.ts`, `lib/badges/actions.ts` (`showMilestone`) |
| Prüfung empfangener Vergaben: Signaturen, Vergabe-Autor = Definitionsautor, Empfänger, BlueLine-Regeln, Club-/Turnierberechtigung über `registerIssuerCheck` (bis die Clubs- und Turnierspur sie registriert, werden solche Vergaben nicht gezeigt), NIP-09-Löschungen, Doppelte je Anlass einmal, aufgehobener Nachweis markiert | `lib/badges/awards.ts` |
| Veranstaltervergabe: wer das Turnier beendet oder die Saison geschlossen hat, vergibt Sieger, Finalist (bei Finale) und Teilnahme beziehungsweise Saisonsieger und „regelmäßig dabei“ (ab `minGames`); Nachweis = Abschlussdatensatz, Anlass = Turnier- oder Saison-ID; vor dem Senden werden Gerät und Relays gelesen und nur Fehlendes gesendet; nach Korrektur werden unpassende Vergaben per Löschanfrage zurückgenommen; Anerkennung mit eigenem Text als Nachweis | `lib/badges/organizer.ts` (`issueAwards`, `currentPlan`, `withdrawAwards`, `giveRecognition`) – Aufruf durch die Clubs- und Turnierspur aus ihren Abschlussansichten |
| Erfolgskarte auf dem Ergebnis (`result.actions`), Blatt mit den Auszeichnungen je Spieler, „Im Profil zeigen“ für das angemeldete Profil | `components/badges/earned-card.tsx` |
| Ablage: eigene ersetzbare Events als Profil-Events (`own:*`), alles andere unter `own:badge:*`; Abruf einmal je Seitenaufruf; alles geht mit dem Profil beim Abmelden | `lib/badges/store.ts` |
| Texte: Titel im Startkatalog, alles Weitere mit den Bildschirmen; technische Begriffe nur unter `advanced` | `lib/i18n/features/badges.*` |

Integrationspunkte für die späteren Spuren (keine Attrappen):

- `registerIssuerCheck("club" | "tournament", { mayIssue, evidenceValid })` in `lib/badges/awards.ts`: die Clubs- und Turnierspur beantwortet aus ihrem Zustand (`mayIssueClubBadge`, `mayIssueTournamentBadge`), wer vergeben darf und ob ein Nachweis noch gilt.
- `issueAwards(issuer, occasion, texts)` mit `BadgeOccasion` (Plätze, Abschlussdatensatz, Finale, `minGames`) und `organizerBadgeTexts` aus `lib/i18n/features/badges.screens.*` (`tx.organizer[badge](name)`).
- `push(BADGE_SCREENS.badge, { id, name })` öffnet eine Auszeichnung von überall (`components/badges/screens.ts`).

## Fehlerfälle

Importierte Summe mit Schnitt 83,5 ohne Würfe löst keinen Schnitt-Meilenstein aus; Korrektur der 180 zu 177 nimmt den Meilenstein zurück und gibt den Fortschritt 177; gefälschte Vergabe (fremder Autor), veränderter Empfänger, fremde Definition unter gleichem `d`, Vergabe an jemand anderen, Löschanfrage eines Dritten; doppelte Vergabe (neu signiert); Veranstalter, der das Turnier nicht beendet hat; kein antwortendes Relay (nichts wird signiert); abgelehnte Unterschrift.

## Abschlussnachweise

| Nachweis | Ergebnis |
| --- | --- |
| `tests/badges-milestones.test.ts` (Katalogregeln mit von Hand gerechneten Fällen aus `storage-fixtures.ts`, importierte Summen, Korrektur) | 7 von 7 |
| `tests/badges-awards.test.ts` (Berechtigung, Fälschungen, Doppelte, NIP-09, aufgehobener Nachweis, fremde App, Altformat, Anordnen) | 8 von 8 |
| `tests/badges-profile.test.ts` (Selbstvergabe über zwei Relays im Speicher: vier Events, nichts über Ben, zweiter Versuch sendet nichts, offline signiert nichts, Korrektur und Löschanfrage, zweites Gerät) | 5 von 5 |
| `tests/badges-organizer.test.ts` (Plan von Hand, keine Doppelvergabe bei wiederholtem Abschluss, nur wer beendet hat, Korrektur mit Rücknahme, Anerkennung) | 5 von 5 |
| `tests/protocol-vectors.test.ts`, `protocol-records`, `protocol-docs` (Nachweisdatensatz, Vektor `self-earned`) | in `npm test` |
| `tests/relay/badges.test.ts` gegen zwei `nak serve` (Ports 20085/20086): vier Events, `nak verify`, zweites Gerät liest zurück, Veranstalter je Spieler und Anlass einmal, `nak req` nach Empfänger | 2 von 2 |
| Browser [scripts/badges-checks.mjs](../evidence/P7a.01/scripts/badges-checks.mjs) (Chromium, Produktionsbuild mit zwei lokalen Relays, Port 3323): Karte als Gast bei 320×548, 390×844, 568×320, 844×390 ohne Ellipse, Überlauf oder Socket; Blatt ohne Profilaktion; Ausblenden hält nach Neuladen; Gast-Zeile und -Ansicht; mit Profil: „Im Profil zeigen“ aus dem Blatt, 9 Vergaben, Definitionen und Nachweise plus Liste auf den Relays, `nak verify`, nichts über Ben; Profilkarte mit drei Chips; Liste, Detail, Ausblenden und Zeigen, Erweitert, Anordnen; Englisch dunkel | 41 von 41 (zweiter Lauf; erster Lauf 40 von 41, Befund Zeile zählte Meilensteine mit ihren eigenen Vergaben doppelt, behoben) |
| Bilder | [screens/](../evidence/P7a.01/screens/) |

Gemessen (Laborwerte unter Parallellast): „Im Profil zeigen“ für neun Meilensteine mit lokalem Schlüssel 209 ms bis zur Bestätigung; der Versand wartet nicht auf Relays.

Nicht nachgewiesen: Safari, Firefox, echte Geräte, VoiceOver; externe Signer (jede Selbstvergabe fragt den Signer je Event); Club- und Turniervergaben in der Oberfläche (die Spuren kommen nach dieser); öffentliche Relays.

## Offener Befund an die Shell (Ergebnisbildschirm)

Auf Telefonen quer passt im Ergebnis nur etwa eine Zeile für Bereichsstücke (`result.actions`, so dokumentiert). Gemessen am Produktionsbuild (Unterkante der Kleinaktion „Rangliste“ gegen die Bildhöhe): 568×320 ohne Stück 329, nur „Deine Ergebnisse mitnehmen“ 351, mit Erfolgskarte 377; 844×390: 362 / 384 / 410; 667×375: 355 / 377 / 403. Die Erfolgskarte hält die 44 pt (xshort 44 pt, Symbol ausgeblendet) und wird nicht weiter verkleinert; die Spalte des Ergebnisses braucht quer bei mehreren Stücken eine Lösung der Shell (Bild [landscape-844x390-both.jpg](../evidence/P7a.01/screens/landscape-844x390-both.jpg)).

## Nächster Schritt

Review; die Clubs- und Turnierspur registriert `registerIssuerCheck` und ruft `issueAwards` aus ihren Abschlussansichten.
