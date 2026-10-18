# Prüfanleitung für den Menschen

Stand: 16. Oktober 2026 · Integrationszweig `nostr-plan`, Commit `4c4ce92` · Nachfolger von [REVIEW-WELLE-1.md](REVIEW-WELLE-1.md)

Alle Bereiche sind zusammengeführt: Profil, Abgleich, Geräte und Sicherung, Live-Spiele, Clubs, Turniere, Auszeichnungen, Zahlungen. Geprüft ist das im Labor (Chromium, lokale Relays, simulierte Wallets und Passkeys). Was das heißt und was fehlt, steht in [STATUS.md](STATUS.md).

## Starten

Voraussetzung: Node 22.18 oder neuer, `nak` (z. B. `/opt/homebrew/bin/nak`).

```sh
git switch nostr-plan
npm ci
nak serve --hostname 127.0.0.1 --port 19980                         # Terminal 1: lokales Relay
NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:19980 npx next dev -p 3000 # Terminal 2
```

Dann http://localhost:3000 öffnen.

**Wichtig:** Ohne `NEXT_PUBLIC_BLUELINE_RELAYS` spricht die App mit den echten öffentlichen Relays. Schon „Profil anlegen“ veröffentlicht dann ein echtes Profil. Die Variable gilt beim Start des Servers; nach einer Änderung neu starten.

Für ein zweites oder drittes Gerät reicht ein privates Fenster oder ein anderer Browser: Jeder hat seinen eigenen Speicher. Ein echtes Handy im WLAN erreicht den lokalen Relay nicht (`ws://` erlaubt die App nur für diesen Rechner), und die Kamera braucht dort https. Echte Geräte gehören deshalb zu den offenen Nachweisen.

Automatische Prüfungen:

```sh
npm run lint && npm run typecheck
npm test              # 662 Tests, ohne Netzwerk
npm run test:relay    # 80 Tests gegen eigene nak-Relays, nie öffentlich
```

## Ein Darts-Abend in der richtigen Reihenfolge

1. **Gastspiel.** Spielen, zwei Namen, 301, bis zum Ende. Es soll so schnell gehen wie in 1.0.0: kein Profil, keine Anmeldung, kein Hinweis auf Hintergrundarbeit. Auf dem Ergebnis stehen Zeilen der Bereiche (zum Beispiel „Deine Ergebnisse mitnehmen“); auf kleinen Höhen zeigt die App eine Zeile und „+1“.
2. **Profil.** Aus dem Ergebnis „Deine Ergebnisse mitnehmen“ oder im Tab Profil „Profil anlegen“. Danach: genau ein Profil, nur die gewählten Gastspiele übernommen, Statistik mit Datenbasis. Profil › Erweitert zeigt Relays und „Jetzt abgleichen“.
3. **Zweites Gerät.** Im privaten Fenster: Profil › „Ich habe schon ein Profil“ › „Von meinem anderen Gerät“. Im ersten Fenster: Profil › Geräte › „Eigenes Gerät hinzufügen“, Code eintippen. Beide zeigen dieselbe Prüfkennung; erst „Zugriff geben“ überträgt etwas. Danach „… ist dabei.“, die Spiele kommen über den Abgleich, die Geräteliste hat zwei Einträge.
4. **Sicherung.** Auf der Profilkarte „Jetzt sichern“ › „Sicherungsdatei erstellen“. Datei speichern, Kennwort notieren. „Gesichert“ erscheint erst danach. Probe: abmelden, „Aus meiner Sicherung“, erst ein falsches, dann das richtige Kennwort. Der Passkey läuft in Chrome nur mit einem echten Passkey-Anbieter; geprüft ist er nur simuliert.
5. **Club.** Tab Clubs › „Club gründen“. Einladungslink erzeugen und im zweiten Fenster öffnen. Ein Spiel aus dem Club starten; auf dem Ergebnis die Clubzeile. Tabelle und Termine ansehen. Zum Schluss „Saison beenden“: Die Mitglieder mit Profil bekommen Auszeichnungen.
6. **Live-Spiel.** Ein Spiel starten, im Spielmenü „Spieler verbinden“ oder „Zuschauen lassen“. Im zweiten Fenster den Code oder Link öffnen. Würfe erscheinen beim Zuschauer; nach dem Spiel bestätigt der Mitspieler oder widerspricht. „Auf anderem Gerät fortsetzen“ übergibt das Board.
7. **Turnier mit Board.** Tab Turniere › „Turnier erstellen“ (vier Schritte). Im zweiten Fenster anmelden, im ersten „Check-in öffnen“ und auslosen. „Board hinzufügen“ zeigt einen Code für ein drittes Fenster (anderer Browser) als Board-Gerät. Dort das aufgerufene Spiel spielen; die Leitung gibt das Ergebnis frei. Zuschauer- und TV-Ansicht und den Ausdruck ansehen.
8. **Auszeichnungen.** Nach passenden Spielen erscheint „n neue Auszeichnungen“ auf dem Ergebnis. Profil › Auszeichnungen: „Im Profil zeigen“, ausblenden, anordnen. Auf dem Profil des anderen Fensters die Chips ansehen.
9. **Zahlung mit Testwallet.** Eine simulierte NWC-Wallet auf dem lokalen Relay starten (Terminal 3, im Repository, läuft bis Strg+C):

   ```sh
   node --input-type=module -e "import { startFakeWallet } from './tests/support/fake-wallet.ts'; const w = await startFakeWallet({ relay: 'ws://127.0.0.1:19980', balanceMsat: 100_000_000 }); console.log(w.uri)"
   ```

   Die ausgegebene Verbindung unter Profil › Zahlungen › „Wallet verbinden“ einfügen. Für den Empfänger im zweiten Fenster eine zweite Wallet genauso starten. Dann einen Einsatz in der Einrichtung vereinbaren und das Spiel beenden. Die Zahlungszeile auf dem Ergebnis führt durch Bezahlen oder Empfangen; den Zahlungscode der anderen Seite zeigt deren Fenster (auch unter Profil › Zahlungen › „Empfangen“), die zahlende Seite scannt oder fügt ihn ein und bestätigt. Erwartet: genau eine Zahlung, auch bei Doppeltipp, Neuladen oder zwei Tabs. Kein echtes Geld; Zaps an Lightning-Adressen gehen lokal nicht.

Gute Stellen für einen kritischen Blick: iPhone-SE-Größe (320×548) und quer (568×320), Deutsch und Englisch, hell und dunkel, Zurück und Abbrechen mitten im Ablauf, Relay stoppen (Terminal 1) und wieder starten.

## Feature-Schalter

`NEXT_PUBLIC_BLUELINE_FEATURES` nennt die eingeschalteten Bereiche, durch Komma getrennt: `profile`, `payments`, `live`, `sync`, `clubs`, `badges`, `devices`, `tournaments`. Ohne die Variable ist alles an, mit leerem Wert alles aus. `sync`, `clubs`, `badges` und `tournaments` brauchen `profile`; `devices` braucht `profile` und `sync`. Ein ausgeschalteter Bereich verschwindet, seine Daten auf dem Gerät bleiben. Beispiel, nur Live-Spiele:

```sh
NEXT_PUBLIC_BLUELINE_FEATURES=live NEXT_PUBLIC_BLUELINE_RELAYS=ws://127.0.0.1:19980 npx next dev -p 3000
```

## Was bekannt nicht geprüft ist

- Safari, Firefox, echte Handys und Tablets, Kamera, installierte PWA, VoiceOver.
- Öffentliche Relays: ob sie die Events annehmen und halten (Entscheidung E7).
- Echte Signer (Amber, nsec.app, Erweiterungen), echte Passkeys, echte Wallets und sats.
- Nutzertests mit Menschen ohne Nostr-Erfahrung.
- Ein durchgehender Browserlauf auf genau diesem Commit (P8.01 läuft). Die Bereichsläufe stammen von den Spurständen vor dem Zusammenführen.
- Clubs und Auszeichnungen hatten nur eine unabhängige Review-Runde.
- Bekannte Grenzen und kleine Fehler: [STATUS.md › Offene Befunde](STATUS.md#offene-befunde), etwa „Aufnahmen“ im Querformat (UI-01).

## Wo die Nachweise liegen

| Was | Wo |
| --- | --- |
| Zustand aller 37 Punkte, Entscheidungen E1 bis E12, Befunde | [STATUS.md](STATUS.md) |
| Je Arbeitspunkt Ziel, Prüfungen, Endcommit, was offen ist | [tasks/](tasks/) |
| Browserskripte, Bilder, Berichte je Bereich | [evidence/](evidence/) (P0.02 Rahmen, P2.01 Profil, P2.03 Geräte, P3b Abgleich, P4 Live, P5 Clubs, P6.02 Turniere, P7a.01 Auszeichnungen, P7b Zahlungen) |
| Protokoll, Verträge, Testvektoren | [../protocol/](../protocol/) |
| Entscheidungen | [../decisions/](../decisions/) |

## Rückmeldung

Am hilfreichsten pro Punkt: Schritt des Abends, Fenstergröße, Sprache, hell oder dunkel, was du erwartet hast und was passiert ist. Ein Bildschirmfoto hilft.
