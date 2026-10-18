# BlueLine Darts Umsetzungsplan für Profile Clubs Turniere und direkte Zahlungen

Übergabestand: 4. Oktober 2026 · Page-Version 5 · Codebasis `e6ff77edc575eae2cf6a9dd61112edb2400fb05d`.

Quelle: [Gemeinsamer Umsetzungsplan](https://chatgpt.com/space/page_6a4c2e64a33c81918f36154f8d34adf8). Einstieg und Review-Verfahren: [HANDOFF.md](HANDOFF.md). Diese Fassung enthält den vollständigen Plan; nur die Page-spezifische Visualisierung wurde durch den lokalen Prototyp-Link ersetzt. Spätere Änderungen zwischen Page und Repository werden ausdrücklich abgeglichen.

Dieser Plan beschreibt die vollständige Erweiterung von BlueLine Darts: portable Spielerprofile mit verständlichen Statistiken und Auszeichnungen, einfache Wiederherstellung, gemeinsame Spiele, Clubs, Turniere, Zuschaueransichten und direkte Zahlungen zwischen Spielern. Die Oberfläche bleibt eine einfache Dart-App; Nostr arbeitet im Hintergrund. Verbindliche technische Grundlage für sämtliche Nostr-Funktionen ist nostr-core; Wallets werden über NWC verbunden.

Planungsstand: 4. Oktober 2026. Grundlage sind die besprochenen Produktentscheidungen und der vorhandene Code auf Commit `e6ff77e`. Dies ist ein Umsetzungsplan mit überprüfbaren Abnahmekriterien, keine Behauptung bereits implementierter Funktionen. Technische Standardaussagen sind verlinkt; Architektur, Grenzwerte und Abläufe ohne solche Kennzeichnung sind konkrete Vorschläge für BlueLine.

## Arbeitssteuerung und unabhängiges Review

Dieser Plan ist die verbindliche Arbeitsgrundlage für den Umsetzer und den unabhängigen Reviewer. Die Produktkapitel definieren das gewünschte Verhalten; die Arbeitspakete legen Reihenfolge und konkrete Lieferergebnisse fest. Zu jedem Abschluss gehören nachprüfbare Ergebnisse auf Code-, Protokoll- und UX-Ebene. Der Nutzer soll die Anwendung beurteilen können, ohne zuerst unvollständige Standardfälle, widersprüchliche Zustände oder vermeidbare Bedienfehler nacharbeiten zu müssen.

**Aktueller Stand:** Produktspezifikation, Recherche, Bearbeitungsstruktur und ein erster interaktiver UX-Entwurf sind dokumentiert. Die produktive Erweiterung ist noch nicht begonnen. Sämtliche Umsetzungspunkte sind offen; der Prototyp ist eine Vorarbeit zu P0.02. Erster Auftrag an den Umsetzer ist **P0.01**, danach folgen die technischen und gestalterischen Nachweise aus P0.

**Bearbeitungsreihenfolge:** P0 → P1 → P3a → P2 → P3b → P4 → P5 → P6 → P7a → P7b → P8. P3 wird aufgeteilt, weil Profile bereits die Protokollgrundlage benötigen. Jede Abhängigkeit wird vor Beginn des davon abhängigen Schritts geprüft. Unabhängige Vorarbeiten dürfen weitergehen, wenn ein externer Nachweis noch aussteht; dadurch wird das betroffene Paket nicht als abgeschlossen gewertet.

**Verantwortung:** Ein separater Bearbeiter übernimmt Implementierung, Recherche offener technischer Details, eigene Vorprüfungen, Fehlerbehebung und Dokumentation. Codex in diesem Review-Thread übernimmt das unabhängige Review von Code, Protokoll, UX und Nachweisen. Routinemäßige technische Entscheidungen werden vom Umsetzer begründet getroffen und im Review bewertet. Notwendige Produktentscheidungen oder tatsächlich fehlende externe Zugänge werden früh mit einer konkreten Empfehlung benannt. Bestehende Entscheidungen — insbesondere Gaststart, nostr-core, NWC und der vollständige Umfang — werden nicht erneut zur Disposition gestellt. Der Nutzer entscheidet über Produktfragen und die Veröffentlichung.

Der Plan erhält pro Arbeitspunkt einen der Zustände „Offen“, „In Arbeit“, „In Prüfung“, „Wartet auf Nachweis“ oder „Abgeschlossen“. Eine Checkbox wird ausschließlich für „Abgeschlossen“ gesetzt. „Wartet auf Nachweis“ nennt den fehlenden Nachweis, dessen Auswirkung und den nächsten möglichen Schritt. Eine existierende Implementierung mit ungetesteter Gerätefunktion bleibt sichtbar unvollständig.

Vor jedem Arbeitsabschnitt werden letzter Arbeitsstand, Repository-Zustand, gültige Projektanweisungen, aktuelle Abhängigkeiten und relevante Planstellen gelesen. Es gibt einen klar benannten aktiven Arbeitspunkt. Vor dem Wechsel zum nächsten Punkt legt der Umsetzer die Abschlussnachweise zur Prüfung vor oder dokumentiert die noch offene Abhängigkeit. Nach einem Kontext- oder Sitzungswechsel wird an diesem Stand fortgesetzt.

### Nachweise und Übergabe zwischen Arbeitsabschnitten

Jeder Arbeitspunkt erhält eine kurze Karte mit Ziel, betroffenen Produktregeln und Abnahmekriterien, Voraussetzungen, geplanter Änderung, relevanten Fehlerfällen und Abschlussnachweisen. Die Karte nennt nach Umsetzung den tatsächlichen Commit beziehungsweise PR, die verwendete nostr-core-Version, ausgeführte Prüfungen mit Ergebnis und Datum sowie verbleibende Einschränkungen. Beispiele und Sollwerte stehen vor der Umsetzung fest, damit Tests nicht bloß die geschriebene Implementierung bestätigen.

Die lokale Übergabe liegt unter `docs/implementation/HANDOFF.md`, eine vollständige Planfassung unter `docs/implementation/PLAN.md` und der klickbare Entwurf unter `docs/ux/blueline-comfort-prototype.html`. P0.01 übernimmt diese Arbeitsdateien in die versionierte Aufgaben- und Nachweisablage und ergänzt `docs/decisions/` für begründete Entscheidungen sowie `docs/protocol/` für das Darts-Format. Die Page bleibt Übersicht für Umfang und Fortschritt; konkrete Code- und Prüfnachweise werden von dort verlinkt. Änderungen an Produktentscheidungen werden zwischen Page und Planfassung abgeglichen; Abweichungen werden ausdrücklich benannt. Das Anlegen dieser Übergabe schließt P0.01 nicht ab.

Jeder Arbeitsabschluss hält fest: zuletzt nachgewiesener Stand, aktive Aufgabe, offene Befunde und **genauer nächster Schritt**. Fortschritt wird anhand geprüfter Ergebnisse berichtet. Nicht ausgeführte Tests werden ausdrücklich als offen benannt. Browseremulation, selbst durchgespielte Abläufe und Tests mit echten Personen sind unterschiedliche Nachweise; keines wird als Ersatz für ein anderes ausgegeben.

**Review je Lieferung:** Der Umsetzer liefert einen abgegrenzten Branch beziehungsweise PR mit Basis- und Prüfcommit, Aufgaben-ID, betroffenen Abnahmekriterien, ausgeführten Prüfungen und offenen Grenzen. Der Reviewer prüft den tatsächlichen Diff und die relevanten Abläufe unabhängig. Jeder Befund nennt Priorität, Fundstelle, Auswirkung und Reproduktion. Der Umsetzer behebt die Befunde; die Nachprüfung bezieht sich auf den neuen Commit. Abschluss und Freigabe gelten nur für den geprüften Stand und Umfang. Unabhängige Vorarbeiten können weitergehen; abhängige Entscheidungen werden nicht auf ungeprüften Voraussetzungen aufgebaut. Ein PR-Link oder Commit wird in diesem Thread zur Prüfung vorgelegt; automatische Überwachung ist damit nicht eingerichtet.

„10/10“ wird als Qualitätsanspruch in überprüfbare Arbeit übersetzt: verständliche Kernabläufe, konsistente Gestaltung, belastbare Daten und Berechtigungen, schnelle Bedienung und vollständige Behandlung der vereinbarten Fehlerfälle. Ein grüner Build oder eine Selbsteinschätzung allein erfüllt diesen Anspruch nicht.

## Produktregeln und vollständiger Umfang

Der Einstieg bleibt unverändert schnell: App öffnen, Spieler benennen, Regeln wählen, werfen. Ein Profil entsteht erst durch eine passende Aktion des Spielers. Weder ein Profil noch Internet, eine Wallet oder ein externer Signer sind Voraussetzung für ein lokales Spiel.

Die Oberfläche verwendet „Mein Profil“, „Ergebnisse mitnehmen“, „Profil sichern“, „Profil verbinden“, „Club“, „Turnier“ und „Bezahlen“. Protokollnamen, Relay-URLs und Schlüssel erscheinen ausschließlich in technischer Dokumentation oder ausdrücklich geöffneten Experteninformationen. Vor einer öffentlichen Profilveröffentlichung erklären wir dagegen verständlich, welche Angaben sichtbar werden.

Zum vereinbarten Gesamtumfang gehören:

- Bestehende Spielarten, Korrekturen, Statistiken, Gastspieler und Offline-Funktion erhalten.

- Profile neu erstellen, verbinden, sichern, übertragen und wiederherstellen; eigene und fremde Profile mit freigegebenen Statistiken ansehen.

- NIP-07, Amber über NIP-46 und getestete Android-Anbindung über NIP-55.

- NIP-65 und Veröffentlichung neuer Profile an fünf ausgewählte Relays.

- NIP-51 für passende Listenfunktionen; NIP-58 für erreichbare und gewonnene Auszeichnungen.

- Private Historie, geräteübergreifende Synchronisierung und Datenexport.

- Clubs mit verständlicher Übersicht, Mitgliedern, Rollen, Einladungen, Saisons und Ranglisten.

- Turniere mit eigenen Ansichten für Teilnehmer, Organisation und Zuschauer, Anmeldung, Paarungen, mehreren Boards und verlässlicher Ergebnisübernahme.

- Gemeinsames Spielen, Ergebnisbestätigung, Korrekturen und Zuschaueransicht.

- NWC als Wallet-Anbindung für Bezahlen und Empfangen innerhalb der App; vereinbarte Einsätze, freiwillige Zaps und direkte Lightning-Zahlungen ohne gemeinsamen Topf.

- Sämtliche Nostr-Protokollfunktionen über [nostr-core](https://nostr-core.netlify.app/); nötige Ergänzungen werden dort geplant und geprüft.

- Ein zusammengehöriges Zahlungssignet aus den originalen Bitcoin- und NWC-Logos, mit einfachen Beschriftungen.

Die Spieler regeln Einsätze und Streitfälle persönlich. BlueLine nimmt keine Einsätze entgegen, verwahrt keine Spielgelder und löst keine Zahlung allein aufgrund eines Spielergebnisses aus.

## Nutzerwege und unaufdringliche Profilerstellung

| Situation | Sichtbarer Ablauf | Verhalten im Hintergrund |
| --- | --- | --- |
| Erstes Spiel | Namen eingeben und starten | Nur lokale Gastdaten; keine öffentliche Identität erzeugen |
| Fertiges Spiel | Unaufdringliche Aktion „Deine Ergebnisse mitnehmen“ | Profil entsteht erst nach Auswahl eines eigenen Spielerplatzes und Bestätigung |
| Clubeinladung | Club und Einladung ansehen, dann beitreten | Profil bei Bedarf innerhalb dieses Ablaufs erstellen oder verbinden |
| Turnieranmeldung | Turnier ansehen und anmelden | Wahl zwischen vorhandenem Profil und einfacher Profilerstellung; Organisator darf Gäste führen |
| Neues Gerät | „Auf anderem Gerät nutzen“ → scannen und bestätigen; ohne bisheriges Gerät „Aus meiner Sicherung“ | Kopplung oder Wiederherstellung durchführen, danach Daten im Hintergrund abrufen |
| Vorhandene Identität | „Profil verbinden“ | Passenden Signer verwenden und vorhandene Metadaten einlesen |
| Gemeinsames Tablet | Spieler per QR hinzufügen oder Namen eingeben | Spieleridentität bleibt vom Besitzer des Tablets getrennt |

Nach Spielen erscheint höchstens ein kleiner, wegklickbarer Hinweis. Kein Anmeldedialog beim Start und keine wiederholte Unterbrechung nach Ablehnung. „Später“ lässt das Spiel und die lokale Historie vollständig nutzbar.

Vor der Veröffentlichung werden Anzeigename und optionales Bild bestätigt. Private Spielhistorie, Gegnernamen und frühere Gäste werden dabei nicht automatisch veröffentlicht. Der technische Schlüssel wird lokal sicher zufällig erzeugt.

Interne Zustände: Gast; Profil nur auf diesem Gerät; Veröffentlichung ausstehend; Profil veröffentlicht; Wiederherstellung eingerichtet. Sie werden technisch getrennt geführt, aber nicht als Statusliste im normalen Profil angezeigt. „Dein Profil ist gesichert.“ erscheint erst nach erfolgreicher Sicherung und Entschlüsselungsprüfung. Sichtbare Rückmeldungen richten sich nach dem Ziel des Spielers; Veröffentlichung und Hintergrundabgleich erzeugen keine routinemäßigen Meldungen.

Beim späteren Verbinden einer bestehenden Identität übernimmt BlueLine ausgewählte lokale Ergebnisse bewusst. Frühere signierte Ergebnisse bleiben unter ihrem ursprünglichen Autor erhalten; historische Gastnamen werden nicht automatisch als bewiesene Profilzugehörigkeit behandelt.

## Identitäten und Signer

Die App verwendet die gemeinsame `Signer`-Schnittstelle von nostr-core: `createSecretKeySigner`, `Nip07Signer` und `NostrConnect`. Unser Adapter ergänzt ausschließlich BlueLine-Sitzungszustand, Bedienabläufe und Abmeldung. Eine direkte Android-Anbindung muss ebenfalls durch einen entsprechenden nostr-core-Adapter laufen; sie wird nicht als zweiter Protokollstack in der App gebaut. [Signer-API](https://github.com/nostr-core-org/nostr-core/blob/02ab4c8a14af55f48de917bd7d6b2285c5cfb6bb/docs/api/signer.md)

NIP-07 stellt den Browserzugang bereit. Bei NIP-46 unterscheiden wir Verbindungsschlüssel, Signer und tatsächlichen Nutzer, prüfen den Verbindungsnachweis, unterstützen Abbruch, Wiederverbindung und Relay-Wechsel. Berechtigungen werden auf benötigte Aktionen begrenzt. [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md), [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md)

Amber wird vorrangig über NIP-46 integriert. NIP-55 erhält einen expliziten Android-Einstieg mit getesteter Rückkehr zur ursprünglichen Sitzung, auch bei neu geöffnetem Browsertab. Ein abgebrochener Login erzeugt weder eine zweite Identität noch ein verlorenes Spiel. Eine installierte App lässt sich im Browser nicht immer zuverlässig erkennen; daher bleibt „Mit Amber verbinden“ gezielt auswählbar. [Amber](https://github.com/greenart7c3/Amber), [NIP-55](https://github.com/nostr-protocol/nips/blob/master/55.md#using-web-applications)

Für externe Profile prüfen wir unterstützte Fähigkeiten. Fehlende Verschlüsselung verhindert beispielsweise private Synchronisierung, aber nicht das lokale Spielen. Eine abgelehnte Signatur wird nicht automatisch erneut angefordert.

Bestehende Profilfelder, Relay-Listen und fremde Listeneinträge bleiben erhalten. Eine Änderung des BlueLine-Spitznamens überschreibt nicht nebenbei das globale öffentliche Profil.

Abmeldung trennt Signer und Wallet, beendet Abonnements und entfernt Sitzungsschlüssel. Sie fragt verständlich, ob private lokale Daten auf einem gemeinsam genutzten Gerät verbleiben sollen. Externe Hauptschlüssel werden nicht importiert, um Signer-Probleme zu umgehen.

## Geräte einfach per QR verbinden

„Gerät verbinden“ ist eine Kernfunktion mit eigenem Arbeitspaket und eigener Abnahme. Normale Spieler müssen weder einen Signer installieren noch verstehen, welches Protokoll BlueLine verwendet. Die Einrichtung stellt den gewünschten Nutzen voran.

| Gewünschte Aktion | Ablauf | Übertragene Befugnis |
| --- | --- | --- |
| Eigenes neues Handy oder Tablet | Neues Gerät zeigt QR, vorhandenes Gerät scannt und bestätigt „Mein Profil hier verwenden“ | Nach bestätigter privater Kopplung Zugang zum eigenen Profil |
| An einem gemeinsamen Board mitspielen | Board zeigt QR, Spieler scannt und wählt seinen Platz | Teilnahme und gegebenenfalls Ergebnisbestätigung; kein persönlicher Hauptschlüssel auf dem Board |
| Club oder Turnier beitreten | Einladung scannen, Informationen ansehen, beitreten | Nur der konkrete Beitrittsvorgang |
| Spiel verfolgen | Zuschauer-QR scannen | Nur Lesen |
| Spiel auf anderes Board übertragen | Im laufenden Spiel „Auf anderem Gerät fortsetzen“, dort öffnen, Übergabe bestätigen | Neue aktive Schreibsitzung für genau dieses Spiel |

Die Kopplung eines eigenen Geräts zeigt auf beiden Seiten den Gerätenamen und eine übereinstimmende kurze Kennung. Nach Bestätigung läuft die Übertragung verschlüsselt und einmalig. Das neue Gerät bestätigt Empfang und erfolgreiche Entschlüsselung. Erst dann gilt die Kopplung als fertig.

Ohne Kamera gibt es „Code eingeben“ und „Link öffnen“. Ein kurzer Code dient zum Finden einer zeitlich begrenzten Anfrage. Die Freigabe erfolgt weiterhin auf dem vorhandenen Gerät; der Code allein ist kein dauerhafter Login. Ohne vorhandenes Gerät führt „Profil wiederherstellen“ zum Passkey oder zur gespeicherten Sicherung.

Die Verbindung hat vollständige Zustände: wartet, gefunden, auf anderem Gerät bestätigen, wird übertragen, verbunden, abgelehnt, abgelaufen und erneut versuchen. Nach Reload oder App-Wechsel lässt sich derselbe Vorgang fortsetzen, ohne doppelte Profile zu erzeugen. Abgelaufene Sitzungen werden bereinigt.

Für lokale BlueLine-Profile kann der Nutzer einem ausdrücklich als eigenes Gerät bestätigten Ziel sein verschlüsseltes Profilpaket übertragen. Externe Identitäten werden am Ziel über ihren Signer verbunden; die App versucht nicht, deren Hauptschlüssel zu exportieren. Die Oberfläche führt durch den jeweils passenden Weg.

Eine Geräteübersicht ermöglicht Umbenennen, Trennen und Beenden von App-Sitzungen. Wenn ein eigenes Gerät bereits den Hauptschlüssel erhalten hat, kann ein bloßes Entfernen aus dieser Liste eine kopierte Identität nicht kryptografisch widerrufen. Dieser Unterschied wird im Sicherheitsdesign und beim gezielten Vorgang „Gerät verloren“ berücksichtigt.

Die Kopplungsimplementierung nutzt bewährte Verschlüsselung mit frischen Sitzungsschlüsseln, zeitlich begrenzten Anfragen, Antwortbindung und Wiederholungsschutz. Keine dauerhaften Geheimnisse in öffentlichen QR-Codes, Browserhistorie oder Serverlogs. Der Kopplungsdienst vermittelt Anfragen und verschlüsselte Pakete; er soll deren Inhalt nicht entschlüsseln können.

Abnahme aus Nutzersicht: Verbindung iPhone zu Android, Android zu iPhone und Handy zu Tablet; Browser und installierte PWA; gesperrte Kamera; Link im falschen Browser; Signer-App im Hintergrund; Abbruch und Wiederaufnahme. Auf unterstützten Geräten soll ein vorhandenes Profil nach Scannen mit einer klaren Freigabe übernommen sein. Erklärungen zu Nostr oder Kryptografie sind dafür nicht nötig.

## Sicherung und Wiederherstellung

Empfohlene Architektur: Der Client verschlüsselt ein Profilpaket. Ein kleiner BlueLine-Sicherungsdienst speichert ausschließlich dieses verschlüsselte Paket und die zur Anmeldung nötigen Passkey-Daten. Die Entschlüsselung erfolgt auf dem Gerät. Das Paket enthält den Profilzugang sowie die zum Auffinden und Entschlüsseln persönlicher Daten nötige Konfiguration.

Ein Passkey kann über WebAuthn PRF das Paket entsperren. Das ist eine zusätzliche Nutzung des Passkeys, keine direkte Nostr-Signatur. Unterstützung und Wiederherstellung über verschiedene Geräte und Passwortmanager werden vor der Produktfreigabe praktisch geprüft. [WebAuthn PRF](https://w3c.github.io/webauthn/#prf-extension)

Konkrete Sicherungswege:

1. „Profil sichern“ richtet einen Passkey ein, lädt das verschlüsselte Paket hoch und prüft das erneute Entschlüsseln.

2. „Sicherung speichern“ erzeugt eine portable, verschlüsselte Datei. Für den privaten Profilschlüssel verwenden wir den NIP-49-Export; weitere Daten und Formatversion liegen in einem dokumentierten Sicherungspaket.

3. „Auf anderem Gerät verwenden“ koppelt zwei Geräte mit einmaliger Anfrage, kurzem Ablaufdatum und Bestätigung auf dem vorhandenen Gerät. Der angezeigte Kopplungscode ist kein dauerhafter Profilschlüssel.

4. „Profil wiederherstellen“ führt erst zur Identität, dann zum Abruf der Historie. Der Abruf läuft ohne technische Statusmeldungen. Ist ein konkret angefordertes Spiel noch nicht verfügbar, lautet die Rückmeldung „Dieses Spiel ist hier noch nicht verfügbar.“ mit „Erneut versuchen“. Die Oberfläche zeigt weder falsche Nullwerte noch eine vermeintlich vollständige Historie.

Für den Dateiexport wird ein starkes Sicherungskennwort angeboten, das im Passwortmanager gespeichert werden kann. Ein selbst gewähltes schwaches Kennwort wird nicht als gleichwertig sichere Lösung dargestellt. Verschlüsselte private Schlüssel werden nicht auf öffentliche Relays hochgeladen. [NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md)

Profilzugang und Spielhistorie werden intern getrennt auf Wiederherstellbarkeit geprüft. Eine Profilsicherung allein ist keine vollständige Kopie aller Spiele. In der bewusst geöffneten Sicherungsverwaltung unterscheiden wir deshalb „Profilzugang sichern“ und „Spiele exportieren“; im normalen Spielbetrieb erscheinen keine Synchronisierungsanzeigen. Der vollständige Datenexport enthält Historie, Rohdaten und notwendige Entschlüsselungsinformationen.

Vor Einrichtung produktiver Passkeys wird eine langfristige Domain festgelegt: Die Herkunftsbindung darf bei einem späteren Umzug von der Netlify-Adresse nicht unerwartet die Wiederherstellung brechen. Preview-Deployments verwenden eigene Testidentitäten und eine getrennte Umgebung.

Fallback ohne PRF: verschlüsselte Sicherungsdatei plus lokale Nutzung. Wir behaupten keine automatische Wiederherstellung auf nicht getesteten Plattformen. Bestehende externe Identitäten sichern ihre Hauptschlüssel weiterhin in ihrem Signer; BlueLine sichert die dazugehörigen App-Daten.

Sicherungsverlust, beschädigte Datei, falsches Kennwort, verlorener Passkey, mehrere Passkeys, Dienstunterbrechung und Wiederherstellung ohne ursprüngliches Gerät sind feste Testfälle. Export muss auch bei Ausfall unseres Sicherungsdienstes mit einer dokumentierten unabhängigen Implementierung lesbar bleiben.

## Start Relays und NIP 65

Für neue Profile gilt das Ziel: öffentliche Profilmetadaten und die Relay-Liste an fünf geeignete Ziele veröffentlichen. Die aktuelle Startauswahl lautet:

| Relay | Geplante Rolle | Prüfung am 4. Oktober 2026 |
| --- | --- | --- |
| `wss://nos.lol` | Allgemeiner Lese- und Schreibweg | NIP-11 sowie Lesen von Kind 0 und 10002 erfolgreich |
| `wss://relay.primal.net` | Allgemeiner Lese- und Schreibweg | NIP-11 sowie Lesen von Kind 0 und 10002 erfolgreich |
| `wss://nostr-01.yakihonne.com` | Allgemeiner Lese- und Schreibweg | NIP-11 sowie Lesen von Kind 0 und 10002 erfolgreich |
| `wss://nostr.oxtr.dev` | Allgemeiner Lese- und Schreibweg | NIP-11 sowie Lesen von Kind 0 und 10002 erfolgreich |
| `wss://purplepag.es` | Profil- und Listenverteilung | NIP-11 sowie Lesen von Kind 0 und 10002 erfolgreich |

Die Prüfungen waren ausschließlich lesend. Sie belegen keine Annahme frischer Profile und keine dauerhafte Speicherung. Genau diese Schreib- und Aufbewahrungsprüfung gehört zum Freigabeschritt. Betreiberangaben: [nos.lol](https://nos.lol/), [Primal](https://relay.primal.net/), [YakiHonne](https://nostr-01.yakihonne.com/), [0xtr](https://nostr.oxtr.dev/), [Purple Pages](https://github.com/pablof7z/purplepag.es).

Damus ist momentan Reserve: Der WebSocket-Aufbau lieferte bei dieser Prüfung HTTP 503. Snort konnte lesen, beschreibt seinen derzeitigen Dienst jedoch als In-Memory-Relay und wird deshalb nicht als Standard für dauerhafte Profilverteilung eingeplant. nos.lol und nostr.mom nennen denselben Betreiber-Pubkey; sie zählen bei unserer Redundanzbewertung nicht als zwei unabhängige Betreiber.

NIP-65 verwendet Kind 10002 mit Lese- und Schreibangaben. Unsere vier allgemeinen Ziele werden als solche eingetragen; Purple Pages bleibt ein zusätzliches Verteilungsziel für Profile und Listen. Damit veröffentlichen wir an fünf Ziele, ohne einem spezialisierten Verzeichnis allgemeine Empfangsfähigkeiten zuzuschreiben. Autoren lesen wir an deren Schreib-Relays; Erwähnungen gehen an passende Lese-Relays. [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md)

Für bestehende Profile übernehmen wir die vorhandene Konfiguration und respektieren blockierte Relays. Neue Standardlisten ersetzen keine Nutzerentscheidung.

Der Client signiert Profil und Relay-Liste jeweils einmal und verteilt dieselben Events. Ziel sind fünf bestätigte Kopien. Ab zwei unabhängig bestätigten Zielen darf der Status „Profil veröffentlicht“ lauten; die übrigen bleiben in der Warteschlange. Die Oberfläche behauptet erst bei fünf geprüften Kopien vollständige Verteilung. Bei null oder einer Kopie bleibt die Nutzung lokal möglich.

Ein versionierter Relay-Katalog enthält Fähigkeiten, Einschränkungen, Betreiberzuordnung und Ersatzkandidaten. Nur vorab geprüfte Ersatz-Relays dürfen automatisch nachrücken. Die App wird durch diese Auswahl nicht von einem Relay-Betreiber abhängig.

## Zuverlässige Speicherung und Synchronisierung

Die fünf öffentlichen Profil-Relays sind nicht automatisch Speicher für private Historie oder eigene Dart-Events. Wir trennen drei Aufgaben: öffentliche Auffindbarkeit, persönliche verschlüsselte App-Daten und gemeinsam genutzte Club- beziehungsweise Matchdaten.

Damit ein neu verbundenes Profil seinen privaten Speicher wiederfindet, veröffentlichen wir eine getrennte, bei Bedarf verschlüsselte NIP-51-Relay-Sammlung mit stabiler BlueLine-Kennung. Die dafür verwendeten Ziele müssen Annahme und Wiederabruf dieses konkreten Formats nachweislich unterstützen; die Eignung eines Relays für Kind 0 allein genügt nicht. Die verschlüsselte Sicherung enthält zusätzlich die nötigen Hinweise, und die App kennt ihre Standard-Speicheradressen als Startpunkt. Änderungen bleiben signiert nachvollziehbar und werden beim Gerätewechsel ohne manuellen URL-Eintrag gefunden.

Für die letzten beiden Aufgaben planen wir einen vollständig dokumentierten BlueLine-Relay mit dauerhafter Speicherung und einen zweiten Dienst in einer getrennten Ausfallumgebung. Ein privater Datenspeicher erzwingt Authentifizierung und Besitzerzugriff. Gemeinsame Daten erhalten passend zum Objekt öffentliche oder beschränkte Leserechte und zusätzliche Inhaltsverschlüsselung, wo sie benötigt wird.

NIP-11 wird auf Fähigkeiten, Limits und Bedingungen geprüft; NIP-42 beantwortet Authentifizierungsanforderungen gezielt. Fehlende Angaben gelten nicht als Zusage unbegrenzten Schreibens. [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md), [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md)

Vor Freigabe testen wir mit frischen Testidentitäten: Profil, Relay-Liste, verschlüsselte Historie und jede eigene Eventfamilie schreiben; positives OK prüfen; anschließend über eine neue Verbindung lesen; Ablehnung und Filterung unterscheiden. Aufbewahrung wird nach 24 Stunden und sieben Tagen erneut geprüft. Kosten, Quoten, Zugang und spätere Exportmöglichkeiten sind Teil der Anbieterprüfung.

Lokal wechseln größere Datenbestände und die Versandwarteschlange zu IndexedDB. Ein Wurf erhält seine lokale Bestätigung erst nach erfolgreichem Abschluss der Speichertransaktion; anschließend folgen Signierung und Versand unabhängig von der Bedienung. Bei Quota-, Datenbank- oder Schreibfehlern behauptet die App keinen gespeicherten Zustand, hält noch vorhandene Daten zur Rettung bereit und bietet einen konkreten Wiederholungs- oder Exportweg. Doppelte Events werden über ihre IDs erkannt; Wiederholungen verwenden dasselbe signierte Event. Unsichere Ergebnisse eines Versands führen zum Nachlesen, nicht zum Erzeugen doppelter Ergebnisse.

Wiederverbindungen arbeiten mit begrenztem Backoff, Jitter, Zeitüberschneidung beim Nachladen, Pagination und Idempotenz. Profile, private Daten, Clubdaten und Zahlungen haben getrennte Zustände. Netzwerkfehler blockieren keine Eingabe.

Private Synchronisierung gilt erst als vollständig, wenn die vorgesehenen unabhängigen Speicherkopien bestätigt und überprüfbar sind. Regelmäßige Konsistenzprüfungen entdecken verschwundene Kopien. Serverbackups, clientseitiger Export und Relays ergänzen sich; keine dieser Ebenen wird als alleinige Garantie verkauft.

PWA-Hintergrundausführung ist nicht vorausgesetzt. Nach Rückkehr in die App wird die Warteschlange fortgesetzt. Service-Worker-Updates dürfen laufende Spiele, Datenmigrationen und Signer-Rücksprünge nicht verlieren.

## Verwendung von NIP 51

NIP-51 wird gezielt für persönliche Sammlungen genutzt. Private Einträge gehören in den verschlüsselten Inhalt, öffentliche Einträge in Tags. [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md)

| Funktion | Format und Grenze |
| --- | --- |
| „Meine Spielerrunden“ | Kind 30000, eigene benannte Sammlung mit Spieler-Pubkeys |
| Zusätzliche Relay-Sammlungen | Kind 30002, unter anderem `blueline:storage:v1` zum Wiederfinden des App-Speichers |
| Blockierte Relays | Bestehende Liste 10006 respektieren |
| Clubkalender | Kalender 31924 gemäß NIP-52 |
| Gemerkte geteilte Beiträge | 30003 nur für dessen vorgesehene Referenztypen |
| Gemerkte Matches und Clubs | Eigene App-Daten; keine unpassenden Referenzen in Standardlisten erzwingen |
| Im Profil angezeigte Auszeichnungen | Kind 10008 gemäß aktuellem NIP-58; bestehende Auswahl und Reihenfolge anderer Apps erhalten |
| Eigene Auszeichnungssammlungen | Kind 30008 als Badge Set; Altformat `30008:profile_badges` gesondert erkennen und migrieren |

Unsere benannten Sammlungen erhalten getrennte IDs. Vor einer Änderung wird der aktuelle Stand geladen; fremde und unbekannte Einträge bleiben erhalten. Wenn private Einträge nicht entschlüsselt werden können, überschreiben wir die Liste nicht.

Eine Spielerrunde gewährt keine Clubrechte. 10004 gilt für tatsächliche NIP-72-Communities, 10009 für tatsächliche NIP-29-Gruppen. Beide werden nicht zu allgemeinen Dart-Clublisten umgedeutet. Auch die globale Follow-Liste wird nicht automatisch mit Gegnern gefüllt.

## Ereignismodell und eigenes Darts Format

Die geprüfte NIP-Sammlung und das Kind-Register enthalten keinen ausgewiesenen Darts-Standard oder vollständigen Turnierstandard. Wir veröffentlichen deshalb ein kleines, anbieterunabhängig beschriebenes Darts-Format mit JSON-Schemas, Beispielen, Testvektoren und Versionsregeln. Kind-Nummern werden in der ersten technischen Phase nach aktueller Kollisionsprüfung festgelegt; unreservierte Zahlen stehen nicht bereits als vermeintlicher Standard im Plan. [Kind-Register](https://github.com/nostr-protocol/registry-of-kinds/blob/master/schema.yaml)

Standardformate werden für ihre vorgesehenen Aufgaben eingesetzt:

| Aufgabe | Standard |
| --- | --- |
| Öffentliche Metadaten | Kind 0 |
| Relay-Präferenzen | NIP-65, Kind 10002 |
| Eigene persönliche Datensätze | NIP-78, Kind 78 beziehungsweise 30078 |
| Private Inhaltsverschlüsselung | NIP-44, soweit zum konkreten Austausch passend |
| Spieler- und Relay-Sammlungen | NIP-51 |
| Termine, Kalender und Zusagen | NIP-52 |
| Ereignisreferenzen und teilbare Links | NIP-19; für die Oberfläche normale BlueLine-Links |
| Zahlungsanfragen und Zap-Belege | NIP-57 |
| Wallet-Anbindung für alle integrierten Zahlungen | NIP-47 / NWC über nostr-core |
| Auszeichnungen und Auswahl im Profil | NIP-58 und zugehörige NIP-51-Listen |
| Löschanforderungen | NIP-09 |

NIP-78 ist für persönliche App-Daten vorgesehen. Die aktuelle Fassung empfiehlt Besitzerzugriff nach Authentifizierung und grenzt öffentliche Interoperabilität aus. Unser privater Relay erzwingt diese Rechte; die Nutzdaten werden zusätzlich verschlüsselt. Öffentliche oder gemeinsam genutzte Spiele, Clubs und Turniere liegen in eigenen Eventfamilien. [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md)

Für unser Darts-Schema sind folgende Familien vorgesehen:

| Familie | Inhalt und verantwortlicher Autor |
| --- | --- |
| Club-Gründung | Stabile Club-ID, Gründer, Name, Sichtbarkeit und Ausgangsregeln |
| Club-Änderung | Rollen, Aufnahme, Austritt, Ausschluss, Eigentümerwechsel und Saisonregeln; jeweils autorisierte Signatur |
| Turnier-Gründung | Veranstalter, Regeln, Format, Kapazität, Boards und Referenz zum Termin |
| Turnier-Änderung | Aufnahme, Setzung, Auslosung, Board-Zuweisung, Freigabe und Abschluss |
| Match-Vereinbarung | Spielerplätze, vollständige Regeln, Schreiber, Sichtbarkeit, optional vereinbarter Einsatz |
| Match-Protokoll | Versionierte Spielaktionen, Abschnitte und Prüfsummen |
| Match-Ergebnis | Referenz zum Protokoll, Gewinner, Statistik und Regelwerksversion |
| Ergebnisbestätigung | Zustimmung oder Widerspruch zu einer exakten Ergebnis-ID |
| Korrektur oder Aufhebung | Vorgängerreferenz, Begründung und autorisierte Änderung |
| Sitzungsberechtigung | Auf ein Match begrenzte Befugnis eines Schreiber-Geräts |
| Private Zahlungsanfrage | Autorisierter Empfänger, Matchbezug, Rechnung, Betrag und Ablaufzeit; nur Anfrage, niemals Zahlungsfreigabe |
| Auszeichnungsnachweis | Versionierte Bedingung, konkretes Ergebnis und autorisierter Aussteller; Vergabe selbst im NIP-58-Format |

Gemeinsame Felder sind Formatversion, zufällige Objekt-ID, Objektursprung, Vorgängerreferenz, Regelwerksversion und Verweise auf zusammengehörige Daten. Zeitangaben zum Spiel sind vom Veröffentlichungszeitpunkt getrennt. Namen sind Darstellungen; Identitäten sind Schlüssel beziehungsweise eindeutig lokale Gast-IDs.

Abgeschlossene Ergebnisse und Rechteänderungen werden als nachvollziehbare, nicht ersetzte Ereignisse gespeichert. Veränderbare Ansichten und Verzeichnisse dürfen zusätzliche adressierbare Zusammenfassungen nutzen. Sie enthalten Herkunftsreferenzen und sind rekonstruierbar. Ein Relay darf alte Versionen adressierbarer Events verwerfen; deshalb liegt die Audit-Historie nicht ausschließlich darin. [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)

Lange Spiele werden in begrenzte Abschnitte mit Reihenfolge, Referenzen und Hashes aufgeteilt. Die Größe berücksichtigt NIP-44 sowie die tatsächlich erlaubten Relay-Nachrichtengrößen. Kein unbeschränkt wachsendes Profil-Event und keine Bilder als Base64 im Matchdatensatz.

Jede Eventfamilie erhält Validierung für Signatur, Hash, Schema, Berechtigung, Zahlenbereiche, Referenzen, Wiederholung und zukünftige Zeitstempel. Unbekannte Versionen werden erhalten, aber nicht als bekannte Regeln ausgeführt. Tags und Inhalte stimmen nach Prüfung überein.

NIP-29 wird für den Kern nicht vorausgesetzt: Dessen Gruppenverwaltung ist an einen verwaltenden Relay gebunden. Ein späterer Clubchat kann ein eigenständiges, kompatibles NIP-29-Modul werden. Turnierautorität bleibt im signierten Dart-Schema nachvollziehbar. [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md)

## Eigentum Berechtigungen und Konflikte

Club, Turnier, Match und Spielerprofil haben getrennte Verantwortlichkeiten. Ein Host darf ein Spiel aufzeichnen; daraus folgt kein Recht, Spielerprofile zu ändern oder für andere zu bezahlen.

Ein Club erhält eine stabile Gründungsreferenz. Der Eigentümer führt eine signierte Kette für Rollen und Eigentümerwechsel. Ein Wechsel verlangt eine nachprüfbare Übergabe und Annahme; Club-ID und historische Daten bleiben erhalten. Admins und Turnierleiter bekommen begrenzte Aufgaben. Ihre Veröffentlichungen verweisen auf die gültige Berechtigung.

Für umstrittene Reihenfolgen gilt keine Auswertung nach bloßer Ankunftszeit oder höchstem Zeitstempel. Befehle enthalten den erwarteten Vorgänger. Zwei konkurrierende Nachfolger erzeugen einen sichtbaren Konflikt. Die zuständige Rolle veröffentlicht eine explizite Auflösung. Teilnehmerclients prüfen diese Entscheidung.

Mehrere Administratoren können unterschiedliche Aufgaben erledigen. Änderungen derselben Auslosung, Mitgliedschaft oder Board-Zuweisung müssen dagegen dieselbe bestätigte Basis verwenden. Ein Club kann für einen Abend einem bestimmten Organisator die Entscheidungshoheit übertragen; ein Server erfindet diese Befugnis nicht selbst.

Mitgliedschaftsrechte und tatsächliche Inhaltszugriffe werden getrennt geprüft. Das Entfernen eines Mitglieds verhindert neuen Zugriff; bereits gelesene Daten lassen sich nicht zurückholen. Bei privaten Clubs werden neue Inhalte unter erneuerten Schlüsseln verteilt.

Es gibt keine heimliche Identitätsverschmelzung. Ein Profilwechsel kann durch beide Identitäten bestätigt und für BlueLine sichtbar verknüpft werden. Das ist eine App-Regel und keine globale Nostr-Schlüsselrotation. Verlorene Schlüssel lassen sich ohne vorhandene Sicherung nicht aus einem Anzeigenamen rekonstruieren.

## Gemeinsame Spiele und Zuschauer

Ein Spiel kann auf einem Gerät mit bis zu sechs Personen bleiben. Zusätzlich kann jeder Spieler seinen Platz vom eigenen Handy bestätigen. Ein öffentlicher Profil-QR enthält nur öffentliche Profilinformationen und gegebenenfalls Relay-Hinweise; ein Wiederherstellungs-QR ist ein anderer, geschützter Vorgang. [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md)

Einladungen besitzen einmalige oder begrenzt verwendbare Tokens, Ablaufzeit und einen klaren Zweck: teilnehmen, zuschauen oder schreiben. Wer nur zuschaut, erhält keine Schreibrechte. Ein kurzer Raumcode hilft beim Finden; er allein ermächtigt nicht zum Bearbeiten.

Pro Match gibt es einen aktiven Schreiber. Üblicherweise ist das das Tablet am Board. Die Übergabe an ein anderes Gerät wird explizit bestätigt und erhöht die Sitzungsversion. Alte Schreibsitzungen sind danach ungültig. Bei Offline-Konflikten werden zwei Schreibzweige erhalten und beim Zusammenführen zur Klärung angezeigt.

Bei externen Signern wird nicht jeder Dart mit einem Dialog bestätigt. Stattdessen kann das Profil ein temporäres Geräte-Schlüsselpaar gezielt für dieses Match autorisieren. Das ist eine Berechtigung unseres Dart-Schemas; wir setzen keine allgemein unterstützte Schlüsseldelegation voraus. Die Befugnis umfasst keine Zahlungen und keine Profiländerungen.

Die lokale Spielengine berechnet jedes Ergebnis weiterhin selbst. Für die Live-Ansicht werden kleine geordnete Aktualisierungen gebündelt, beispielsweise pro Aufnahme. Ein abrufbarer Spielstand mit Versionsnummer erlaubt den Wiedereinstieg; ein alleiniger Strom flüchtiger Events wäre unzureichend.

Die Zuschaueransicht funktioniert über einen Link, auf Handy und großem Bildschirm. Sie zeigt letzten Aktualisierungszeitpunkt und Verbindungsunterbrechung. Ziel bei guter Verbindung: Aktualisierung innerhalb von zwei Sekunden, ohne Garantie über fremde Netze.

Spieler bestätigen bei Bedarf das fertige Ergebnis vom eigenen Gerät. Bestätigungen sind für Clubregeln nutzbar, bleiben bei einem privaten Freundschaftsspiel optional. Eine Signatur beweist eine Erklärung, nicht den realen Einschlag des Darts.

## Historie Statistiken und Migration

Die bestehende Logik in `lib/game/engine.ts` bleibt die fachliche Grundlage. Aktuelle Spielstände besitzen bereits IDs und Wurflogs. Die bisherige Historie in `lib/leaderboard.ts` enthält dagegen nur reduzierte Ergebnisdaten und fasst Spieler nach Namen zusammen. Diese Einschränkung wird beim Import sichtbar berücksichtigt.

Wir führen stabile Spieler-IDs, optionale öffentliche Identitäten und vollständige neue Matcharchive ein. Lokal ungesicherte Gastspieler bleiben eigenständig. Zwei gleichnamige Personen werden nicht zusammengeführt.

Migration erfolgt versioniert und transaktional: bestehenden localStorage-Inhalt sichern, prüfen, in IndexedDB übernehmen, Ergebnis vergleichen und erst nach Erfolg den neuen Speicher aktivieren. Ein laufendes Spiel überlebt den Wechsel. Der Rückweg muss auch die seit dem Upgrade neu entstandenen Spiele erhalten. Eine alte Version darf nicht einfach auf einen veralteten Snapshot zurückgesetzt werden. Wenn eine verlustfreie Rückmigration nicht unterstützt wird, bleibt der neue Datenstand geschützt und es wird ein kompatibler Reparaturweg geliefert. Beide Wege werden vor dem Rollout an realistischen Datenbeständen geprüft.

Alte Ergebnisse behalten ihre vorhandenen Summen. Nicht gespeicherte Würfe, Checkoutdetails oder Teilnehmernachweise werden nicht nachträglich erfunden. Frühere Namensgruppen können Nutzer bewusst zuordnen; sie gelten weiterhin als importierte, unbestätigte Historie.

Private Historie enthält den eigenen Ergebniskatalog und notwendige Spielinformationen. Gemeinsam bestätigte Resultate sind referenzierbare Originale; persönliche Kopien machen den jeweiligen Spieler nicht zum ursprünglichen Autor.

Statistiken werden aus gültigen Ergebnissen abgeleitet: Siege, Legs, Sets, 3-Dart-Average für X01, Checkoutquote soweit tatsächlich messbar, höchste Finishes, Bestleistungen und direkte Vergleiche. Cricket und Around the Clock erhalten eigene passende Kennzahlen. Fehlende Informationen bleiben unbekannt statt null. Für Summen, Quoten und Durchschnittswerte werden Zähler und Nenner aus den gültigen Rohdaten zusammengeführt; unterschiedlich große Spiele werden nicht durch bloßes Mitteln ihrer Prozentwerte oder Averages gleich gewichtet. Rundung erfolgt erst für die Anzeige. Bezugsgröße, Busts, Korrekturen und fehlende Erfassung erhalten explizite Testbeispiele.

Filter umfassen Spielart, Zeitraum, Club und Saison. Korrigierte oder aufgehobene Ergebnisse werden konsistent neu berechnet. Ranglisten benennen ihren Geltungsbereich und Bestätigungsstatus; sie behaupten keine manipulationssichere Weltrangliste.

Löschungen erhalten lokale Tombstones, damit ein späterer Sync Daten nicht unbemerkt zurückholt. Öffentlich bereits verteilte Daten können nur zur Löschung angefordert werden. Vollständige Entfernung bei jedem fremden Empfänger ist nicht garantiert. [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md)

## Profilansicht und verständliche Statistiken

Die Profilseite ist eine sportliche Visitenkarte. Sie wird über den Namen eines Gegners, die Clubmitglieder, eine Turnierpaarung oder einen Profil-Link geöffnet. Öffentliche Profile lassen sich ohne Anmeldung ansehen. Bei einem Gast öffnen wir dessen lokale Spieleransicht; wir erfinden kein öffentliches Profil.

Der erste Bildschirm zeigt Avatar, Anzeigename, optional einen kurzen Clubhinweis und höchstens drei Kennzahlen. Standard für X01: „Spiele“, „Gewonnen“ und „Ø Punkte pro 3 Darts“. Darunter folgen bis zu drei selbst gewählte Auszeichnungen und die letzten drei sichtbaren Spiele. Der Zeitraum steht bei den Zahlen. Lange Beschreibungen, vollständige Historie und zusätzliche Kennzahlen öffnen sich erst über klar beschriftete Links.

| Ansicht | Vorrangige Aktion | Zusätzlicher Inhalt |
| --- | --- | --- |
| Eigenes Profil | „Profil teilen“ | „Bearbeiten“; unaufdringlicher Hinweis auf eine fehlende Sicherung |
| Fremdes Profil | „Zum Spiel hinzufügen“, wenn gerade Spieler gesucht werden | Sonst „Profil teilen“; „Gratulieren“ mit optionaler Zahlung als nachgeordnete Aktion |
| Statistik | Spielart und Zeitraum wählen | Verlauf, Bestleistungen, Datenbasis und weitere Filter |
| Spiele | Ein Ergebnis öffnen | Gegner, Datum, Spielart und Ergebnis; anschließend Leg- und Wurfdetails |
| Auszeichnungen | Eine Auszeichnung ansehen | Bedeutung, Aussteller, erreicht am, zugehöriges Ergebnis und Sichtbarkeit |
| Profilverwaltung | Gesuchten Vorgang wählen | Geräte, Sicherung, Zahlungen und Einstellungen auf getrennten Unterseiten |

„Mein Profil“ und die öffentliche Ansicht unterscheiden sich sichtbar: „So sehen andere dein Profil“ bietet eine echte Vorschau der veröffentlichten Daten. Private Spiele und geschlossene Clubzugehörigkeiten werden weder als Einträge noch über unbeabsichtigte Summen verraten. Eine absichtlich freigegebene persönliche Gesamtstatistik ohne öffentliche Einzelbelege wird als „Vom Spieler geteilt“ gekennzeichnet. Öffentliche Spielstatistiken lassen sich dagegen auf ihre sichtbaren Ergebnisse zurückführen. Kontostand, Sicherungsstatus und Geräte erscheinen ausschließlich im eigenen Verwaltungsbereich.

Kennzahlen müssen vergleichbar sein. Jede Auswertung nennt Spielart, Zeitraum und Anzahl berücksichtigter Spiele; Regelvarianten und Bestätigungsstatus bleiben im Detail nachvollziehbar. X01, Cricket und Around the Clock erhalten eigene Ansichten. Werte aus unterschiedlichen Regeln werden nicht zu einer scheinbar einheitlichen Leistung vermischt. „Noch keine Spiele“, „Keine freigegebenen Spiele“, „Daten noch nicht vollständig geladen“ und „Kennzahl nicht erfasst“ sind verschiedene Zustände. Unbekannte Werte werden als „—“ mit Erklärung dargestellt. Trends benötigen eine ausreichende, benannte Datenbasis; kleine Stichproben werden nicht als sichere Leistungsentwicklung verkauft.

Öffentliche Profilansichten laden zuerst Name und Zusammenfassung, danach Historie und Bilder seitenweise. Bei fehlenden Relays bleibt die zuletzt geladene Ansicht mit Zeitstand lesbar. Gleiche Anzeigenamen lassen sich über Avatar, Clubkontext und optional die Profilkarte unterscheiden; Namenssuche wird nie zum Identitätsbeweis. Eine globale vollständige Spielersuche wird ohne passenden Index nicht versprochen.

Diese Aufteilung ist eine BlueLine-Gestaltungsentscheidung. Als Vorbild dient die Trennung von Sportprofil, Statistiken, Auszeichnungen und Sichtbarkeitsregeln bei Strava, ohne dessen gesamte soziale Oberfläche zu übernehmen. [Strava: Profil und Sichtbarkeit](https://support.strava.com/en-us/articles/15401967-what-are-strava-s-profile-page-privacy-controls)

## Clubs und Saisons

Ein Club enthält Name, optionales Bild, Beschreibung, Sichtbarkeit, Mitglieder, Einladungen, Rollen, Kalender, Spielhistorie und Saisons. Standardmäßig ist ein neuer Club geschlossen; die Veröffentlichung eines öffentlichen Clubs ist eine bewusste Auswahl.

Rollen: Eigentümer, Administrator, Turnierleiter, Mitglied und gegebenenfalls Gast. Eine konkrete Rechte-Matrix legt fest, wer einladen, aufnehmen, Regeln ändern, Ergebnisse freigeben und Rollen vergeben darf. Ein NIP-51-Eintrag allein erfüllt keine dieser Bedingungen.

Einladungen funktionieren per Link oder QR. Nutzer können Informationen ansehen, bevor sie ein Profil erstellen. Ein Beitritt wird auf beiden Seiten nachvollziehbar: Anfrage oder angenommene Einladung und Aufnahme gemäß Clubregeln. Ablehnung, abgelaufener Link, voller Club, erneuter Beitritt, Austritt und Ausschluss sind vollständige Abläufe.

Für Spieltage bietet der Club gespeicherte Spielerrunden, Regelvorlagen und eine schnelle Matchanlage. Gäste können mitspielen. Gastplätze lassen sich später kontrolliert mit einem Profil verbinden, ohne alte Bestätigungen umzuschreiben.

Saisonregeln werden vor Beginn versioniert festgelegt: Spielarten, Punktevergabe, erforderliche Ergebnisbestätigungen, Mindestteilnahme und Gleichstandsregeln. Eine nachträgliche Regeländerung braucht einen sichtbaren Beschluss beziehungsweise eine neue Saisonversion; sie verändert keine Rangliste stillschweigend.

Private Mitgliederlisten, Einladungen und geschlossene Ergebnisse werden verschlüsselt und zugriffsbeschränkt gespeichert. Für die zunächst geplanten Clubgrößen werden pro Objekt zufällige Inhaltsschlüssel verwendet und autorisierten Personen über geprüfte Verschlüsselungsbausteine zugänglich gemacht. Das genaue Verschlüsselungsdesign erhält eine Prüfung; wir erfinden kein eigenes kryptografisches Verfahren. [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md)

Entfernte Mitglieder erhalten keine neuen Inhaltsschlüssel. Backups enthalten die notwendigen Schlüssel für weiterhin erlaubte historische Daten. Sichtbare Metadaten werden minimiert; Inhaltsverschlüsselung allein verspricht keine vollständige Anonymität.

Clubexport enthält Definition, Rollenhistorie, Saisonregeln, Ergebnisse und Kalenderreferenzen. Ein Eigentümerwechsel oder Wechsel des Speicherdienstes muss ohne Neuerfassung des Clubs möglich sein.

### Gestaltung der Clubansichten

„Clubs“ beginnt mit „Meine Clubs“ und Einladungen. Eine Karte enthält Name, Bild, Mitgliedschaftsstatus, nächsten Termin und höchstens eine passende Aktion. Darunter stehen „Einladung öffnen“ und „Club gründen“. Eine spätere öffentliche Entdeckung nutzt ausdrücklich veröffentlichte Clubs und einen definierten Index; geschlossene Clubs werden darüber nicht auffindbar.

Ein Club öffnet mit einer kurzen Übersicht: nächster Clubabend oder laufendes Turnier, eigene nächste Aufgabe und aktuelle Saison. Detailbereiche heißen „Spieler“, „Tabelle“ und „Termine & Turniere“. Die Rolle bestimmt die Aktionen: Mitglieder können zusagen und ein Spiel starten; die Leitung kann Einladungen und offene Ergebnisse bearbeiten. Organisatoren wechseln gezielt in „Club verwalten“. Rollenverwaltung wird nicht zwischen normale Spieleraktionen gestreut.

| Situation | Sichtbarer Zustand und nächste Aktion |
| --- | --- |
| Einladung vor Beitritt | Name, Beschreibung, Veranstalter und freigegebene Eckdaten; „Beitreten“ |
| Aufnahme noch offen | „Deine Anfrage wartet auf Bestätigung“; zurück zum Spielen |
| Normaler Clubabend | Termin, Zusagen, gespeicherte Spielerrunde; „Spiel starten“ |
| Aktive Saison | Eigene Tabellenzeile, Punktestand, gespielte Begegnungen; „Ganze Tabelle“ |
| Mitglied ansehen | Name öffnet das Spielerprofil mit erlaubten Statistiken |
| Verwaltung | Offene Aufgaben zuerst; anschließend Mitglieder, Rollen, Saisonregeln und Export |
| Archivierter Club | Historie bleibt lesbar; neue Spiele werden nicht versehentlich zugeordnet |

Die Clubgründung fragt zunächst nur Name, optionale Beschreibung und Sichtbarkeit ab. „Nur auf Einladung“ ist vorbelegt und erklärt. Danach wird direkt eine Einladung angeboten. Bild, Saison, Ranglistenregeln und Ämter können im passenden Moment ergänzt werden. Eine Saison wird vor dem ersten gewerteten Spiel ausdrücklich eingerichtet; freie Clubspiele dürfen vorher stattfinden.

Die Tabelle zeigt standardmäßig Rang, Name, Spiele und Punkte. Gleichstand und Wertungsregeln sind über „So wird gewertet“ erreichbar; Detailspalten erscheinen bei Bedarf. Eigene Zeile und nächste Begegnung werden hervorgehoben, ohne ungeprüfte Ergebnisse wie bestätigte Wertung aussehen zu lassen. Auf dem Handy bleiben Name und Kernergebnis lesbar; am großen Bildschirm kann die vollständige Tabelle erscheinen.

Leere, wartende und eingeschränkte Ansichten sind mitgeplant: noch keine Mitglieder, keine Saison, keine Einladung mehr gültig, Rolle entzogen, Daten offline, Termin abgesagt. Jede Ansicht erklärt einen sinnvollen nächsten Schritt. „Keine Berechtigung“ allein ist keine fertige Nutzerführung.

## Turniere und Organisation mehrerer Boards

Ein Turnier kann einem Club gehören oder eigenständig organisiert werden. Der Ablauf lautet: Entwurf, Anmeldung, Check-in, Auslosung, laufende Runden, Abschluss oder Abbruch.

Der Gesamtumfang umfasst Einzel-KO, Doppel-KO, Jeder-gegen-jeden sowie Gruppenphase mit anschließendem KO. Die Einführung darf nach Formaten gestaffelt werden; vor Abschluss des Gesamtvorhabens ist jedes vereinbarte Format mit seinen Randfällen umgesetzt.

Die Turnierregeln enthalten Spielart, X01-Optionen, Legs und Sets, Startregel, Teilnehmerlimit, Seeding, Freilose, Gleichstandsverfahren und Finalregeln. Für Doppel-KO wird ein möglicher Final-Reset ausdrücklich definiert. Auslosung und Zufallsgrundlage werden gespeichert, damit dasselbe Teilnehmerfeld reproduzierbare Paarungen ergibt.

Anmeldung, Zusage und Check-in sind unterschiedliche Zustände. Organisatoren dürfen Spieler ohne Profil führen. Warteliste, Absage, Nichterscheinen, Rückzug, Disqualifikation und Nachmeldung vor Auslosung sind vorgesehen. Nach Start verändern wir Teilnehmerfelder nur über erklärte Veranstalterentscheidungen.

Boards haben Namen und eigene eingeschränkte Zugänge. Ein Match wird genau einem aktiven Board beziehungsweise Schreiber zugewiesen. Ein Board zeigt als nächsten Schritt Start, Ergebnis prüfen und nächstes Match. Niemand muss an jedem Board den Hauptzugang des Veranstalters benutzen.

Die Turnierleitung sieht laufende Matches, freie Boards, wartende Spieler und zu bestätigende Ergebnisse. Ein Resultat rückt erst nach der für dieses Turnier geltenden Freigabe weiter. Korrekturen an früheren Runden markieren abhängige Paarungen als betroffen; bereits begonnene Folgespiele werden nicht still neu besetzt.

Rundenabschluss und Fortschritt erfolgen mit Vorgängerprüfung und Konfliktbehandlung. Offline darf ein Board sein zugewiesenes Spiel beenden; Auslosung und weitere globale Zuweisungen werden bei fehlender bestätigter Basis zurückgestellt. Die Turnierleitung kann die autoritative Organisation gezielt auf ein Gerät übertragen.

NIP-52 liefert öffentliche Termine, Kalender und Zu- beziehungsweise Absagen. Sportliche Registrierung, Check-in und Turnierbaum liegen im eigenen Schema. Wiederkehrende Clubabende werden als einzelne Termine erzeugt. [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md)

Link und QR öffnen Anmeldung oder Zuschaueransicht. Zusätzlich gibt es druckbare Paarungen beziehungsweise eine PDF-Ansicht und einen CSV-/JSON-Export. Als erste verbindliche Lasttestgröße planen wir 128 Teilnehmende und 16 Boards; höhere Grenzen werden erst nach Messung freigegeben.

### Gestaltung der Turnieransichten

Die Turnierkarte beantwortet vor dem Öffnen: Was wird gespielt, wann und wo, wie viele Plätze sind frei und ist die Anmeldung offen? Die Detailseite zeigt zuerst Titel, Veranstalter, Spielregeln in einem Satz, Startzeit mit Zeitzone, Ort oder Online-Hinweis und den zur Phase passenden nächsten Schritt. Vollständige Regeln sind vor Anmeldung lesbar. Ein vereinbarter Einsatz steht getrennt und verständlich dabei; eine Wallet ist keine Teilnahmevoraussetzung.

| Phase | Ansicht für Spieler | Ansicht für die Turnierleitung |
| --- | --- | --- |
| Anmeldung | „Anmelden“, „Angemeldet“ oder „Warteliste“ | Teilnehmerzahl und offene Anfragen |
| Check-in | „Ich bin da“ und Check-in-Frist | Anwesend, fehlt, Gast hinzufügen |
| Vorbereitung | „Paarungen werden vorbereitet“ | Teilnehmer prüfen, Setzung und Auslosung als Vorschau |
| Laufendes Turnier | „Dein nächstes Spiel“ mit Gegner, Board und Aufrufstatus | Freie Boards, wartende Paarungen, laufende Spiele, offene Ergebnisse |
| Zwischen Runden | Nächster Gegner oder verständlicher Wartezustand | Abhängigkeiten und betroffene Korrekturen |
| Beendet | Eigene Platzierung, Ergebnis und erreichte Auszeichnung | Abschluss prüfen, Auszeichnungen vergeben und Export |
| Unterbrochen oder abgesagt | Grund und nächste bekannte Information | Fortsetzen beziehungsweise nachvollziehbar abbrechen |

Spieler sehen zuerst ihre nächste Aufgabe. Darunter öffnen „Spiele“, „Turnierbaum / Gruppen“ und „Infos“ die Gesamtübersicht. Auf kleinen Displays ist eine nach Runden gegliederte Begegnungsliste die Standardansicht; der Turnierbaum ist zusätzlich zoombar, mit „Zu meinem Spiel“. Ein breiter Baum darf nicht der einzige Zugang zu Gegner und Board sein. Es werden nur tatsächlich bekannte Aufrufe und Zeiten angezeigt; Schätzungen werden als solche benannt.

Die Turnierleitung erhält einen eigenen Arbeitsbereich mit den Bereichen „Teilnehmer“, „Boards“, „Ergebnisse“ und „Einstellungen“. Im laufenden Betrieb stehen offene Aufgaben oben. Vor Auslosung, Start und einer Änderung mit Auswirkungen auf Folgerunden erscheint eine verständliche Vorschau der Folgen. Änderungen sind innerhalb zulässiger Grenzen rücknehmbar; laufende Partien werden nie durch einen stillen Neulauf überschrieben.

Die Anlage erfolgt in vier kurzen Schritten: Eckdaten; Format und Spielregeln; Teilnehmer und Boards; Vorschau. Presets erklären die vier vereinbarten Formate in Alltagssprache. Gäste werden einzeln oder gesammelt per Namensliste aufgenommen und können später ihren Platz zuordnen. Entwürfe speichern automatisch lokal; vor Veröffentlichung zeigt die App Sichtbarkeit und noch fehlende Pflichtangaben. Anmeldung, Beitritt und Ergebnisanzeige behalten ihren Kontext bei einem nötigen Profilwechsel.

Das Board-Gerät zeigt ausschließlich aktuelle Paarung, Scoreeingabe und Ergebnisübergabe. Die Zuschauer- und TV-Ansicht zeigt freigegebene Scores, Runde und nächsten Aufruf in großer Schrift. Zahlungsdaten, Verwaltungsaktionen und vertrauliche Teilnehmerinformationen gehören nicht dorthin. Zuschauer können öffentliche Profile öffnen; anschließend führt „Zurück zum Turnier“ an dieselbe Stelle.

Das Muster, Gäste per Anzeigename zu führen und Teilnehmerverwaltung von den Paarungen zu trennen, ist bei Challonge dokumentiert. Die konkrete mobile Darstellung und Rollenaufteilung oben sind unser Entwurf für den Dartbetrieb. [Challonge: Teilnehmerverwaltung](https://kb.challonge.com/en/article/participant-management-1m6ooqe/)

## Auszeichnungen gewinnen und im Profil zeigen

Im Produkt heißen Badges „Auszeichnungen“. Sie erscheinen nach einem abgeschlossenen Spiel oder Turnier als kleine, wegklickbare Erfolgskarte. Das Spiel wird dafür nicht unterbrochen. Im Profil stehen höchstens drei ausgewählte Auszeichnungen; „Alle ansehen“ öffnet die Sammlung. Unbekannte Aussteller erzeugen keine aufdringlichen Benachrichtigungen.

| Kategorie | Beispiel | Grundlage der Vergabe |
| --- | --- | --- |
| Persönlicher Meilenstein | Erste 180, Finish ab 100, zehn abgeschlossene Spiele | Vollständige passende Spieldaten; bei rein lokaler Historie zunächst „Auf diesem Gerät erreicht“ |
| Cluberfolg | Saisonsieger, regelmäßige Teilnahme | Vorab definierte Saisonregeln und bestätigte Clubergebnisse |
| Turniererfolg | Sieger, Finalist, Teilnahme | Freigegebener Abschluss der richtigen Veranstaltung |
| Anerkennung | Helfer beim Clubabend, besondere Leistung | Bewusste Vergabe durch einen benannten, berechtigten Aussteller |

Jede Detailansicht erklärt Bedeutung, Bedingung, Aussteller, Zeitpunkt und vorhandenen Nachweis. Erreichbare Auszeichnungen stehen in einer eigenen, kleinen Übersicht mit verständlichem Fortschritt, beispielsweise „7 von 10 Spielen“. Private lokale Meilensteine sind keine vom Club geprüften Leistungen. Gäste können sie lokal erreichen; eine öffentliche Vergabe folgt erst nach bewusster, nachvollziehbarer Zuordnung zum Profil.

Das aktuelle NIP-58 verwendet Definitionen mit Kind 30009, Vergaben mit Kind 8, die persönliche Profilauswahl mit Kind 10008 und benannte Sammlungen mit Kind 30008. Auszeichnung und Anzeigeentscheidung sind getrennt. Das frühere Profilformat mit Kind 30008 und `d=profile_badges` bleibt lesbar und wird kontrolliert migriert; bestehende Auszeichnungen anderer Apps werden erhalten. [Aktuelles NIP-58](https://github.com/nostr-protocol/nips/blob/master/58.md)

Die Umsetzung läuft vollständig über nostr-core. Der geprüfte Helfer erzeugt bisher das ältere Profilformat; die Umstellung ist deshalb eine konkrete Bibliotheksaufgabe. Die dort ebenfalls angebotenen Anfragen und Ablehnungen mit 30058/30059 sind ausdrücklich eine Entwurfserweiterung. Unsere automatische Erfolgsvergabe und Profilanzeige hängen nicht von deren Verbreitung ab. [nostr-core: Badge-API](https://github.com/nostr-core-org/nostr-core/blob/02ab4c8a14af55f48de917bd7d6b2285c5cfb6bb/docs/api/nip58.md)

BlueLine führt einen versionierten Auszeichnungskatalog. Regeln wie Spielart, vollständige Datenbasis, Saison und erforderliche Bestätigungen sind vor der Vergabe festgelegt. Eine neue Bedingung erhält eine neue Katalogversion; Änderungen am Bild schreiben die damalige Leistung nicht um. Ein stabiler Vergabeschlüssel aus Empfänger, Auszeichnung und Anlass verhindert doppelte Vergaben bei wiederholter Synchronisierung.

Für automatische BlueLine-Meilensteine wird ein eigener Ausstellerdienst mit begrenztem Auftrag geplant: Er prüft die freigegebenen Ergebnisnachweise und signiert nur passende Vergaben. Club- und Turnierauszeichnungen tragen einen benannten Veranstalter als Aussteller. Definition und Vergabe müssen zum selben berechtigten Aussteller gehören; ein Schreiber-Tablet erhält dafür keinen allgemeinen Hauptschlüssel. Betrieb, Sicherung, Rate-Limits und Schlüsselwechsel dieses Dienstes gehören zu P0 und P7a. Der Dienst hält weder Nutzerhauptschlüssel noch Wallet-Zugänge. Eine Signatur bestätigt Herkunft und Prüfung nach den vereinbarten Regeln; sie beweist keinen physischen Dartwurf.

Vor Anzeige werden Signaturen, Definition, Aussteller, Empfänger, zusammengehörige Referenzen und gegebenenfalls die Clubberechtigung geprüft. Der vorhandene `validateBadgeAward`-Helfer prüft im untersuchten Code nur Kind und Definitionsreferenz; er ersetzt diese vollständige Prüfung nicht. Generische Prüfungen werden in nostr-core ergänzt, fachliche Vergaberegeln bleiben bei BlueLine. [Geprüfter Badge-Quellcode](https://github.com/nostr-core-org/nostr-core/blob/02ab4c8a14af55f48de917bd7d6b2285c5cfb6bb/src/nip58.ts)

„Im Profil zeigen“, „Ausblenden“ und „Anordnen“ sind einfache Nutzeraktionen. Vor einer öffentlichen Vergabe aus einem privaten Spiel oder geschlossenen Club wird die sichtbare Information erklärt und freigegeben; sonst bleibt der Erfolg privat. Die spätere Auswahl im Profil allein macht eine bereits öffentliche Vergabe nicht wieder privat. Die globale Profilauswahl wird nur nach Lesen und Zusammenführen verändert; nicht entschlüsselbare Listenteile bleiben geschützt.

Korrigierte oder aufgehobene Resultate lösen eine erneute fachliche Bewertung aus. BlueLine markiert dadurch ungültige Vergaben nachvollziehbar und bittet den Aussteller gegebenenfalls um eine Löschanforderung. Die App behauptet keinen netzweit garantierten Widerruf unveränderlicher Awards; eine Denial-Entwurfserweiterung ist ebenfalls kein solcher Widerruf. Badge-Daten, Auswahl, Aussteller und Nachweise gehören zum Export und Gerätewechsel. Auszeichnungen lösen keine Zahlung aus und sind keine Voraussetzung zum Spielen.

## Direkte Zahlungen und vereinbarte Einsätze

Zahlungen sind eine optionale Komfortfunktion für persönliche Vereinbarungen. Ein Beispiel: „501, best of 3, Verlierer zahlt 500 sats“. Die Spieler können den Betrag vorab im Spiel vermerken oder erst nach dem Ergebnis bezahlen. Die Entscheidung fällt vor Ort; BlueLine vermittelt den direkten Zahlungsvorgang.

Nach dem Spiel lautet die Aktion beispielsweise „500 sats an Mia zahlen“. Empfänger und Betrag werden vor dem Auslösen angezeigt. Freiwillige Zahlungen können außerdem über „Gratulieren“ angeboten werden. Es gibt keine automatische Belastung durch einen Gewinn, eine Korrektur oder eine Servernachricht.

NWC ist die verbindliche Wallet-Anbindung für sämtliche integrierten Zahlungen. Die App verwendet ausschließlich die `NWC`-Klasse und Zahlungsbausteine von nostr-core. Dokumentiert sind unter anderem `getInfo`, `payInvoice`, `makeInvoice`, `lookupInvoice` und Zahlungsbenachrichtigungen. Die tatsächlich erlaubten Funktionen werden pro Verbindung geprüft. Ein neues Spielerprofil ist noch keine Wallet und enthält kein Guthaben. [nostr-core: NWC](https://nostr-core.netlify.app/api/nwc)

„Zahlungen einrichten“ erscheint erst bei Nutzung. Der Ablauf lautet: „Wallet verbinden“ → „QR scannen“ oder „Verbindung einfügen“ → verfügbare Rechte und gegebenenfalls Ausgabenlimit prüfen → „Verbunden“. Auf demselben Handy kann ein unterstützter Wallet-Link die Einrichtung öffnen; Kopieren und Einfügen bleibt als verständlicher Ausweichweg erhalten. Wer noch keine geeignete Wallet hat, erhält eine kurze Einrichtungshilfe und kann jederzeit zum Spiel zurück. Es gibt keinen zusätzlichen Nostr-Login für Zahlungen.

Profilzugang und Wallet-Verbindung sind getrennte Berechtigungen. Die NWC-Verbindungsdaten werden lokal verschlüsselt gespeichert und gelangen weder in öffentliche Events noch in Profil-QRs, URLs für Einladungen, Logs oder allgemeine Profilsicherungen. Ein zweites Gerät richtet Zahlungsrechte bewusst neu ein. „Verbindung entfernen“ trennt die App; eine verbleibende Freigabe in der Wallet wird verständlich erklärt und kann dort widerrufen werden. Wallet-seitige Limits werden angezeigt und genutzt, sofern unterstützt; ein lokaler UI-Wert wird nicht als tatsächlich durchgesetztes Wallet-Limit ausgegeben. [NIP-47: Verbindungen und getrennte Schlüssel](https://github.com/nostr-protocol/nips/blob/master/47.md)

### Bezahlen und Empfangen im Spiel

Nach einem Ergebnis öffnet „Bezahlen“ ein kompaktes Fenster mit Empfänger, Betrag, Wallet und einer eindeutig beschrifteten Bestätigung, etwa „500 sats an Mia zahlen“. „sats“ wird bei Bedarf als kleine Bitcoin-Einheit erklärt. Eine optionale Euro-Näherung nennt ihren Zeitstand; verbindlich ist der bestätigte Betrag in sats. Gebühren beziehungsweise der geltende Gebührenrahmen werden sichtbar, soweit die Wallet sie liefert. Fehlende Gebührenangaben werden nicht als null dargestellt.

„Empfangen“ erzeugt über die verbundene Wallet eine Rechnung für den gewählten Betrag. Sie lässt sich dem richtigen Match beziehungsweise Spieler direkt zuordnen, als Zahlungs-QR zeigen oder teilen. Der Zahler kann sie innerhalb von BlueLine mit seiner NWC-Verbindung bezahlen. Bei einer Übermittlung zwischen Spielergeräten werden Empfänger, Rechnung, Betrag, Ablaufzeit und Bezug geprüft; die Anfrage wird über den vorgesehenen privaten App-Kanal mit nostr-core transportiert. Eine fremde Nachricht löst niemals automatisch `payInvoice` aus.

Die Empfangsseite zeigt „Warte auf Zahlung“ und erst nach bestätigtem Eingang „Erhalten“. Benachrichtigungen beschleunigen den Ablauf; nach Wiederverbindung wird der Status erneut abgefragt. Bereits erstellte, noch gültige Rechnungen bleiben zahlbar, solange die Wallet sie bedienen kann. Für eine neue Rechnung muss die Wallet erreichbar sein. Ohne laufendes Empfängergerät beziehungsweise abrufbare Empfangsadresse wird kein sofortiger Empfang versprochen; die UI bietet „Rechnung teilen“ oder einen späteren Versuch.

Die Verbindung unterscheidet „Bezahlen möglich“, „Empfangen möglich“ und gegebenenfalls „Beides“. Fehlendes `make_invoice`, fehlende Berechtigung oder ein erschöpftes Budget führen zu einer konkreten Hilfsaktion. Ohne `get_balance` wird kein erfundener Kontostand angezeigt. Ein gemeinsames Clubtablet kann eine Rechnung anzeigen, bekommt aber keine Wallet-Berechtigung eines Spielers. Das Bezahlen erfolgt auf dessen persönlichem Gerät.

NWC-Verbindungs-QR, Rechnungs-QR, Profil-QR und Gerätekopplung haben verschiedene Überschriften und Prüfregeln. Ein Scanner erkennt den Inhalt und erklärt zuerst den passenden Vorgang. Ein Wallet-Verbindungscode wird nie als öffentlicher Zahlungscode zum Teilen angeboten.

### Freiwillige Zaps

NIP-57 bleibt Teil des Umfangs: Bei einer kompatiblen Empfangsadresse erstellt nostr-core die Zap-Anfrage, ruft die Rechnung ab und bezahlt sie über NWC; der Empfangsdienst veröffentlicht anschließend den Beleg. Eine reine NWC-Verbindung garantiert keine solche Adresse. Ein mitgeliefertes `lud16` wird geprüft und nur nach bewusster Freigabe ins öffentliche Profil übernommen. Ohne Zap-fähigen Empfang funktioniert die direkte Rechnungszahlung weiterhin; sie wird nicht fälschlich als öffentlich bestätigter Zap bezeichnet. [NIP-57: Zahlungsablauf](https://github.com/nostr-protocol/nips/blob/master/57.md)

„Gratulieren“ öffnet zuerst die Möglichkeit einer freiwilligen Zahlung; Beträge und öffentliche Sichtbarkeit sind vor Bestätigung klar. Das bloße Antippen eines Erfolgs oder einer Auszeichnung zahlt nichts. Ein bezahlter Betrag und ein noch fehlender öffentlicher Zap-Beleg sind getrennte Zustände: „Bezahlt · Beleg wird noch geladen“ darf niemals eine erneute Zahlung anstoßen.

Vor der Anzeige eines bestätigten Zap-Belegs prüfen wir Signatur, erwarteten Belegaussteller, Empfänger, Betrag, Rechnung und Bezug zur Anfrage. Wiederholte Relay-Zustellungen ergeben keinen zweiten Zahlungseintrag. Der Belegaussteller bleibt ein Vertrauensbestandteil; ein Zap-Beleg beweist keinen sportlichen Spielausgang.

Zustände: nicht eingerichtet, bereit, Bestätigung erforderlich, Zahlung läuft, bezahlt beziehungsweise erhalten, abgebrochen, fehlgeschlagen oder Status unbekannt. Ein dauerhaftes Zahlungsjournal verbindet Nutzeraktion, Rechnung, Payment-Hash und Wallet-Rückmeldung. Bei Timeout wird zunächst geprüft; wir senden nicht blind eine zweite Zahlung. Doppelklicks, mehrere Tabs, App-Neustart und verspätete Antworten dürfen dieselbe Aktion nicht erneut auslösen. Abgelaufene Rechnungen werden erst nach Klärung des bisherigen Status und ausdrücklicher neuer Aktion ersetzt.

Ein manueller Hinweis „vor Ort erledigt“ bleibt von technisch bestätigter Zahlung unterscheidbar. Eine spätere Spielkorrektur bucht nichts zurück. Erstattungen oder abweichende Absprachen lösen die Spieler selbst.

Bei privaten Spielen darf der Zahlungsweg nicht unbeabsichtigt Gegnerliste, Spielprotokoll oder Einsatzvereinbarung öffentlich machen. Öffentliche Zap-Belege werden in der Zahlungsansicht verständlich angekündigt; bei Bedarf erfolgt eine normale direkte Lightning-Zahlung ohne öffentlichen Spielbezug.

Die Zahlungsabnahme umfasst die NWC-Einrichtung per Scan, Einfügen und unterstütztem App-Rücksprung, direktes Bezahlen und Empfangen, fehlende Rechte, nicht erreichbare Wallet, unzureichendes Guthaben, Gebühren, Budgets, Ablehnung, Timeout nach möglicherweise erfolgreicher Zahlung, doppelte Rückmeldung und falsche Belege. Tests verwenden zunächst Simulatoren und danach ausdrücklich freigegebene Kleinstbeträge. NWC und ein geeigneter Zap-Empfangsdienst müssen für ihren jeweiligen Ablauf praktisch geprüft sein.

## Oberfläche Medien und Alltagstauglichkeit

Der bestehende Spielbildschirm bleibt auf schnelles Treffen der Eingabetasten ausgelegt. Profil, Verbindungsstatus oder Zahlungsfunktionen verdrängen keine Scores und keine Korrekturfunktion.

Die Hauptnavigation erhält „Spielen“, „Bestenliste“, „Clubs“ und „Turniere“. „Mein Profil“ ist über ein beschriftetes Avatar-Element erreichbar. Einstellungen bleiben auch als Gast ohne Profilerstellung zugänglich. Die vorhandene lokale Bestenliste wird erhalten und benennt ihren Geltungsbereich. Auf dem Handy steht die Navigation unten, auf breiten Displays seitlich; während eines Matches bleiben Score und Eingabe im Vordergrund. Einladungs- und Profillinks öffnen die richtige Detailansicht direkt. Zurückkehren erhält Filter, Scrollposition und einen laufenden Spielstand.

Die Oberfläche spricht Deutsch und Englisch mit derselben Funktionsabdeckung. Jeder Nutzertext muss beim Spielen helfen, ein Ergebnis bestätigen oder eine notwendige Handlung erklären. Eine nützliche Speicherbestätigung lautet ausschließlich „Dein Spiel ist gespeichert.“ Hintergrundabgleich, Transportwege und erneute Verbindungsversuche werden nicht kommentiert. Auch korrekte Informationen entfallen, wenn sie in diesem Moment keinen Nutzen haben. Details bleiben für ausdrücklich geöffnete Hilfe und Diagnose erreichbar.

Barrierefreiheit umfasst Tastaturbedienung, Screenreader-Beschriftungen, ausreichend große Berührungsflächen, lesbare Statusmeldungen und reduzierte Animationen. Tests decken kleine Telefone, Tablets, Querformat und die TV-Ansicht ab.

Profil-, Club- und Auszeichnungsbilder erhalten feste Seitenverhältnisse, passende Vorschaubilder und Ladeplatzhalter. Vor Upload werden Größe, Metadaten und Dateitypen geprüft; fremde SVGs oder HTML werden nicht ungeprüft inline ausgeführt. Standard ist ein lokal erzeugtes Avatarbild ohne Upload. Für Nostr-bezogenen Medientransport wird der Blossom-Baustein von nostr-core verwendet, sofern der ausgewählte Speicher diesen Weg unterstützt. Private Dateien benötigen einen tatsächlich geschützten Speicherweg; eine schwer erratbare öffentliche Bild-URL genügt nicht. Speicherreferenzen, Export und Löschverhalten werden dokumentiert.

Die App zeigt keine allgemeine Social-Media-Timeline. Persönliche Meldungen beschränken sich auf relevante Vorgänge: Einladung, Teilnahme, Ergebnisbestätigung, nächstes Match, erreichte Auszeichnung und Sicherungsproblem. Browserbenachrichtigungen werden nur nach einer erklärten Nutzeraktion aktiviert. Ein vollständiger Clubchat ist kein notwendiger Bestandteil des vereinbarten Dart-Umfangs.

### Gestaltungsprinzipien, Sprache und Zahlungssignet

Die häufigsten Aufgaben stehen auf der ersten Ebene. Zusätzliche Statistik, Regeln und Verwaltung öffnen sich über aussagekräftige Aktionen; selten benötigte Technik liegt unter „Erweitert“. Dieses Prinzip folgt der schrittweisen Offenlegung von Funktionen. Die konkrete Auswahl von drei Profilkennzahlen, Clubbereichen und Turnieraufgaben ist unser zu prüfender Produktentwurf. [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

| Im normalen Produkt | Erklärung bei Bedarf | Nur in erweiterten Informationen |
| --- | --- | --- |
| Profil verbinden | Bestehendes Profil verwenden | NIP-07, NIP-46, Amber |
| Auf anderem Gerät nutzen | Eigenes Profil sicher übernehmen | Schlüssel und Kopplungsdetails |
| Profil sichern | Zugriff nach Geräteverlust wiederherstellen | Exportformat und Speicheranbieter |
| Auszeichnungen | Erfolge und Anerkennungen | NIP-58, Aussteller-Pubkey, Event-ID |
| Wallet verbinden | Bestehende Bitcoin-Wallet für diese App freigeben | NWC / NIP-47, Verbindungseinstellungen |
| Bezahlen / Empfangen | Betrag direkt zwischen Spielern senden | Rechnung, LNURL, Zap-Beleg |
| Keine Meldung beim Hintergrundabgleich | Nur bei einer tatsächlich blockierten Handlung eine kurze, hilfreiche Rückmeldung | Relay-Diagnose und Outbox |

Der technische Name NWC bleibt im gewünschten Originalsignet sichtbar; die normale Handlungsbeschriftung lautet trotzdem „Zahlungen“ oder „Wallet verbinden“. Die Bitcoin- und NWC-Originale werden als kompakte horizontale Einheit angeordnet: Bitcoin links, NWC rechts, optisch gleich groß und eng zusammengehörig. Die Mastercard-Referenz betrifft die paarweise Gruppierung. Formen, Proportionen und Farben der Originale bleiben erkennbar; wenn sich Hintergrundflächen leicht überlappen, werden die Zeichen nicht verdeckt.

Für Bitcoin dient das verbreitete orangefarbene Original von bitboy als SVG-Grundlage. Der UX-Prototyp enthält dieses Original sowie das direkt von der offiziellen NWC-Website bezogene SVG-Signet unverändert und nebeneinander; die Quellen stehen zusätzlich im HTML. Die visuelle Paarung ist geprüft. Vor dem Produktionsimport werden die NWC-Projektvorlage, Asset-Version und Nutzungsbedingungen abschließend abgeglichen. [Bitcoin-SVG und Herkunft](https://bitcoin.design/guide/getting-started/visual-language/#update-by-bitboy), [offizielle NWC-Website](https://nwc.dev), [NWC-Designquelle](https://www.figma.com/community/file/1335050217979045629)

Das Signet wird für kleine Aktionsflächen und die größere Verbindungsansicht geprüft, jeweils in hellem und dunklem Design. Es erhält als zusammengehöriges Element eine passende Textalternative; steht dieselbe Beschriftung direkt daneben, sind die Bilder dekorativ. Logos ersetzen weder den Empfängernamen noch Betrag oder Buttontext.

Alle neuen Ansichten bleiben in der vorhandenen BlueLine-Gestaltung: konsistente Abstände, Typografie, Farbrollen und große Bedienelemente. Eine hervorgehobene Hauptaktion pro Zustand; weitere Aktionen ruhig daneben oder im Menü. Status wird immer mit Text und nicht ausschließlich mit Farbe vermittelt. Tabellen und Diagramme bekommen lesbare Alternativen. Animationen für Auszeichnungen respektieren reduzierte Bewegung.

### Verbindliches UX-Modell: nur zeigen, was gerade hilft

**„Dein Spiel ist gespeichert.“** Das ist die vollständige Rückmeldung. Kein Zusatz über einen späteren Abgleich. Vor jedem Hinweis prüfen wir: Hilft er beim aktuellen Ziel, bestätigt er eine bewusste Aktion oder verlangt er eine Entscheidung? Sonst entfällt er. Eine Meldung nach jedem Wurf würde ebenfalls stören; der erhaltene Spielstand genügt.

| Moment | Sichtbare Oberfläche | Verhalten |
| --- | --- | --- |
| App öffnen | „Spiel starten“ | Gastspiel ohne Einrichtung |
| Spiel beendet | Ergebnis und „Revanche“; optional „Deine Ergebnisse mitnehmen“ | Profilerstellung freiwillig und passend zum Moment |
| Profil anlegen | Anzeigename, Vorschau, „Profil anlegen“ | Öffentliche Angaben vor Bestätigung klar benennen; Spiele nicht ungefragt veröffentlichen |
| Eigenes Profil | Name, drei verständliche Kennzahlen, Auszeichnungen | Statistik und Verwaltung erst über gezielte Aktionen |
| Bestehendes Profil | „Von meinem anderen Gerät“, „Aus meiner Sicherung“, „Mit einer anderen App“ | Gewohnten Zugang anbieten, Technik hinter weiteren Optionen |
| Gerätewechsel | Neues Gerät zeigt Code; bisheriges Gerät scannt und bestätigt | Zielgerät und gleiche Kennung prüfen; Alternative ohne Kamera; Abbruch und abgelaufener Code verständlich behandeln |
| Clubeinladung | Club, Treffpunkt, „Dabei sein“ | Falls erforderlich Profil innerhalb dieses Ablaufs erstellen und anschließend den Beitritt fortsetzen |
| Clubabend | Nächster Termin, Teilnahme, Mitglieder und Turniere | Verwaltung nur für berechtigte Rollen |
| Laufendes Turnier | Nächster Gegner, Board, eigene nächste Handlung | Alle Begegnungen und Leitung als getrennte, gezielt geöffnete Ansichten |
| Auszeichnung | Erfolg, Anlass und Aussteller | Details bei Bedarf; Auswahl für das öffentliche Profil bewusst bestätigen |
| Zahlung | Empfänger, Betrag, Gebühren, eindeutiger Zahlbutton | Wallet-Verbindung erst beim Bedarf; persönliche Vereinbarung der Spieler, kein gemeinsamer Topf |

**Keine falschen Erfolgsmeldungen.** Die einfache Sprache ändert die technische Zusage nicht. „Gespeichert“ setzt einen bestätigten dauerhaften lokalen Schreibvorgang voraus und verspricht keine bereits vorhandene Kopie auf einem anderen Gerät. Bei einem echten Fehler lautet der Text „Dein Spiel konnte nicht gespeichert werden.“ mit einer passenden Aktion wie „Erneut versuchen“. Die Eingaben bleiben erhalten. Eine unbestätigte Zahlung bekommt „Zahlung noch nicht bestätigt“ und „Status prüfen“; keine neue Zahlung anbieten, solange der Ausgang ungeklärt ist.

Sichern, Verbinden, Teilen und Bezahlen bleiben unterscheidbar. „Dein Profil ist gesichert.“ folgt auf eine überprüfte Sicherung des Zugangs. „Dein Profil ist dabei.“ folgt auf die erfolgreiche Geräteverbindung. „Bezahlt“ folgt auf den nachgewiesenen Zahlungsabschluss. Informationen über Sichtbarkeit, Empfänger und Freigaben erscheinen dort, wo eine Entscheidung fällt. Alle übrigen Hintergrundvorgänge bleiben unsichtbar.

Die begonnene Aufgabe bleibt nach Profilerstellung, externem Zugang, Geräteverbindung und Wallet-Einrichtung erhalten. Formulareingaben, ausgewählter Club, Turnier oder Zahlungsempfänger dürfen dabei nicht verloren gehen. Zurück und Abbrechen führen an eine nachvollziehbare Stelle.

### Klickbarer erster UX-Entwurf

Der folgende Entwurf macht fünf Abläufe mit 44 Ansichten prüfbar: Spielen, Profil, Gerätewechsel, Clubs und Turniere sowie direkte Zahlungen. Helle und dunkle Ansichten sowie die beiden Originalsignets sind enthalten. Alle Daten und Aktionen sind Beispiele; es werden keine echten Profile, Sicherungen, Verbindungen oder Zahlungen erzeugt. Quellartefakt im Projekt: `docs/ux/blueline-comfort-prototype.html`.

[Klickbaren UX-Entwurf öffnen](../ux/blueline-comfort-prototype.html)

**Prüfstand des Entwurfs:** 15 Browserprüfungen erfolgreich, keine erfassten JavaScript-Laufzeitfehler; alle 44 Ansichten passen bei 360 CSS-Pixeln ohne horizontalen Überlauf, das Profil zusätzlich bei 320. Ausgewählte Screenshots wurden tatsächlich visuell geprüft. Dies sind Browserprüfungen mit emulierten Größen, keine Tests auf echten Telefonen oder mit Spielern.

**P0.02 bleibt offen.** Dieser erste Entwurf ersetzt weder die geforderten Rollen-, Leer- und Fehlerzustände noch DE/EN, echte Geräteprüfungen und die Nutzertestrunden. Passkey-Verfahren, Codekopplung, externe Zugänge und Wallet-Aktionen sind hier nur Abläufe; ihre technische Freigabe bleibt an die vorgesehenen Core-Nachweise gebunden. Die produktive Implementierung hat mit diesem Entwurf noch nicht begonnen.

### Prototypen und Nutzertests als Lieferumfang

Vor Implementierung entstehen klickbare Abläufe für Gastspiel → Profil → zweites Gerät, fremdes Profil → Statistik, Clubeinladung → Clubabend, Turnieranmeldung → Check-in → eigenes Board, Turnierleitung → Ergebnisfreigabe, Auszeichnung → Profilauswahl und Wallet verbinden → bezahlen → empfangen. Jeder Ablauf enthält mindestens Leerzustand, laufende Aktion, Erfolg, Abbruch und einen relevanten Ausfall. Entworfen wird für kleines Handy, Tablet und große Anzeige; der Turnierbetrieb wird zusätzlich als tatsächlicher Ablauf am Board durchgespielt.

Zwei formative Runden mit jeweils etwa fünf bis acht Personen prüfen die Verständlichkeit, darunter Menschen ohne Nostr-Erfahrung, Cluborganisatoren und Nutzer externer Signer. Das ist eine qualitative Prüfung, kein statistischer Wirksamkeitsnachweis. Aufgaben: ein Profil sichern, dessen öffentliche Ansicht erkennen, den nächsten Gegner und das Board finden, eine Einladung annehmen, eine Auszeichnung verstehen und einen Betrag an die richtige Person zahlen.

Als Freigabeziele gelten: Gaststart benötigt keinen zusätzlichen Pflichtschritt; Profil und nächstes Spiel sind ohne technische Erklärung auffindbar; Zahlungsbetrag und Empfänger sind vor dem Auslösen eindeutig; kein Tester verwechselt eine Sicherung, einen öffentlichen Profilcode und eine Zahlungsfreigabe. Beobachtete kritische Missverständnisse werden behoben und die betroffenen Abläufe erneut geprüft. P0 liefert die Prototypen und Befunde, P8 die Prüfung der tatsächlich implementierten Oberfläche.

## Technische Einbindung in das vorhandene Projekt

Das aktuelle Next.js-Projekt und Netlify bleiben die Weboberfläche. Die Erweiterung wird in klar abgegrenzte Module eingeführt; die Regeln der Dartengine werden nicht durch Netzwerkcode ersetzt.

| Bereich | Geplanter Ort |
| --- | --- |
| Einziger Einstieg in nostr-core, Signer, RelayPool und NIP-Bausteine | `lib/nostr/` |
| Identitäten, Profilansichten und Gastzuordnung | `lib/profiles/` |
| BlueLine-Schemas, fachliche Berechtigungen und Versionsregeln | `lib/protocol/` |
| Relay-Auswahl und Betriebsregeln über den nostr-core-Adapter | `lib/relays/` |
| IndexedDB, Migration, Versand und Abgleich | `lib/storage/`, `lib/sync/` |
| Gerätekopplung und Wiederherstellung | `lib/devices/`, `lib/recovery/` |
| Clubs und Ranglistenregeln | `lib/clubs/` |
| Turnierengine und Boardverwaltung | `lib/tournaments/` |
| Auszeichnungskatalog, Voraussetzungen und Vergabeabläufe | `lib/badges/` |
| Zahlungsabläufe und Journal über nostr-core NWC | `lib/payments/` |
| Nutzeroberflächen | Passende Komponenten und App-Routen |

Bestehende Integrationspunkte sind `lib/game/types.ts`, `lib/game/storage.ts`, `lib/leaderboard.ts`, `components/setup-screen.tsx`, `components/game/use-match-controller.ts`, Ergebnisansicht, Settings und Service Worker. Der Regeln-Kern bleibt unabhängig testbar. Die heutige Bildfreigabe bleibt erhalten.

[nostr-core](https://nostr-core.netlify.app/) ist verbindlich gesetzt. Sämtliche Nostr-Schlüsseloperationen, Event-Erstellung und Signaturprüfung, Signer, NIP-Verschlüsselung, Referenzformate, Relay-Verbindungen, NIP-65, Listen, App-Daten, Kalender, Badges, Zaps, NWC und Nostr-Medienzugriffe laufen über diese Bibliothek. Die App implementiert eigene Darts-Regeln und Oberflächen oberhalb davon. Sie erhält weder einen parallelen Nostr-Client noch direkt eingebauten Ersatz aus einem anderen Nostr- oder Wallet-SDK.

`lib/nostr/` bündelt die Bibliotheksimporte und übersetzt technische Zustände für die Fachmodule. Browserstandards wie WebAuthn, Kamera, IndexedDB und die Verschlüsselung des allgemeinen Sicherungspakets bleiben eigene Plattformaufgaben; für ihren Nostr-Anteil benutzen sie wiederum nostr-core. Wir laden eine festgelegte, geprüfte Paketversion aus dem Build, keinen ungepinnten Laufzeitcode von der Dokumentationswebsite. Bundlegröße, Browserfähigkeit, Lizenz und Abhängigkeiten werden gegen das tatsächliche veröffentlichte Paket geprüft. Netzwerk- und Wallet-Code darf den Gaststart nicht ausbremsen.

### Geprüfte Abdeckung und konkrete Bibliotheksaufgaben

Prüfstand ist der Hauptzweig von nostr-core auf Commit `02ab4c8a14af55f48de917bd7d6b2285c5cfb6bb` am 4. Oktober 2026. Das dortige package.json nennt 1.0.4. Dokumentation und Quelltext wurden gelesen; Laufzeit-, Geräte- und Zahlungstests sind damit noch nicht erbracht. Die Freigabe vergleicht zusätzlich das tatsächlich installierbare Paket mit diesem Stand. [Quellstand](https://github.com/nostr-core-org/nostr-core/tree/02ab4c8a14af55f48de917bd7d6b2285c5cfb6bb)

| Bereich | Befund | Verbindliche Umsetzung beziehungsweise Nachweis |
| --- | --- | --- |
| Lokaler Signer, Browser und Remote | Gemeinsame Signer-API dokumentiert | Client-Integration mit Next.js; Sperren, Identitätswechsel und mobile Rücksprünge testen |
| Relays und Standards | Relay/RelayPool sowie NIP-19, 42, 44, 51, 52, 57, 58, 65 und 78 exportiert | Benötigte API-Aufrufe und Relay-Bedingungen mit Testvektoren prüfen |
| NWC | Bezahlen, Rechnungen, Statusabfrage und Benachrichtigungen dokumentiert | Gegen vereinbarte Wallets und aktuelle Protokollvarianten testen; Rechte und optionale Funktionen erkennen |
| NIP-58 | Profil-Helfer schreibt noch das ältere 30008-Format | 10008-Schreibweg, 30008-Sammlungen, Legacy-Import und vollständige Validierung in nostr-core ergänzen |
| NIP-49 und direkte NIP-55-Anbindung | Im untersuchten Dateibaum und Exportindex nicht gefunden | Für den bereits vereinbarten Umfang als Bibliotheks-Erweiterungen liefern und testen |
| Private Listen und App-Daten | Dokumentierte Komforthelfer nehmen teilweise einen Rohschlüssel entgegen | Signer-basierte NIP-44-Wege für NIP-07/NIP-46 ergänzen oder vorhandene Core-Primitiven verwenden; keinen privaten Hauptschlüssel aus externen Signern verlangen |

Der dokumentierte NIP-51-Parser kann bei fehlgeschlagener Entschlüsselung eine leere private Liste zurückgeben. Vor jeder Änderung muss deshalb eindeutig zwischen „leer“ und „nicht lesbar“ unterschieden werden. Diese Zustandsinformation und sichere Zusammenführung werden im Core-Adapter beziehungsweise in nostr-core verankert und getestet; ein fehlgeschlagener Lesevorgang darf keine vorhandenen Listen löschen. [nostr-core: NIP-51](https://github.com/nostr-core-org/nostr-core/blob/02ab4c8a14af55f48de917bd7d6b2285c5cfb6bb/docs/api/nip51.md), [Exportindex](https://github.com/nostr-core-org/nostr-core/blob/02ab4c8a14af55f48de917bd7d6b2285c5cfb6bb/src/index.ts)

Die Aufgabenliste wird in P0 mit reproduzierbaren Beispielen festgeschrieben. Fehlende generische Funktionen werden im nostr-core-Projekt ergänzt, geprüft und über eine festgelegte Version eingebunden. Ein dokumentierter Funktionsname gilt nicht bereits als Integrationsnachweis. Die Bibliotheksentscheidung bleibt dabei gesetzt; offene Punkte werden nicht durch zusätzliche Nostr-Abhängigkeiten oder ausgelassene Funktionen umgangen.

Badge-Veröffentlichung und Abruf erhalten eigene Relay-Tests für die benötigten Kinds und Referenzfilter. Die fünf Ziele für die erste Profilverteilung werden nicht pauschal als Badge-, Spiel- oder Wallet-Speicher behandelt. Profil-Auswahllisten, Vergaben und Definitionen enthalten geeignete Referenzen und Relay-Hinweise; die App lädt sie über akzeptierende Ziele. Für NWC verwendet sie die Relays der Wallet-Verbindung, nicht automatisch die öffentlichen Start-Relays.

Der Geräte- und Sicherungsdienst erhält eine kleine klar definierte API mit Passkey-Registrierung, Challenge-Prüfung, verschlüsselten Profilpaketen, Kopplungsanfragen und Sitzungsverwaltung. Öffentliches Profil, internes Sicherungskonto und öffentliche Spielidentität werden nicht über erratbare Namen gleichgesetzt.

Dauerhafte WebSocket-Relays werden separat betrieben oder als geeigneter Dienst bezogen. Netlify-Konfiguration, langfristige Domain, API-Adressen, erlaubte Verbindungen, Umgebungsvariablen und Deploy-Kontexte werden gemeinsam dokumentiert. Keine privaten Schlüssel in Buildvariablen oder öffentlich eingebetteten Konfigurationswerten.

## Schutz privater Daten und Betrieb

Technischer Schutz bleibt Aufgabe der App und erscheint nicht als Onboarding-Lehrgang. Öffentliche Daten, eigene private Daten und Daten eines geschlossenen Clubs erhalten getrennte Speicher- und Zugriffswege.

Der private Hauptschlüssel liegt lokal verschlüsselt; Entsperrung und Speicherschutz werden für Browser und PWA konkret geprüft. Während autorisierter Nutzung können Klartextschlüssel im Client benötigt werden. Eine nicht exportierbare lokale WebCrypto-Hülle verhindert keine Angriffe durch bereits kompromittierten Code derselben Website; wir versprechen keine Hardware-Isolation durch eine reine Web-App.

Deshalb gehören restriktive Script-Richtlinien, überprüfte Abhängigkeiten, sichere Textdarstellung und getrennte Testumgebungen zum Lieferumfang. Externe Profilbilder, Relay-URLs und Wallet-Endpunkte sind untrusted input. Serverseitige Abrufe blockieren lokale Netze, prüfen Weiterleitungen und begrenzen Größe und Laufzeit.

Logs enthalten keine Sicherungspakete, geheimen Kopplungstokens, privaten Schlüssel oder Wallet-Verbindungsdaten. Infrastrukturmetriken messen Fehler, Latenz, verfügbare Kopien und Warteschlangengrößen mit möglichst wenig Personenbezug.

Betriebsaufgaben: Monitoring, aktuelle TLS-Konfiguration, Quoten, Missbrauchsschutz, Speicherplatzalarme, Wiederherstellungsproben, Backup-Aufbewahrung und dokumentierte Zuständigkeit. Vor Freigabe wird eine vollständige Wiederherstellung des Dienstes aus einer Sicherung durchgeführt. Eigenbetrieb und gemietete Dienste erhalten denselben Export- und Ausfalltest.

Initiale Betriebsziele: zwei getrennte Speicherkopien für bestätigte private Daten, tägliche unabhängige Serverbackups, Warnung bei längerem Replikationsausfall und eine erprobte Wiederherstellung innerhalb eines Arbeitstages. Diese Ziele sind vor Produktfreigabe technisch und finanziell zu bestätigen; sie sind keine Zusage der fünf öffentlichen Relays.

Kostenplanung umfasst Relay-Betrieb, Datenbank beziehungsweise Objektspeicher, Bildspeicher, ausgehenden Traffic und Sicherungsdienst. Anbieter und Budget werden vor Beschaffung festgelegt. Die Architektur bleibt exportierbar, falls Betrieb oder Anbieter wechseln.

„Daten löschen“ unterscheidet dieses Gerät, eigene private Sicherungen und öffentliche Veröffentlichungen. Abmeldung, Löschen, Export und Geräteverlust sind verschiedene Vorgänge. Für Schlüsselkompromittierung gibt es einen dokumentierten Ablauf für neue Identität, Clubrechte und sichtbare historische Verknüpfungen.

## Umsetzung in vollständigen Arbeitspaketen

Die folgende Tabelle definiert die tatsächliche Bearbeitungsreihenfolge und die Abhängigkeiten. P3a liefert die technische Grundlage vor den Profilfunktionen; P3b ergänzt anschließend den vollständigen privaten Abgleich. Jedes Paket umfasst Implementierung, passende Dokumentation, Protokollprüfung und UX-Prüfung. Die 29 nummerierten Gesamtkriterien werden im Arbeitsverzeichnis als A01 bis A29 referenziert; sie behalten ihren ursprünglichen Inhalt.

| Paket und Voraussetzung | Konkretes Lieferergebnis | Zu prüfende Gesamtkriterien |
| --- | --- | --- |
| P0 Produkt und technische Nachweise | Ausgangsstand, Prototypen, Geräte- und Wallet-Matrix, Core-Nachweise, Schema und Betriebsentscheidungen | Prüfbasis für alle Kriterien, erste Runde A29 |
| P1 Lokale Datenbasis; nach passender P0-Prüfbasis | IDs, IndexedDB, vollständige Archive, Migration, Export und Rückweg | A01, A02, A08, A13 |
| P3a Protokollgrundlage; nach P0 und P1 | nostr-core samt benötigter Ergänzungen, Event-Verträge, Signer-Adapter, lokale Outbox, NIP-65 und NIP-51 | A03, A04, A09–A12, A25 |
| P2 Profile und Geräte; nach P3a | Profilerstellung und Ansichten, externe Signer, QR-Kopplung, Profilsicherung und Wiederherstellung des Zugangs | A02, A05, A06, A10, A21 |
| P3b Vollständige Synchronisierung; nach P2 | Private Historie, geschützte Speicherung, neue Geräte, Konflikte, Löschungen und Dienstwechsel | A04, A07–A09, A11 |
| P4 Gemeinsame Matches; nach P3b | Teilnahme, Schreiberwechsel, Zuschauer, nachvollziehbare Ergebnisse und Korrekturen | A06, A12, A13 |
| P5 Clubs; nach P4 | Clubansichten, Rechte, Einladungen, Saisons, Wertung, Eigentümerwechsel und Export | A12, A14, A21 |
| P6 Turniere; nach P5 | Alle vier Formate, Anmeldung und Check-in, Teilnehmeransicht, Boards, Leitung, Zuschauer und Ausdruck | A13, A15, A16, A22 |
| P7a Auszeichnungen; nach P6 | Katalog, Ausstellerbetrieb, geprüfte Vergabe, Profilanzeige, Migration und Portabilität | A23, A24 |
| P7b Direkte Zahlungen; nach P7a | NWC-Verbindung, Bezahlen und Empfangen, Zap-Prüfung, Zahlungsjournal und Originalsignet | A17, A26–A28 |
| P8 Gesamtabnahme; nach allen vorigen Paketen | Zusammenhängender Praxistest, echte Gerätematrix, zweite Nutzertestrunde, Betrieb und gestufter Rollout | A01–A29, insbesondere A18–A20 und A29 |

P0 liefert überprüfbare Entscheidungen und erste lauffähige Nachweise, keine Sammlung unbeantworteter Recherchefragen. Gefundene Bibliothekslücken werden mit minimalem Reproduktionsfall und gewünschtem Vertrag erfasst; die für den Gesamtumfang benötigten generischen Ergänzungen werden in P3a integriert und geprüft. Bei Veränderungen der Bibliothek oder eines Protokolls werden die betroffenen Nachweise vor Verwendung aktualisiert. Zwischenstände eines Pakets dürfen in einer isolierten Vorschau geprüft werden; ihre Veröffentlichung als fertige Funktion setzt dessen vollständige Abschlussbedingungen voraus. A18 und A19 gelten bereits bei jedem betroffenen UI-Paket; P8 führt deren Ergebnisse zur vollständigen Geräte- und Sprachprüfung zusammen.

### Konkrete Bearbeitungsliste

Alle folgenden Punkte sind offen. Die IDs verbinden Aufgaben, Entscheidungen, Fehlerberichte und Nachweise. Jede Zeile wird vor Bearbeitung zur kurzen Aufgabenkarte nach dem oben beschriebenen Muster ergänzt. Die jeweiligen Produktkapitel und A01 bis A29 bleiben verbindlich; diese Liste ersetzt sie nicht.

- [x] **P0.01 Ausgangsstand und Arbeitsablage:** Bestehende Funktionen, Tests, Build, Paketversionen und Git-Zustand erfassen; heutige Gastabläufe und UI als Vergleich festhalten; Aufgaben- und Nachweisablage anlegen.

- [ ] **P0.02 Bedienmodell:** Navigation, Rollenansichten, Bildschirmzustände und DE/EN-Begriffe abstimmen; die beschriebenen Nutzerwege als klickbare Prototypen erstellen und erste Nutzertestbefunde bearbeiten.

- [x] **P0.03 Core-Abdeckung:** Tatsächlich installierbares nostr-core-Paket in Browser und Next.js nachweisen; dokumentierte Funktionen gegen Quellstand und aktuelle NIPs prüfen; jede Lücke mit Beispiel erfassen.

- [ ] **P0.04 Geräte und Wiederherstellung:** QR-Kopplung, Passkey-PRF und vorhandene externe Signer mit benannten Geräten und Browsern erproben; Sicherungsformat und Import-Testvektoren festlegen; benötigte Core-Ergänzungen P3a zuordnen.

- [ ] **P0.05 Protokoll und Befugnisse:** Event-Verträge, Kind-Auswahl, Rollenmatrix, Schreiberwechsel, Reihenfolge, private Inhalte, Aussteller und Zahlungsanfragen mit Beispielen und Gegenbeispielen festlegen.

- [ ] **P0.06 Betrieb und Empfang:** Domain, Kosten, Speicher, Relays, fünf Profilziele und tatsächliche NWC-Fähigkeiten prüfen; Testidentitäten und Simulatoren vorbereiten; sieben Tage dauernde Aufbewahrungsprüfung früh einplanen.

- [ ] **P0.07 Gestaltungsgrundlage:** Abstände, Typografie, Zustandsfarben, Dialoge, Tabellen und Originalassets festlegen; Referenzgeräte, Messverfahren und konkrete Leistungsziele dokumentieren.

- [x] **P1.01 IDs und Archive:** Spieleridentität von Anzeigenamen lösen; neue Rohdaten und importierte Summen nachvollziehbar unterscheiden.

- [ ] **P1.02 Migration und Schreiben:** Unterbrochenes Upgrade, Speicherfehler und Rückweg testen; laufendes Spiel und Historie erhalten.

- [x] **P1.03 Statistik und Export:** Kennzahlen gegen unabhängig berechnete Beispiele prüfen; Regeln, fehlende Werte und Datenbasis erklären; exportierte Daten wieder einlesen.

- [ ] **P3a.01 Core-Ergänzungen:** NIP-49, direkte NIP-55-Anbindung, aktuelle Badge-Formate, vollständige Badge-Prüfung und sichere private Listenwege in nostr-core liefern; Änderungen und Tests zur geprüften Paketversion verknüpfen.

- [ ] **P3a.02 Transport und Validierung:** Einzigen Core-Zugang, Signer-Adapter, Event-Prüfung, Authentifizierung und persistente Outbox integrieren; Grenzfälle mit unabhängigen Testdaten prüfen.

- [ ] **P3a.03 Profilverteilung und Listen:** NIP-65, fünf geeignete Ziele, NIP-51, Erhalt unbekannter Einträge und Konfliktbehandlung praktisch nachweisen.

- [ ] **P2.01 Kontextprofil und Ansichten:** Gastzuordnung, öffentliche Vorschau, fremde Profile und nachvollziehbare Statistik liefern; keine unbeabsichtigte Veröffentlichung.

- [ ] **P2.02 Externe Zugänge:** NIP-07, NIP-46/Amber und direkter Android-Weg einschließlich Ablehnung, Sperre, App-Wechsel und Identitätswechsel abschließen.

- [ ] **P2.03 Eigenes Gerät koppeln:** Scan, Code, Bestätigung, Ablauf, Wiederaufnahme und getrennte Board-Teilnahme auf echten Geräten prüfen.

- [ ] **P2.04 Zugang sichern:** Passkey- und Dateisicherung, mehrere Entsperrwege, beschädigtes Paket, verlorenes Ursprungsgerät und verifizierter Import.

- [ ] **P3b.01 Private Daten:** Verschlüsselte Historie und Speicherung mit zwei unabhängigen Kopien liefern; neu verbundene Geräte finden und lesen ihren Bestand.

- [ ] **P3b.02 Abgleich und Konflikte:** Offline-Abend, mehrere Geräte, doppelte und ungeordnete Zustellung, verspätete Änderungen, Tombstones und nicht lesbare Inhalte prüfen.

- [ ] **P3b.03 Portabilität:** Vollständigen Export und Wiederaufbau auf sauberem Gerät sowie Wechsel eines ausgefallenen Speicherwegs praktisch durchspielen.

- [ ] **P4.01 Teilnahme und Board:** Spielerplätze, Gäste und befristete Matchbefugnisse; Hauptschlüssel und Wallets bleiben auf dem persönlichen Gerät.

- [ ] **P4.02 Schreiben und Zuschauen:** Wiederanlauf, Schreiberübergabe und konkurrierende Offline-Zweige; richtige Scores und erkennbare Unterbrechung in der Zuschaueransicht.

- [ ] **P4.03 Ergebnislebenszyklus:** Bestätigung, Widerspruch, Korrektur und Aufhebung bis in Historie und Statistiken konsistent nachvollziehen.

- [ ] **P5.01 Clubbetrieb:** Gründung, Einladung, Mitgliedschaft, Verwaltung und passende Zustände für jede Rolle; geschlossene Daten und öffentliche Vorschau prüfen.

- [ ] **P5.02 Saison und Übergabe:** Ranglistenregeln, Gäste, Schlüsselwechsel, Austritt, Ausschluss, Eigentümerwechsel und portablen Clubexport abschließen.

- [x] **P6.01 Turnierengine:** Einzel-KO, Doppel-KO einschließlich Final-Reset-Regel, Jeder-gegen-jeden sowie Gruppen plus KO gegen unabhängig berechnete Turnierbeispiele prüfen.

- [ ] **P6.02 Teilnahme:** Anmeldung, Check-in, Warteliste, Gäste, Setzung, Auslosungsvorschau, Rückzug und Nichterscheinen.

- [ ] **P6.03 Leitungsbetrieb:** Board-Zuweisung, Ergebnisfreigabe, Korrektur früherer Runden, unterbrochene Verbindung und Übernahme der Organisation.

- [ ] **P6.04 Darstellung und Last:** Spielerweg, Rundensicht, Turnierbaum, TV, Ausdruck und Exporte mit 128 Teilnehmern und 16 Boards abnehmen.

- [ ] **P7a.01 Voraussetzungen und Vergabe:** Versionierten Katalog und begrenzten Ausstellerdienst liefern; Nachweise, private Erfolge, Gäste, Duplikate und nachträgliche Korrekturen prüfen.

- [ ] **P7a.02 Profil und Austausch:** Auszeichnungen annehmen, auswählen, anordnen und ausblenden; alte und neue Formate, fremde Sammlungen und Export in einem unabhängigen Leseweg prüfen.

- [ ] **P7b.01 Verbindung:** NWC-Einrichtung, Rechte, tatsächlich durchgesetzte Limits, Verbindung entfernen, Gerät wechseln und Originalsignet.

- [ ] **P7b.02 Zahlungsablauf:** Bezahlen und Empfangen mit bestätigtem Empfänger, Betrag und Status; Journal, mehrere Tabs, App-Neustart und unbekannter Ausgang.

- [ ] **P7b.03 Zap und Wallet-Abnahme:** Geeignete Empfangsadresse, geprüfter Beleg und normale Rechnung auseinanderhalten; Wallet-Simulator und die vorgesehenen kontrollierten Praxistests abschließen.

- [ ] **P8.01 Gesamter Spielabend:** Gastspiel → Profil → Gerätewechsel → Club → Turnier → Auszeichnung → direkte Zahlung zusammenhängend prüfen; Fehler und UX-Reibung nacharbeiten.

- [ ] **P8.02 Produktqualität:** DE/EN, echte Gerätematrix, Barrierefreiheit, visuelle Ansichten, Leistungsziele und zweite Nutzertestrunde an der implementierten App abnehmen.

- [ ] **P8.03 Betrieb und Freigabe:** A01–A29 mit Nachweisen schließen; Dienst-Wiederherstellung, Backups, Datenmigration und Rückweg erproben; Netlify-Konfiguration und gestuften Rollout prüfen.

Größere Funktionen kommen hinter getrennte Feature-Schalter. Die bestehende Gast-App bleibt über den gesamten Rollout benutzbar. Ein Schalter darf Daten weder löschen noch unlesbar machen. Schemaänderungen werden zuerst rückwärtskompatibel lesbar, dann schreibbar ausgerollt.

Die Aufwandsschätzung folgt auf die P0-Nachweise. Eine belastbare Kalenderzusage vor Prüfung von Passkey-Wiederherstellung, mobilen Signern und Relay-Annahme wäre verfrüht. Keine nachträgliche Streichung von Wiederherstellung oder Fehlerfällen, um eine Schätzung einzuhalten.

## Verbindlicher Abschluss eines Arbeitspakets

Für jeden Arbeitspunkt gelten drei Schritte: Sollverhalten und Beispiele festhalten; vollständigen Ablauf implementieren; gezielt gegen Fehlerfälle und Bedienprobleme prüfen und nacharbeiten. Die Prüfphase umfasst einen eigenen zweiten Lesedurchgang des Diffs und einen Durchlauf in der laufenden Anwendung. Codex prüft dabei bewusst aus Sicht des unerfahrenen Spielers und aus Sicht eines fehlerhaften oder unberechtigten Gegenübers.

Ein Paket ist erst abgeschlossen, wenn seine passenden automatisierten Prüfungen erfolgreich sind, die betroffenen Nutzerabläufe praktisch durchgespielt wurden, die Darstellung geprüft ist und alle zugeordneten Kriterien Nachweise besitzen. Eine nicht anwendbare Prüfung braucht eine konkrete Begründung. Ein übersprungener Test, ein Mock oder ein noch fehlendes Gerät wird nicht als bestandener Praxistest gezählt. Bereits bestandene unveränderte Prüfungen werden nur bei neuen Änderungen, Fehlern oder begründeten Zweifeln wiederholt.

### Protokoll und Daten prüfen

| Prüffeld | Nachweis vor Abschluss |
| --- | --- |
| Standard und Bibliothek | Verwendete NIP-Fassung, Paketversion und Core-API passen zusammen; Entwurfserweiterungen sind als solche erkennbar; benötigte generische Ergänzungen sind tatsächlich enthalten |
| Vertrag pro Eventfamilie | Kind, Tags, Inhalte, Autor, Empfänger, IDs, Zahlenbereiche, Referenzen, Versionsregeln, Sichtbarkeit, Aufbewahrung und Löschverhalten sind beschrieben |
| Echtheit und Befugnis | Gültige Signatur und fachliche Berechtigung werden getrennt geprüft; falscher Autor, alter Schreiber, entzogene Rolle und Kontowechsel sind negative Testfälle |
| Reihenfolge und Konflikte | Duplikate, verspätete Zustellung, fehlende Vorgänger, gleiche Zeitstempel, Neustart und mehrere Geräte erzeugen nachvollziehbare Ergebnisse |
| Bestehende Fremddaten | Unbekannte Profilfelder, fremde Listeneinträge und alte Formate bleiben erhalten; nicht entschlüsselbar ist ein eigener Zustand |
| Grenzen und Ausfälle | Unvollständige Abfragen, Ablehnung, Größenlimits, Relay-Wechsel, offline befindlicher Signer und Speicherfehler werden tatsächlich erzeugt |
| Ende zu Ende | Ein realer Schreibweg wird über eine frische Verbindung nachgelesen; Export wird unabhängig vom schreibenden UI geprüft; Simulator und echter Dienst sind im Bericht unterscheidbar |
| Vertrauliche Daten | Öffentliche Events, Tags, Medien, URLs und Logs enthalten nur dafür bestimmte Daten; Profile, Schreiberzugang und Wallet-Freigaben bleiben getrennt |
| Geld und Zahlen | sats/msats, Ablaufzeit, Rechnung, Zahlungsbezug und unklarer Ausgang sind eindeutig; eine Wiederholung darf keine neue Zahlung auslösen |

Testvektoren bestehen aus Eingabe, erwartetem Ergebnis und Begründung. Bei Darts, Turnierbäumen, Statistik und Berechtigungen werden die Erwartungen unabhängig von der zu prüfenden Funktion hergeleitet. Offizielle Protokollvektoren und, wo verfügbar, unabhängige Leser beziehungsweise kompatible Clients ergänzen den eigenen Testaufbau. Ein Roundtrip nur zwischen unseren eigenen fehlergleichen Schreib- und Lesefunktionen genügt nicht als Nachweis der Interoperabilität.

### Bedienung und Darstellung prüfen

Die visuelle Prüfung findet am laufenden Produkt statt. Referenzzustände werden auf kleinem Handy, Tablet, Desktop und der betroffenen Großanzeige aufgenommen und tatsächlich angesehen. Nur Screenshots zu erzeugen genügt nicht. Prüffälle enthalten lange Namen, große Zahlen, viele Teilnehmer, fehlende Bilder, leere Bestände, teilweise geladene Daten, Offline-Zustand und Fehlermeldungen. Deutsch und Englisch werden in denselben Abläufen geprüft.

Die Prüfung beantwortet konkret: Ist der nächste Schritt erkennbar? Bleiben Namen, Scores und Hauptaktion lesbar? Funktionieren Zurück, Abbrechen und Wiederaufnahme ohne Datenverlust? Sind Beitreten, Kopplung und Wallet-Freigabe unterscheidbar? Ist eine wartende Zahlung von einer gescheiterten Zahlung zu unterscheiden? Werden private Daten auch in Tabellen, Vorschauen und Summen korrekt behandelt? Gibt es unnötige Eingaben, wiederholte Hinweise oder Schritte, die sich sinnvoll entfernen lassen? Zusätzlich wird jeder Hinweis darauf geprüft, ob er gerade einen konkreten Nutzen hat: Routinemäßige Speicher-, Verbindungs- oder Abgleichmeldungen werden entfernt. Der Text „Dein Spiel ist gespeichert.“ erhält keinen Zusatz über spätere Verarbeitung. Echte Speicherfehler und unbestätigte Zahlungen bleiben handlungsorientiert erkennbar.

Für die Weboberfläche ist WCAG 2.2 AA das Prüfziel. Automatische Prüfungen werden durch Tastatur, sichtbaren und nicht verdeckten Fokus, Screenreader, vergrößerten Text, verständliche Fehlermeldungen und Alternativen zu Drag-and-drop ergänzt. Die Umsetzung orientiert sich an den tatsächlich anwendbaren Kriterien; ein einzelner Scannerbericht ist kein Konformitätsnachweis. [W3C: WCAG 2.2 Prüfkriterien](https://www.w3.org/WAI/WCAG22/quickref/)

Als eigene Gestaltungsregel erhalten primäre Touch-Aktionen nach Möglichkeit mindestens 44 × 44 CSS-Pixel große Trefferflächen; Scoreeingabe am Board darf größer sein. Die Oberfläche wird auch bei 320 CSS-Pixel Breite und vergrößerter Schrift geprüft. Der Turnierbaum darf eine räumliche Sonderansicht sein, benötigt aber die bereits geplante zugängliche Begegnungsliste. Diese Vorgaben werden beim Prototypen und am implementierten Produkt kontrolliert.

### Leistung und Betrieb messbar machen

Als Qualitätsziele für die Seiten gelten LCP höchstens 2,5 Sekunden, INP höchstens 200 Millisekunden und CLS höchstens 0,1. Die zugrunde liegende Web-Vitals-Bewertung bezieht sich auf das 75. Perzentil, getrennt für mobile Geräte und Desktop. Vor Veröffentlichung werden reproduzierbare Labormessungen auf der festgelegten Gerätematrix berichtet; ohne reale Nutzungsdaten wird daraus kein bereits erfüllter Feldnachweis gemacht. [Web Vitals: Messwerte und Zielgrenzen](https://web.dev/articles/vitals)

Zusätzlich ist die Scoreeingabe ein eigener Messfall: Ziel sind höchstens 100 Millisekunden vom Tippen bis zur sichtbaren lokalen Rückmeldung im 95. Perzentil auf dem festgelegten Referenzgerät. Netzwerkanfragen liegen nicht auf diesem Weg. Messungen unterscheiden die Darstellung, die lokale Speicherbestätigung und den späteren Sync. Die maximalen Datenmengen, Anzahl der Wiederholungen, Geräte, Browser und Netzbedingungen werden in P0.07 festgelegt und anschließend beibehalten. Zielverfehlungen werden behoben; die Messbedingungen werden nicht nachträglich so verändert, dass das Ergebnis besser aussieht.

Der Lastnachweis für 128 Teilnehmende und 16 Boards misst Bedienlatenz, Speicherverbrauch und Nachladeverhalten mit dem tatsächlichen Turnierzustand. Die bestehende Zwei-Sekunden-Zielgröße für Live-Aktualisierungen wird in einem definierten Testnetz geprüft. Zeitouts und fremde Netzstörungen erscheinen im Produkt als verständliche Zustände; sie rechtfertigen keine falsche Erfolgsmeldung.

### Befunde beheben und Fortschritt ehrlich schließen

Datenverlust, falsche Ergebnisse oder Berechtigungen, ungewollte Veröffentlichung, doppelte Zahlungen und gescheiterte Wiederherstellung verhindern den Abschluss unmittelbar. Ebenso verhindern nicht bedienbare Kernabläufe oder fehlende zugesagte Funktionen die Freigabe. Sichtbare Gestaltungsfehler, kaputte Abstände, abgeschnittene Texte und inkonsistente Zustände werden vor Abschluss des betroffenen UI-Pakets nachgearbeitet. Die Prüfungen bleiben auf die vereinbarte Plattformmatrix und den beschriebenen Umfang bezogen.

Jeder Befund erhält Reproduktionsschritte, Auswirkung, betroffenen Arbeitspunkt und den Nachweis seiner Behebung. Ein neuer Fehler in einer bereits fertigen Funktion öffnet deren betroffene Abnahme erneut. Änderungen an Schema, Core-Version oder einer UI-Komponente ziehen eine gezielte Prüfung ihrer tatsächlichen Nutzer nach sich. Nutzerfeedback dient der Produktentscheidung und Verfeinerung; es ersetzt nicht die eigene Fehlersuche.

Wenn ein erforderlicher Nachweis ohne Gerät, Zugang oder echte Testperson nicht erbracht werden kann, bleibt er offen und wird präzise benannt. Der Umsetzer erledigt die davon unabhängigen Aufgaben weiter und bereitet den fehlenden Test konkret vor. Das Gesamtvorhaben gilt erst mit allen 29 Kriterien und den zugehörigen Paketnachweisen als abgeschlossen.

## Tests und verbindliche Gesamtabnahme

Die vorhandenen Tests für Regeln, Checkouts und Korrekturen bleiben Pflicht. Hinzu kommen Tests für tatsächliche fachliche Risiken; reine Wiederholungen der Implementierung sind kein Qualitätsnachweis.

Die Abnahme enthält mindestens:

1. Erstnutzer beginnt ohne Profil, Internet oder Wallet genauso schnell wie bisher ein Spiel.

2. Aus einem fertigen Spiel entsteht auf Wunsch genau ein Profil; nur ausgewählte Gastdaten werden übernommen.

3. Das neue Profil und seine Relay-Liste werden an fünf geeignete Ziele verteilt; fehlende Kopien werden korrekt nachgeholt.

4. Vorhandene NIP-65- und NIP-51-Daten überleben Verbindung und Bearbeitung ohne Verlust fremder Einträge.

5. Eigenes Profil wird per QR auf ein zweites Gerät übernommen; Wiederholungen, Abbruch und abgelaufene Codes erzeugen keinen unberechtigten Zugriff.

6. Ein Mitspieler tritt einem Clubtablet bei, ohne seinen Hauptschlüssel oder seine Zahlungsrechte dorthin zu übertragen.

7. Profil und private Historie lassen sich nach Verlust des ursprünglichen Geräts wiederherstellen.

8. Ein kompletter Abend offline wird später ohne doppelte Ergebnisse synchronisiert.

9. Ein Relay fällt aus, lehnt Events ab oder verliert Daten; die App zeigt den Zustand richtig und erhält lokale Daten.

10. Externer Signer ist gesperrt, verweigert eine Anfrage oder wechselt Identität; kein Wurf geht verloren und kein fremdes Konto wird verwendet.

11. Zwei Geräte bearbeiten denselben Gegenstand; Konflikte werden erkannt statt still überschrieben.

12. Falsche Signaturen, unberechtigte Rollen, manipulierte Ergebnisdaten und wiederholte Einladungen werden abgewiesen.

13. Eine Ergebnisänderung hebt betroffene Bestätigungen auf und berechnet Tabellen korrekt neu.

14. Ein vollständiger Clubabend einschließlich Gästen, Rollenwechsel, Austritt und Export funktioniert.

15. Turniere aller vereinbarten Formate behandeln Freilose, Gleichstand, Abbruch, Rückzug und bereits laufende Folgerunden korrekt.

16. 128 Teilnehmende und 16 Boards bleiben im vereinbarten Leistungsrahmen bedienbar.

17. Zahlungsabbrüche, doppelte Klicks und unbekannter Zahlungsstatus lösen keine unbemerkte erneute Zahlung aus.

18. Deutsch, Englisch, Screenreader, kleine Displays, Querformat und reduzierte Bewegung sind vollständig nutzbar.

19. Browser und installierte PWA werden auf iOS/iPadOS, Android sowie Desktop geprüft; externe App-Rücksprünge gehören dazu.

20. Serverseitige Wiederherstellung und vollständiger portabler Nutzerexport sind praktisch erfolgreich durchgeführt.

21. Eigene und fremde Profile sind ohne Protokollwissen verständlich; öffentliche Summen, Spiele und Clubangaben enthalten ausschließlich entsprechend freigegebene Daten.

22. Ein Teilnehmer findet Anmeldung, Check-in, Gegner und Board auf einem kleinen Handy; Organisatoren und Zuschauer erhalten jeweils passende Ansichten, einschließlich leerer und unterbrochener Zustände.

23. Eine Auszeichnung wird aus dem richtigen Anlass genau einmal vergeben. Manipulierte Awards, falsche Aussteller, unpassende Empfänger, doppelte Referenzen und nachträglich aufgehobene Ergebnisse werden korrekt behandelt.

24. NIP-58-Profile lesen das alte und das aktuelle Format. Auswahl, Reihenfolge, Badge Sets und Auszeichnungen anderer Apps überleben Bearbeitung, Export und Gerätewechsel.

25. Sämtliche Nostr- und NWC-Zugriffe laufen über nostr-core; Abhängigkeits- und Importprüfung sowie Integrationstests belegen diese Grenze. NIP-49, NIP-55 und die nötigen Badge-Anpassungen sind im verwendeten Core-Stand enthalten.

26. Eine NWC-Wallet bezahlt und empfängt direkt in der App. Fehlende Empfangsfunktion, fehlender Kontostand, ausgeschöpfte Freigabe, offline befindliche Wallet und getrennte Geräteberechtigungen werden korrekt angezeigt.

27. Normale Rechnungszahlungen und NIP-57-Zaps werden sachlich richtig verarbeitet. Fehlender Zap-Beleg nach erfolgreicher Zahlung, Neustart, mehrere Tabs und verspätete Antworten führen nicht zur Doppelzahlung.

28. Originale Bitcoin- und NWC-Assets sind in kleiner und großer Darstellung, hellem und dunklem Design sowie mit Screenreader geprüft. Nutzer verstehen die Beschriftung ohne Kenntnis der Logos.

29. Die genannten Nutzerwege sind mit Menschen ohne Nostr-Erfahrung überprüft. Kritische Verwechslungen zwischen Profilteilen, Geräteübertragung, Wallet-Freigabe und Zahlung sind vor Freigabe behoben. Die normalen Abläufe benötigen keine Protokollerklärung und enthalten keine unnötigen Hinweise auf Hintergrundverarbeitung.

Die Plattformliste wird in P0 mit konkreten Browser- und Betriebssystemversionen festgehalten. Lokales Spielen behält die bisherige Geräteunterstützung; zusätzliche Funktionen zeigen auf nicht unterstützten Geräten einen verständlichen alternativen Weg.

Automatisierung umfasst deterministische Event-Testvektoren, Property-Tests für Reihenfolge und Duplikate, lokale Test-Relays, Wallet-Simulator, Integrationstests und Playwright-Abläufe. Externe Schreibproben und echte Zahlungen sind separate, kontrollierte Freigabetests. Zeitlich unstabile öffentliche Dienste sind nicht die einzige Grundlage der CI.

## Festgelegte Richtung und noch zu bestätigende Betriebswerte

Die Produktrichtung steht: einfacher Gaststart, Profile erst im passenden Moment, unkomplizierte QR-Verbindung, zusätzliche native Signer-Wege, fünf Startziele, portable Daten, verständliche Spielerprofile mit Statistik und NIP-58-Auszeichnungen, Clubs und Turniere mit passenden Rollenansichten sowie direkte Zahlungen über eine verbundene NWC-Wallet.

Technisch ist nostr-core verbindlich gesetzt. Darauf bauen lokale Identitäten mit verschlüsselter Sicherung, Passkey-Komfort, dauerhafter privater App-Speicher, eigene dokumentierte Darts-Events, klare Rollen- und Ausstellerregeln sowie Ingame-Bezahlen und -Empfangen auf. Das Zahlungssignet kombiniert die originalen Bitcoin- und NWC-Zeichen. Der bereits festgelegte Umfang einschließlich Gastspiel, Wiederherstellung, fünf Startzielen, NIP-51 und persönlicher Regelung der Einsätze bleibt vollständig Bestandteil des Plans.

Vor produktiver Umsetzung werden die langfristige Domain, Betreiber, monatliches Budget, Ausstellerverantwortung und konkrete Geräte- und Wallet-Matrix festgehalten. Die fünf Relay-Kandidaten benötigen Schreib- und Aufbewahrungsnachweise; die eigenen Kind-Nummern Prüfung und Dokumentation. Die gefundenen nostr-core-Lücken benötigen geprüfte Ergänzungen; Originalassets Export und Sichtprüfung; die Oberflächen Prototypen und Nutzertests. Diese Aufgaben sind ausdrückliche Lieferergebnisse und werden nicht als bereits erledigte Implementierung dargestellt.

Die endgültige Freigabe umfasst alle Pakete P0 bis P8 einschließlich P3a, P3b, P7a und P7b. Die 37 Arbeitspunkte und A01–A29 werden anhand der beschriebenen Nachweise geschlossen. Ein funktionierender Login, eine einzelne Relay-Veröffentlichung, ein erster Clubbildschirm oder eine erfolgreiche Zahlung allein erfüllt das Vorhaben nicht.

