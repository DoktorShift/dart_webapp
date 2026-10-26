# Spielverlauf als Datei

Profil › Konto › Spielverlauf gibt die Spiele dieses Geräts als Datei heraus: die Spiele des Profils gegen andere und seine Trainings. Nichts verlässt das Gerät ohne diesen Tipp; die Datei geht über das Teilen-Blatt (Dateien, Mail) oder als Download. Code: [`lib/profile/export.ts`](../../lib/profile/export.ts), Test: [`tests/profile-export.test.ts`](../../tests/profile-export.test.ts).

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

Keine Schlüssel, keine Zahlungen, keine Club- oder Turnierdaten, keine Profile anderer über ihren Namen im Spiel hinaus. Die Datei ist ein Export, kein Import: Spiele anderer Apps kommen erst mit dem Import aus anderen Dart-Apps herein (Vorschlag [`docs/ux/profil-rangliste-vorschlag.html`](../ux/profil-rangliste-vorschlag.html), M16, Stufe 3).
