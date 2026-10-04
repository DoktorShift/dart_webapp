# 0001 Kein eigenes Backend; Nostr und Lightning ausschließlich über nostr-core

**Status:** Angenommen (Nutzerentscheidung vom 4. Oktober 2026). Die mit „Vorläufig“ markierten Folgeentscheidungen hat der Umsetzer getroffen, weil der Nutzer den vollständigen Umbau über Nacht beauftragt hat; der Nutzer bestätigt oder ändert sie.

## Kontext

[PLAN.md](../implementation/PLAN.md) sah einen BlueLine-Sicherungsdienst, einen Kopplungsdienst, zwei eigene Relays, einen Ausstellerdienst für Auszeichnungen sowie Serverbetrieb mit Monitoring und Backups vor. Der Nutzer hat am 4. Oktober 2026 entschieden:

> we aim to built it with no backend... only with nostr-core for all nostr & lightnign capabilities. Please to start step by step on it in a seperate branch. we dont want to crash something on v1.0.0

Die Analyse der Planstellen liegt im [Risikobericht](../implementation/evidence/P0.01/RISKS-P0.02-P0.07.md) (Abschnitt „Kein eigenes Backend“).

## Entscheidung

1. **Kein eigener Server.** BlueLine bleibt eine Web-App ohne eigene Dienste: kein Sicherungs- oder Passkey-Server, kein Kopplungsdienst, keine eigenen Relays, kein Ausstellerdienst, keine Server- oder Netlify-Funktionen mit Geheimnissen oder Nutzerdaten. Netlify liefert ausschließlich die gebaute App aus.
2. **Netzwerkpartner** sind nur: öffentliche Nostr-Relays (Standardkatalog sowie vom Nutzer, Signer oder Wallet genannte Relays), die vom Spieler verbundene NWC-Wallet und der Lightning-Adress- beziehungsweise LNURL-Dienst des jeweiligen Zahlungsempfängers (Teil von dessen Wallet-Einrichtung).
3. **nostr-core** ist der einzige Zugang zu Nostr und Lightning in der App (`lib/nostr/` als einziger Importeur). Fehlende generische Bausteine entstehen upstream-fähig in `lib/nostr/ext/` auf Basis der nostr-core-Primitiven und ihrer Kryptobibliotheken (`@noble/*`, `@scure/*`), bis nostr-core sie selbst enthält ([Entscheidung 0002](0002-architektur.md)).
4. **Version 1.0.0 bleibt unangetastet.** Gearbeitet wird im Branch `nostr-expansion`. Gastspiel, Offline-Nutzung und vorhandene Daten bleiben erhalten; der Gastweg öffnet keine Netzwerkverbindung.

## Vorläufige Folgeentscheidungen des Umsetzers

| Nr. | Frage | Vorläufige Entscheidung | Begründung |
| --- | --- | --- | --- |
| F1 | Wiederherstellung ohne altes Gerät | Immer: verschlüsselte **Sicherungsdatei** (NIP-49 für den Schlüssel, starkes erzeugtes Kennwort). Zusätzlich **Passkey**, aber nur wenn das Gerät PRF beim Anlegen und beim erneuten Entsperren nachweislich liefert; dann liegt ein mit dem PRF-Schlüssel (nicht mit einem Kennwort) verschlüsseltes Paket unter einem nicht zuordenbaren Schlüssel auf mehreren Relays. Dazu die Gerätekopplung per QR. Keine Wiederherstellungswörter (NIP-06). | Ohne Server gibt es keinen anderen gerätübergreifenden Passkey-Weg. Ein PRF-Schlüssel hat volle Entropie; das Verbot in PLAN.md Zeile 147 zielte auf durchprobierbare Kennwörter. Die Datei funktioniert unabhängig von Relays. |
| F2 | Private Spielhistorie | Lokal ist die maßgebliche Kopie. Mit einem Profil wird sie zusätzlich NIP-44-verschlüsselt an das Profil selbst als NIP-78-Daten auf mindestens drei Relays verschiedener Betreiber gelegt, mit nicht sprechenden d-Kennungen und ohne Klartext-Tags. Eigene Relays können unter „Erweitert“ ergänzt werden. | Nur so funktioniert „Ergebnisse mitnehmen“ auf einem neuen Gerät. Das Restrisiko (öffentlich abrufbarer Geheimtext, sichtbare Metadaten, keine Vorwärtssicherheit) steht im Bedrohungsmodell der Entscheidung 0002. |
| F3 | Auszeichnungen | Club- und Turnierauszeichnungen vergibt der benannte Veranstalter mit seinem Schlüssel. Persönliche Meilensteine erscheinen als „Auf diesem Gerät erreicht“; erst „Im Profil zeigen“ veröffentlicht sie als selbst vergebene Auszeichnung mit der Kennzeichnung „Selbst erreicht“ und Verweis auf das Spielergebnis. | Ein BlueLine-Ausstellerschlüssel in einer öffentlichen App wäre für jeden auslesbar. |
| F4 | Euro-Näherung bei Zahlungen | Entfällt; angezeigt und bestätigt werden sats. | Kursdienste wären ein zusätzlicher Netzwerkpartner. |
| F5 | Bild-Uploads | Keine Uploads. Avatar wird lokal erzeugt oder als vorhandene Bild-URL übernommen. Fremde Profilbilder werden nur als https-Rasterbild ohne Referrer geladen. | Blossom-Server wären zusätzliche Dienste. |
| F6 | Hosting | Netlify mit der vorhandenen Next.js-Laufzeit, ausschließlich statisch vorgerenderte Seiten. Einladungs-, Profil-, Zuschauer- und Kopplungslinks zeigen auf `/` mit allen Angaben im URL-Fragment (`#…`), das nie an den Server geht. | Keine neue serverseitige Route, keine Geheimnisse in Serverlogs. |
| F7 | Domain | Vorerst `blueline21.netlify.app`. Passkeys sind an diese Domain gebunden; ein späterer Umzug lässt Passkey-Sicherungen ungültig werden, Sicherungsdatei und Gerätekopplung bleiben gültig. | Nutzerentscheidung vor der Veröffentlichung nötig. |
| F8 | Benachrichtigungen | Nur innerhalb der geöffneten App; keine Push-Nachrichten im Hintergrund. | Web Push braucht einen Server. |
| F9 | Kopplungscodes | Das Geheimnis steckt im QR-Code beziehungsweise Link-Fragment. Der eintippbare Ersatzcode hat 60 Bit und ist selbst das Geheimnis; die Vergleichskennung wird erst nach dem Schlüsselaustausch berechnet und ist nie der eingetippte Code. | Ohne Vermittler gibt es keine Ratenbegrenzung. |

## Was ohne Backend nicht möglich ist

Diese Grenzen werden in der Oberfläche nie anders dargestellt:

1. Lese- und Zugriffsschutz nur durch Verschlüsselung, nicht durch Serverrechte.
2. Keine zugesicherte Aufbewahrung bei Relays, keine Serverbackups, keine Wiederherstellungszeiten. Lokale Kopie und Export bleiben das Sicherheitsnetz.
3. Löschen privater Kopien auf Relays ist nur eine Bitte (NIP-09).
4. Keine neutrale, fälschungssichere automatische Auszeichnung.
5. Keine Hintergrund-Benachrichtigungen.
6. Keine Ratenbegrenzung kurzer Codes durch einen Vermittler.
7. Kein IP-verbergender Abruf fremder Bilder oder LNURL-Dienste.
8. Keine zentrale Fehler- oder Latenzüberwachung; stattdessen eine lokale Diagnose unter „Erweitert“.
9. Kein kuratiertes Verzeichnis und keine vollständige Spielersuche.
10. Keine vertrauenswürdige Zeit für Anmeldeschluss und Reihenfolge; maßgeblich ist die Entscheidung der berechtigten Rolle.
11. Kein zentral durchgesetzter Widerruf von Sitzungen; signierte Widerrufe wirken, sobald andere Geräte sie lesen.

## Betroffene Planstellen

Planstellen, die einen eigenen Dienst voraussetzen, gelten in der Fassung dieser Entscheidung. Insbesondere: Zeilen 119–155 (Kopplung und Sicherung), 183–197 (Speicherung), 240, 352, 443–449 (Aussteller), 465 (Euro), 501–503 (Medien, Benachrichtigungen), 612–632 (Dienst-API, Betrieb, Kosten), Arbeitspunkte P0.04, P0.06, P2.04, P3b.01, P3b.03, P7a.01, P8.03 sowie HANDOFF.md Zeile 47.

Neue Fassung der betroffenen Abnahmekriterien:

- **A07:** Profilzugang lässt sich nach Verlust des Geräts über Sicherungsdatei, Passkey (wo unterstützt) oder ein zweites Gerät wiederherstellen. Die private Historie kommt aus den Relay-Kopien, soweit sie noch vorliegen, oder aus einem Export; die App unterscheidet vollständig, teilweise und nicht mehr abrufbar.
- **A20:** Wiederherstellung ohne Ursprungsgerät und vollständiger portabler Export sind praktisch erfolgreich durchgeführt; der Export ist mit einer unabhängigen Implementierung lesbar.
- **A23:** Eine Auszeichnung wird aus dem richtigen Anlass genau einmal vergeben. Aussteller ist der berechtigte Veranstalter oder, gekennzeichnet als „Selbst erreicht“, der Spieler selbst. Manipulierte Vergaben, falsche Aussteller, unpassende Empfänger, doppelte Referenzen und aufgehobene Ergebnisse werden erkannt.
- **A12** (Klarstellung): „Abgewiesen“ heißt: vom Client der berechtigten Rolle ohne Zustandsänderung zurückgewiesen.
- **A25** (Ergänzung): Kein eigenes Backend; Prüfung der Importgrenze und der Build-Ausgabe auf serverseitige Routen.

## Folgen

- Weniger Betrieb und keine laufenden Kosten außer Domain und Hosting.
- Mehr Verantwortung im Client: lokale Kopie, Warteschlange, Selbstheilung fehlender Relay-Kopien beim Öffnen der App, Export.
- Ehrliche Texte: „gesichert“ und „synchronisiert“ beschreiben einen geprüften Stand zu einem Zeitpunkt, keine Zusicherung.
