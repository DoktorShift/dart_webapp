# 0003 Spielerzuordnungen erhalten und synchronisieren

**Status:** Angenommen als Produktentscheidung; noch nicht vollständig implementiert. 28. Oktober 2026.

## Kontext

Auf einem gemeinsam genutzten Gerät kann dieselbe Person als Gast und mit Profil erscheinen. Die derzeitige, ausdrücklich bestätigte und widerrufbare Zuordnung liegt ausschließlich in `leaderboard.player-links` auf dem Gerät. Weder die private Profil-Synchronisierung noch der Geräte-Datenexport übertragen sie. Nach einem Gerätewechsel kann die Rangliste deshalb wieder zwei Zeilen zeigen.

## Entscheidung

1. Eine bestätigte Zuordnung gehört zur privaten Sicht der Person, die sie vornimmt. Bei angemeldetem Profil wird sie über dessen Ende-zu-Ende-verschlüsselte private Daten mit dessen Geräten synchronisiert. Sie verändert weder das öffentliche Profil der anderen Person noch deren Daten.
2. Ohne Profil bleibt die Zuordnung lokal nutzbar. Der vollständige Geräte-Datenexport muss Zuordnungen samt den zugehörigen Spielerkennungen enthalten und sie beim Wiederherstellen geprüft übernehmen; ein CSV-Ergebnisexport ist keine Sicherung der Zuordnung.
3. Eine Profil-Sicherungsdatei sichert den Zugang; die private Historie und Zuordnungen kommen über die private Synchronisierung zurück, soweit verfügbar. Die Oberfläche muss ein unvollständiges oder noch ausstehendes Wiederherstellen erkennbar machen. Für eine offline verfügbare vollständige Datenkopie bleibt der Geräte-Datenexport der Weg.
4. Ein gleicher Name ist ein Hinweis, kein Identitätsbeweis. Die Zuordnung bleibt ausdrücklich zu bestätigen und einzeln rückgängig zu machen. Vorhandene und später eintretende Widersprüche – insbesondere zwei Plätze im selben Spiel – dürfen keine Personen zusammenzählen.
5. Zuordnen und Spielen müssen auch offline funktionieren. Lokale Änderungen und deren Rücknahme dürfen beim späteren Synchronisieren oder gleichzeitigem Ändern auf zwei Geräten nicht verloren gehen oder eine bereits gelöste Zuordnung unbemerkt wiederherstellen. Bis zur Zustellung bleibt der Status nachvollziehbar; keine öffentliche Veröffentlichung.
6. Vorhandene lokale Zuordnungen werden nach Anmeldung nicht ohne klare Besitz- und Konfliktprüfung einem fremden Profil zugerechnet. Ein gemeinsam genutztes Gerät darf Ansichten verschiedener Profile nicht vermischen. Gäste und Spiele anderer Personen werden nicht allein aufgrund der Zuordnung in die private Historie übernommen.

## Grundlage

- [Apple: Kontakte verknüpfen](https://support.apple.com/en-ie/guide/iphone/iph2ab28320d/ios): getrennte Kontaktkarten können als eine Person erscheinen, ohne ihre Ursprungsdaten zu verschmelzen. [iCloud-Kontakte synchronisieren](https://support.apple.com/guide/iphone/sync-contacts-across-devices-iphdfe5a59f5/27/ios/27) hält Account-Kontakte auf angemeldeten Geräten aktuell.
- [Google Kontakte: Duplikate zusammenführen](https://support.google.com/contacts/answer/7078226?co=GENIE.Platform%3DDesktop&hl=en): Zusammenführen ist mit Rückweg vorgesehen; getrennte Konten haben Grenzen.
- [DartConnect: How To](https://www.dartconnect.com/how-to/): verifizierte Adressen verbinden Spieler und Konten mit ihren Ergebnissen; Kontozusammenführung verlangt Bestätigung. Das ist ein Vergleich für dauerhafte Zuordnung, keine Aussage, dass BlueLine Identitäten per E-Mail führen soll.
- [DartCounter FAQ](https://dartcounter.net/faq): grundlegendes Zählen geht ohne Konto; das Konto dient unter anderem dem Speichern und den Statistiken.

## Folgen und Abnahme

Diese Entscheidung ändert das laufende Verhalten noch nicht. Umsetzung braucht ein privates, profilgebundenes Datenformat mit stabilen Kennungen und Widerrufen; eine verlustfreie Konfliktstrategie statt blindem Überschreiben; Migration bestehender lokaler Daten; robusten Export/Import; und getrennte Behandlung von Gast, Signer und lokalem Profil. Zu prüfen sind zwei Geräte, offline zuordnen und lösen, gleichzeitige Änderungen, Sign-out/Profilwechsel, Konflikte durch spätere Spiele, Datenschutz fremder Spieler, Wiederherstellung sowie Rückwärtskompatibilität alter Dateien. Die bestehende Zugangssicherung darf nicht als vollständige Spielstand-Sicherung dargestellt werden.
