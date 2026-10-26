# Spielverlauf als Datei

Profil › Konto › Spielverlauf gibt die Spiele dieses Geräts als Datei heraus und nimmt Spiele aus einer Datei auf (unten): die Spiele des Profils gegen andere und seine Trainings. Nichts verlässt das Gerät ohne diesen Tipp; die Datei geht über das Teilen-Blatt (Dateien, Mail) oder als Download. Code: [`lib/profile/export.ts`](../../lib/profile/export.ts), Test: [`tests/profile-export.test.ts`](../../tests/profile-export.test.ts).

## CSV

Für Tabellenkalkulationen und andere Dart-Apps. Trennzeichen `;` (Semikolon, wie deutsche Tabellenkalkulationen es erwarten), Zeilenende CRLF, UTF-8. Felder mit `;`, `"` oder Zeilenumbruch stehen in Anführungszeichen, `"` darin verdoppelt. Neuestes Spiel zuerst. Zahlen mit Punkt, Datum nach ISO 8601 (UTC): eine Datei zuerst für Maschinen, die jede Tabelle trotzdem liest.

| Spalte | Inhalt |
| --- | --- |
| Datum | Ende des Spiels, ISO 8601, etwa `2026-10-26T19:41:12.000Z` |
| Spielart | Name der Spielart, wie die App sie nennt (`501`, `Cricket`, `Around the Clock`) |
| Spieler | Name des Profils im Spiel |
| Gegner | Namen der anderen Plätze, durch `, ` getrennt; leer im Training |
| Ergebnis | `Gewonnen`, `Verloren` oder `Training` (Spiel allein; zählt nie in Siege oder Ranglisten) |
| Darts | Geworfene Darts des Spielers |
| Punkte | Erzielte Punkte (nur X01, sonst leer) |
| Ø 3 Darts | Punkte pro drei Darts mit zwei Nachkommastellen (nur X01, sonst leer) |
| Quelle | `BlueLine` für hier gespielte Spiele, `Importiert` für Ergebnisse der früheren Version |

Die Spaltennamen folgen der Sprache der App (Deutsch oder Englisch), die Werte in `Ergebnis` und `Quelle` ebenso.

## JSON

Für Sicherungen und Werkzeuge, die die Spiele vollständig brauchen, mit allen Würfen, soweit vorhanden.

```json
{
  "format": "blueline-games",
  "version": 1,
  "exportedAt": "2026-10-26T18:00:00.000Z",
  "matches": [ /* ArchivedMatch, siehe lib/storage/archive.ts */ ]
}
```

`matches` sind die Spiele, wie dieses Gerät sie aufbewahrt (`ArchivedMatch`): Spielart, Plätze mit Namen, Darts, Punkten und Sieg, Zeiten, Quelle und, soweit vorhanden, der volle Spielstand mit allen Würfen. `version` steigt nur, wenn sich diese Form ändert.

## Was nicht in der Datei steht

Keine Schlüssel, keine Zahlungen, keine Club- oder Turnierdaten, keine Profile anderer über ihren Namen im Spiel hinaus, kein Trainingsziel.

## Import

Profil › Konto › Spielverlauf › Importieren liest drei Arten von Dateien (Code: [`lib/profile/import.ts`](../../lib/profile/import.ts), Test: [`tests/profile-import.test.ts`](../../tests/profile-import.test.ts)):

- die CSV von oben, in beiden Sprachen;
- das JSON von oben (`blueline-games`) und die Gerätedatei aus Einstellungen › Daten (`blueline-data`; nur die Spiele werden übernommen);
- eine Tabelle aus einer anderen App oder von Hand mit denselben Spalten. Erkannt werden die Spaltennamen `Datum`/`Date`, `Spielart`/`Game type`/`Game`/`Mode`, `Spieler`/`Player`/`Name`, `Gegner`/`Opponents`/`Opponent`, `Ergebnis`/`Result`/`Won`, `Darts`, `Punkte`/`Points`, ohne Rücksicht auf Groß- und Kleinschreibung; Trennzeichen `;`, `,` oder Tabulator. Pflicht sind Datum, Spielart, Spieler und Darts, bei Zeilen mit Gegner auch das Ergebnis. Datum als ISO 8601, `26.10.2026 19:41`, `2026-10-26 19:41` oder `2026-10-26`; Spielart `301`/`501`/`701` (auch „501 Double Out“), `Cricket`, `Around the Clock`; Ergebnis `Gewonnen`/`Won`/`W`/`1` oder `Verloren`/`Lost`/`L`/`0`; eine Zeile ohne Gegner ist ein Training. Fehlen bei X01 die Punkte, zählt das Spiel (gespielt, gewonnen), sein Durchschnitt bleibt unbekannt. Zeilen, die das nicht erfüllen, bleiben weg und werden gezählt.

Vor dem Import zeigt das Blatt, was in der Datei steht (Spiele nach Art, Zeitraum, Namen, nicht lesbare und zusammengefasste Zeilen), und fragt, welcher Name der eigene ist; der eigene Name steht vorgewählt, sonst ist nichts gewählt und „Importieren“ wartet auf die Wahl. Dieser Name zählt dann zum Profil (wie die Zuordnung früherer Ergebnisse in der Rangliste, `importedNames` im Spielerverzeichnis); alle anderen Namen stehen als importierte Spiele in der Rangliste und lassen sich dort zuordnen. Importierte Spiele tragen die Quelle `imported-file`, kennen nur Namen und Summen (Ø 3 Darts ja, First 9 und Checkout nein) und bekommen eine Kennung aus ihren Angaben, sodass dieselbe Zeile beim zweiten Import als „schon da“ erkannt wird; zwei Zeilen mit denselben Angaben (zwei Trainings an einem Tag ohne Uhrzeit, gleiche Darts und Punkte) sind ein Spiel. Ein Spiel, das schon hier ist, weil es hier gespielt oder von einem eigenen Gerät übernommen wurde, wird an Zeit, Spielart und Namen erkannt und nicht noch einmal angelegt. Spiele aus den JSON-Dateien behalten ihre Kennung und ihren vollen Spielstand; Spieler-Kennungen des anderen Geräts gelten hier nichts, solche Plätze zählen über ihren Namen wie importierte Ergebnisse.

Danach sagt das Blatt, wie viele Spiele neu sind und wie viele schon da waren, führt mit einem Tipp zu Statistik, Training oder Rangliste und bietet „Import rückgängig machen“: Das entfernt genau die eben angelegten Spiele (`removeMatches`) und die eben gesetzte Zuordnung wieder. Dateien über 50 MB und Tabellen mit den richtigen Spalten, aber ohne Zeilen, werden als solche benannt.

Keine App-spezifischen Adapter: DartCounter und Autodarts bieten keinen Export, das CSV-Format von n01 ist nicht dokumentiert; wer aus einer dieser Apps kommt, bringt die Tabelle in die Spalten oben. Die App verspricht keinen Import, den es nicht gibt (Entscheidung E26 im Vorschlag).
