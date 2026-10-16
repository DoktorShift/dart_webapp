# P7a.01 Voraussetzungen und Vergabe

**Status:** In Prüfung (Korrekturrunde 1 eingearbeitet)
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
| Versionierter Katalog: 15 persönliche Meilensteine (erster Sieg, 10/50/100 Spiele, erste 100+/140+/180, Finish ab 100, perfektes Leg, Schnitt 40/60/80, Cricket 3 Marks pro Runde und neun Marks, Clock in 30) mit Regel, Datenbasis, Version und Rang (seltenste zuerst in der Profilliste); Veranstalterauszeichnungen (Turniersieg, Finalist, dabei, Saisonsieg, regelmäßig dabei); Anerkennung | `lib/badges/catalog.ts` |
| Auswertung aus dem Archiv in Spielreihenfolge, Fortschritt („7 von 10 Spielen“), erneute Bewertung nach Korrektur (`holdsIn`); „Neun Marks“ zählt die Marks, die die Engine je Aufnahme anrechnet (Treffer auf von allen geschlossene Zahlen zählen nicht) | `lib/badges/milestones.ts` |
| Nachweis `badge.evidence` (Kind 1180): versionierte Bedingung, Spiel-ID, Datum, Spielart, Wert; nie Gegner oder andere Spiele | `lib/protocol/badges.ts`, [badges.md](../../protocol/families/badges.md), Vektor `self-earned` |
| Selbstvergabe: Definition (30009, einmal je Regelversion), Nachweis, Vergabe (8, Anlass `once`); mehrere Meilensteine auf einmal mit genau einer Profilliste (`showMilestones`); ein zweiter Versuch wiederholt keinen Schritt; eine Vergabe, deren Nachweis ein anderes (korrigiertes) Spiel nennt, wird ersetzt: eine Löschanfrage für sie und ihren Nachweis, neuer Nachweis und neue Vergabe | `lib/badges/self-award.ts`, `lib/badges/actions.ts` (`showMilestones`, `showMilestone`) |
| Prüfung empfangener Vergaben: Signaturen, Vergabe-Autor = Definitionsautor, Empfänger, BlueLine-Regeln, Club-/Turnierberechtigung über `registerIssuerCheck` (bis die Clubs- und Turnierspur sie registriert, werden solche Vergaben nicht gezeigt), NIP-09-Löschungen, Doppelte je Anlass einmal, aufgehobener Nachweis markiert. Bürgende Aussteller (`splitReceived`): das Profil selbst, Club/Turnier mit bestätigter Berechtigung, und wer eine Auszeichnung gab, die das Profil schon zeigt; nur deren Vergaben erscheinen unter „Erhalten“ und zählen als „neu“, alle anderen warten hinter einer Zeile „Weitere erhaltene Auszeichnungen“ | `lib/badges/awards.ts` |
| Veranstaltervergabe: wer das Turnier beendet oder die Saison geschlossen hat, vergibt Sieger, Finalist (bei Finale) und Teilnahme beziehungsweise Saisonsieger und „regelmäßig dabei“ (ab `minGames`); Nachweis = Abschlussdatensatz, Anlass = Turnier- oder Saison-ID; vor dem Senden werden Gerät und Relays gelesen und nur Fehlendes gesendet; nach Korrektur werden unpassende Vergaben per Löschanfrage zurückgenommen; Anerkennung mit eigenem Text als Nachweis | `lib/badges/organizer.ts` (`issueAwards`, `currentPlan`, `withdrawAwards`, `giveRecognition`) – Aufruf durch die Clubs- und Turnierspur aus ihren Abschlussansichten |
| Erfolgskarte auf dem Ergebnis (`result.actions`): 48 pt, auf kurzen Bildschirmen (`short`) 44 pt ohne Symbol, quer auf dem Telefon (`xshort`) eine kurze Zeile ohne Hintergrund, Symbol und Ausblenden-Taste (Vertrag der Live-Spur für die Leiste des Ergebnisses); Blatt mit den Auszeichnungen je Spieler, „Im Profil zeigen“ für das angemeldete Profil als eine Aktion für alle, Bestätigung oder Fehler an der Stelle der Taste außerhalb der Liste; schon gezeigte Meilensteine werden nicht erneut angeboten („Schon in deinem Profil.“) | `components/badges/earned-card.tsx` |
| Ablage: eigene ersetzbare Events als Profil-Events (`own:*`), alles andere unter `own:badge:*`; Abruf einmal je Seitenaufruf, ohne Profil nie; von Fremden nur geprüfte Vergaben mit ihren Definitionen, höchstens die neuesten 50 (`FOREIGN_AWARDS_KEPT`, `limit` in der Anfrage); alles geht mit dem Profil beim Abmelden | `lib/badges/store.ts` |
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
| `tests/badges-milestones.test.ts` (Katalogregeln mit von Hand gerechneten Fällen aus `storage-fixtures.ts`, importierte Summen, Korrektur, Neun Marks nach angerechneten Marks) | 8 von 8 |
| `tests/badges-awards.test.ts` (Berechtigung, Fälschungen, Doppelte, NIP-09, aufgehobener Nachweis, fremde App, bürgende Aussteller, Altformat, Anordnen) | 9 von 9 |
| `tests/badges-profile.test.ts` (Selbstvergabe über zwei Relays im Speicher: vier Events, nichts über Ben, zweiter Versuch sendet nichts, offline signiert nichts, Korrektur und Löschanfrage, zweites Gerät, höchstens 50 fremde Vergaben mit ihren Definitionen, korrigiert und erneut erreicht ersetzt die Vergabe, neun auf einmal mit einer Liste seltenste zuerst) | 8 von 8 |
| `tests/badges-organizer.test.ts` (Plan von Hand, keine Doppelvergabe bei wiederholtem Abschluss, nur wer beendet hat, Korrektur mit Rücknahme, Anerkennung) | 5 von 5 |
| `tests/protocol-vectors.test.ts`, `protocol-records`, `protocol-docs` (Nachweisdatensatz, Vektor `self-earned`) | in `npm test` |
| `tests/relay/badges.test.ts` gegen zwei `nak serve` (Ports 20685/20686): vier Events, `nak verify`, zweites Gerät liest zurück, Veranstalter je Spieler und Anlass einmal, `nak req` nach Empfänger | 2 von 2 |
| Browser [scripts/badges-checks.mjs](../evidence/P7a.01/scripts/badges-checks.mjs) (Chromium, Produktionsbuild mit zwei lokalen Relays, Port 3323): Karte als Gast bei 320×548 (44 pt ohne Symbol), 390×844 (48 pt), 568×320 und 844×390 (Leistenzeile ohne Ausblenden, Symbol, Hintergrund) ohne Ellipse, Überlauf oder Socket; Blatt ohne Profilaktion; Ausblenden hält nach Neuladen; Gast-Zeile, -Ansicht und -Detail ohne Socket; mit Profil: „Im Profil zeigen“ aus dem Blatt mit Bestätigung an der Stelle der Taste (390×844 und 320×548 im Bild ohne Scrollen), erneut geöffnetes Blatt ohne Aktion, 9 Vergaben, Definitionen und Nachweise plus genau eine Liste seltenste zuerst auf den Relays, `nak verify`, nichts über Ben; Profilkarte mit drei Chips (Perfektes Leg zuerst); Liste, Fortschritt im Detail eines erreichbaren Meilensteins, Detail, Ausblenden (Fußzeile „schon veröffentlicht“) und Zeigen, Erweitert, Anordnen (auch 320×548 ohne Wortbruch); Vergabe eines Fremden per `nak`: eine stille Zeile, kein „neu“, nach „Im Profil zeigen“ bürgt das Profil für den Aussteller; Korrektur per Rückgängig: Blatt „Schon in deinem Profil.“, Chip und Liste „Ergebnis korrigiert“, Löschanfrage behält Kopf und Zeile; zweites angemeldetes Profil öffnet einen Chip auf Annas Karte; Englisch dunkel | 66 von 66 (dritter Lauf; Lauf 1 brach an einem Skriptfehler ab, Lauf 2 hatte zwei falsche Erwartungen im Skript, keine App-Befunde) |
| Bilder | [screens/](../evidence/P7a.01/screens/) (`fix1-*` aus dieser Runde) |
| Browser nach der Zusammenführung (16. Oktober 2026): die Karte ist die gemeinsame `ResultRow` (`components/shell/result-row.tsx`, Ton „warning“, `placement` aus den Slot-Eigenschaften, Ausblenden mit `useDismissedFor`). Das Gastergebnis trägt mit „Deine Ergebnisse mitnehmen“ zwei Teile: 320×548 zeigt das Angebot und „+1“, 568×320 und 844×390 die Zahl 2 in der Kopfzeile; „Mehr zum Ergebnis“ listet die Karte als 44-pt-Zeile ohne Symbol mit Ausblenden und bleibt unter ihrem Blatt bis „Fertig“ offen; nach „Später“ steht die Karte allein als Leistenzeile (blau, ohne Ausblenden, Symbol, Hintergrund); 390×844 die volle Zeile mit 48 pt; mit Profil auf 320×548 hinter „+1“. Produktionsbuild auf Port 3341, Relays 20680–20682 | 73 von 73 |

Gemessen (Laborwerte unter Parallellast): „Im Profil zeigen“ für neun Meilensteine mit lokalem Schlüssel 108–120 ms bis zur Bestätigung; der Versand wartet nicht auf Relays. 28 Unterschriften für neun Meilensteine (je Definition, Nachweis, Vergabe, plus eine Liste; vorher 36).

Nicht nachgewiesen: Safari, Firefox, echte Geräte, VoiceOver; externe Signer (jede Selbstvergabe fragt den Signer je Event); Club- und Turniervergaben in der Oberfläche (die Spuren kommen nach dieser); öffentliche Relays; die Obergrenze von 50 fremden Vergaben nur im Test, nicht im Browser.

## Korrekturrunde 1 (Review und HIG-Review)

- Gastpfad ohne Verbindung: `useOwnBadges(null)` liest und fragt nichts, `lookupBadges("")` öffnet keine Verbindung; nachgewiesen im Browser (Gast-Detail ohne Socket).
- Chip auf fremder Karte für angemeldete Profile: die Ansicht richtet sich nach dem Besitzer der Vergabe (`params.pubkey`), nicht nach der Anmeldung; die fremde Ansicht lädt die Liste nach einem Neuladen erneut und zeigt die Bedingung eines BlueLine-Meilensteins.
- Unbekannte Aussteller: Entscheidung der Koordination, siehe `splitReceived`; Ablage nur geprüft und begrenzt.
- Ersetzte Vergabe nach Korrektur und `showMilestones` mit einer Liste: siehe oben, Test „korrigiert, dann erneut erreicht“.
- Ergebnisstück: die Karte folgt dem Vertrag der Live-Spur (`short` 44 pt ohne Symbol, `xshort` Leistenzeile); die Regel für mehrere Stücke und die gemeinsame Zeile setzt die Koordination bei der Integration um (`components/game/match-result.tsx` und die Registry blieben unverändert).
- Kleinere Punkte: Export lädt nostr-core erst bei vorhandenen Events; Fußzeile nennt die veröffentlichte Zahl; tote Texte entfernt; Anordnen mit FitText und ohne Positionsnummer unter 360 pt; Löschanfrage behält den Kopf; Fortschrittszeile im Detail; importierte Gastspieler mit „Importiert“; Rang im Katalog.

## Nächster Schritt

Review; die Clubs- und Turnierspur registriert `registerIssuerCheck` und ruft `issueAwards` aus ihren Abschlussansichten; die Koordination setzt die Regel für mehrere Ergebnisstücke bei der Integration.
