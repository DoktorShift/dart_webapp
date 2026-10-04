# BlueLine Darts Übergabe an den Umsetzer

Wir starten mit **P0.01**. Ein separater Bearbeiter setzt um; Codex in diesem Review-Thread prüft unabhängig. Der Nutzer entscheidet über Produktfragen und die Veröffentlichung.

## Arbeitsgrundlage

- [Vollständiger Plan mit 37 Arbeitspunkten und 29 Abnahmekriterien](PLAN.md)
- [Klickbarer UX-Entwurf](../ux/blueline-comfort-prototype.html)
- [Gemeinsame Plan-Page](https://chatgpt.com/space/page_6a4c2e64a33c81918f36154f8d34adf8)

Stand der Übergabe: 4. Oktober 2026. Geprüfte Codebasis: `e6ff77edc575eae2cf6a9dd61112edb2400fb05d`, Version 1.0.0. Beim Erstellen dieser Übergabe liegt der lokale Checkout auf `main`; der Prototyp ist eine noch nicht eingecheckte Arbeitsdatei. Diese Übergabedokumente werden ebenfalls lokal vorbereitet. P0.01 erfasst und übernimmt die benötigten Dateien ausdrücklich in den Arbeitsbranch. Ein Remote-Checkout enthält sie erst nach Commit und Push.

Die Erweiterung ist noch nicht implementiert. Der Prototyp verwendet Beispieldaten und simulierte Aktionen. Er weist weder echte Wiederherstellung noch Signer, Relays oder Zahlungen nach. Die dort berichteten Browserprüfungen ersetzen keine produktiven Geräte- oder Nutzertests.

## Erster Auftrag P0.01

Lies den vollständigen Plan und vorhandene Projektanweisungen. Arbeite in einem eigenen Branch beziehungsweise Worktree; vermeide gleichzeitige Änderungen mit dem Reviewer im selben Checkout. Übernimm vorhandene Arbeitsdateien gezielt, ohne fremde Änderungen zu verwerfen.

Liefere als erste abgegrenzte Änderung:

1. Eine Baseline mit tatsächlichem Commit, Arbeitsbaum, Laufzeit, Paketmanager und Paketversionen. Prüfe zunächst Lockfile und Installationszustand.
2. Ergebnisse der vorhandenen Prüfungen: `lint`, `typecheck`, `test` und `build` aus `package.json`. Dokumentiere Befehle, Datum, Ergebnis und bereits vorhandene Fehler. Die derzeitige Node-Anforderung lautet `>=22.18`; prüfe die tatsächlich verwendete Umgebung.
3. Eine kurze praktische Prüfung des heutigen Gastablaufs: Spiel starten, eingeben, korrigieren, fortsetzen und abschließen. Halte die vorhandene Darstellung und relevante Datenhaltung als Vergleich fest.
4. Aufgaben- und Nachweisablage unter `docs/implementation/`, Entscheidungsablage unter `docs/decisions/` und Protokollablage unter `docs/protocol/`. Jede Aufgabenkarte nennt Ziel, Abhängigkeiten, betroffene Abnahmekriterien und Abschlussnachweise.
5. Einen Bericht über konkrete Risiken und Voraussetzungen für P0.02 bis P0.07. Trenne eigene offene Untersuchungen von tatsächlich benötigten Nutzerentscheidungen.

Diese erste Lieferung schafft die überprüfbare Ausgangsbasis. Umfangreiche Feature-Implementierung folgt den passenden P0-Nachweisen. Vorhandene Fehler werden mit Auswirkung erfasst; unabhängige Arbeit darf weitergehen.

## Feststehende Produktregeln

Der vollständige Plan bleibt maßgeblich. Besonders leicht zu verletzen sind diese Vorgaben:

- Sofort als Gast spielen. Profil, Sicherung und Wallet werden erst passend zur gewählten Handlung angeboten.
- Alle Nostr-Funktionen laufen über **nostr-core**; die Referenz ist [nostr-core.netlify.app](https://nostr-core.netlify.app). Fehlende generische Funktionen werden dort ergänzt und über eine festgelegte Version eingebunden.
- Normale Spieler brauchen keine Protokollbegriffe. Eine hilfreiche Speicherbestätigung lautet vollständig **„Dein Spiel ist gespeichert.“** Hintergrundverarbeitung bekommt keine zusätzliche Meldung.
- Profile, Gerätewechsel, Sicherung, Clubs, Turniere, Statistiken, Auszeichnungen und Zahlungen bilden zusammenhängende Abläufe. Eine Einrichtung darf die begonnene Aufgabe nicht verlieren.
- NWC ermöglicht direkte freiwillige Zahlungen und Empfang. Die Spieler regeln ihre Vereinbarung persönlich; die App verwaltet keinen gemeinsamen Topf.
- Bestehende Spiele, Gastzugang und Daten müssen erhalten bleiben. Ein Prototyp, ein Mock oder ein grüner Build allein erfüllt keine fachliche Abnahme.

## Offene Nachweise in P0

| Thema | Zu liefern |
| --- | --- |
| nostr-core | Installierbare, festgelegte Version; Browser-/Next.js-Nachweis; tatsächliche API-Abdeckung; reproduzierbare Lücken |
| Geräte und Sicherung | Verfahren auf benannten Geräten und Browsern prüfen; unterstützte Wege, Grenzen und Wiederherstellung nach Verlust nachweisen |
| Darts-Protokoll | Event-Verträge, Kind-Auswahl, Rechte, Konflikte und unabhängige Testvektoren |
| Relays und Betrieb | Fünf Profilziele mit Schreib- und Aufbewahrungsnachweis; private Speicherung, Betreiber, Kosten, Domain und Ausstellerverantwortung |
| Wallets und UX | Konkrete Wallet-Fähigkeiten sowie Geräte-, Sprach-, Rollen- und Fehlerzustände; Nutzertests mit echten Personen |

Diese Punkte verhindern den Start von P0 nicht. Sie verhindern den Abschluss der jeweils davon abhängigen Arbeit, solange die erforderlichen Nachweise fehlen. Für Entscheidungen des Nutzers bereitet der Umsetzer konkrete Optionen, Folgen, Kosten und eine Empfehlung vor.

## So erfolgt das Review

Der Umsetzer liefert kleine, zusammenhängende Änderungen. Ein Review-Paket enthält:

- Aufgaben-ID und betroffene Kriterien aus A01–A29.
- Branch oder PR-Link, Basiscommit und genauen zu prüfenden Commit.
- Was sich für den Spieler oder das Protokoll ändert und weshalb.
- Ausgeführte Prüfungen samt Ergebnissen; nicht ausgeführte Prüfungen ausdrücklich offen.
- Bei UI-Änderungen eine startbare Vorschau, nachgestellte Abläufe und relevante Screenshots.
- Offene Entscheidungen, Einschränkungen und nächsten Schritt.

Codex prüft den tatsächlichen Diff, relevante Prüfungen, Daten- und Protokollverhalten sowie die bedienbare Oberfläche. Befunde nennen Priorität, Datei und Zeile, Auswirkung und reproduzierbare Schritte. Der Umsetzer behebt sie; die Nachprüfung nennt den neuen Prüfcommit. Änderungen nach einem Review erhalten eine Prüfung ihrer Auswirkungen.

Eine Freigabe bezieht sich auf den geprüften Commit und Umfang. Fehlende kritische Nachweise bleiben offen; ein Review ist keine Garantie der Fehlerfreiheit. Unabhängige Vorarbeiten dürfen weiterlaufen. Merge oder Veröffentlichung erfolgen im Rahmen der dafür geltenden Nutzerautorisierung.

Der Nutzer oder Umsetzer legt das Review-Paket in diesem Thread vor. Es ist keine automatische Beobachtung von Branches oder PRs eingerichtet. Eine externe Nachricht oder ein automatischer Auftrag an einen anderen Bearbeiter wurde mit dieser Übergabe nicht versandt.

## Startauftrag zum Weitergeben

> Übernimm die Umsetzung von BlueLine Darts nach `docs/implementation/PLAN.md` und `docs/implementation/HANDOFF.md`. Beginne mit P0.01 und liefere dafür einen abgegrenzten Arbeitsbranch mit Baseline, vorhandenen Prüfergebnissen, Aufgabenablage und konkreten offenen Voraussetzungen. Nutze den UX-Prototyp als Entwurf, nicht als fertige Funktion. Der separate Reviewer prüft den tatsächlichen Commit. Halte den Gaststart schnell, die Sprache einfach und alle Nostr-Funktionen in nostr-core. Arbeite die weiteren Pakete anhand ihrer dokumentierten Abhängigkeiten ab und lege jede prüfbare Lieferung mit Nachweisen vor.

