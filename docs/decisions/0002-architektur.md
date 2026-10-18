# 0002 Architektur der Erweiterung

**Status:** Angenommen (Umsetzer, 4. Oktober 2026), §6 präzisiert am 5. Oktober 2026 nach Review P0.05 Runde 1 (Einladungsnachweis, Ende einer Befugnis, Mitgliederzahl geschlossener Clubs) und Runde 2 (Übergaben, Einladungen öffentlicher Clubs und nach Rollenende, Ausnahme an der Mitgliedergrenze); §2 und §6 ergänzt am 6. Oktober 2026 nach Review P4 Runde 1 (Importe von `lib/live`, Autoritätsschlüssel je Spiel). Grundlage: [0001](0001-kein-eigenes-backend.md), [PLAN.md](../implementation/PLAN.md), Risikobericht P0.01.

Dieses Dokument ist der Vertrag für alle Umsetzungsschritte. Abweichungen brauchen eine neue Entscheidung.

## 1 Grundsätze

1. **Gast zuerst.** Der Gastweg (öffnen, einrichten, spielen, Ergebnis, Rangliste) lädt kein nostr-core und öffnet keine Netzwerkverbindung. Neue Funktionen laden ihren Code per `import()` erst bei Bedarf.
2. **Lokal ist maßgeblich.** Jede Aktion wirkt sofort lokal. Relays sind Kopie und Transport, nie Voraussetzung für die Bedienung.
3. **Einfach sprechen.** Keine Protokollbegriffe in normalen Ansichten; Technik nur unter „Erweitert“. Keine Meldungen über Hintergrundabgleich. „Dein Spiel ist gespeichert.“ ist die einzige Speicherbestätigung.
4. **Ehrliche Zustände.** Unbekannt ist nicht null, nicht geladen ist nicht leer, eine unbestätigte Zahlung ist nicht bezahlt.
5. **Nicht überbauen.** Die kleinste Lösung, die die Abnahmekriterien vollständig erfüllt.

## 2 Module

| Ordner | Inhalt | Darf importieren |
| --- | --- | --- |
| `lib/game/` | Bestehende Spielregeln, unverändert in ihrer Logik | nur eigene Dateien |
| `lib/storage/` | IndexedDB-Zugriff, Spielarchiv, Spielerverzeichnis, Migration, Export, Löschen | `lib/game` |
| `lib/nostr/` | **Einziger Importeur von nostr-core.** Lazy-Loader, Relay-Katalog, Veröffentlichen mit Ergebnis je Relay, Abfragen mit EOSE/Timeout, Signer-Adapter mit Prüfung, `ext/` für fehlende generische Bausteine | nostr-core, `@noble/*`, `@scure/base` |
| `lib/protocol/` | BlueLine-Kinds, Tags, Inhaltsschemas und Prüfer je Eventfamilie | `lib/nostr` (Typen), `lib/game` |
| `lib/profile/` | Sitzung, Identität, Profilmetadaten, Avatar, Profilansichten-Daten | `lib/nostr`, `lib/storage` |
| `lib/sync/` | Warteschlange (Outbox), private Historie, Selbstheilung, Diagnose | `lib/nostr`, `lib/storage`, `lib/profile` |
| `lib/devices/` | Gerätekopplung per QR, Link und Code | `lib/nostr`, `lib/profile`; seit dem Nachtrag vom 16. Oktober 2026 auch `lib/protocol`, `lib/storage`, `lib/sync` und `lib/recovery` |
| `lib/recovery/` | Sicherungsdatei (NIP-49), Passkey-Paket | `lib/nostr`, `lib/profile`, `lib/storage`; seit dem Nachtrag vom 16. Oktober 2026 auch `lib/protocol` und `lib/sync` |
| `lib/live/` | Zuschauen, Spieler am Board verbinden, Schreiberwechsel, Ergebnisbestätigung | `lib/nostr`, `lib/protocol`, `lib/game`; seit dem Nachtrag vom 6. Oktober 2026 auch `lib/storage` und `lib/profile/vault.ts`, seit dem 16. Oktober 2026 `lib/sync/outbox.ts` |
| `lib/clubs/` | Clubs, Rollen, Einladungen, Saisons, Tabellen | `lib/protocol`, `lib/nostr`; seit dem 16. Oktober 2026 `lib/sync/outbox.ts` (alle Club-Events gehen durch die eine Outbox) |
| `lib/tournaments/` | `engine.ts` (rein, ohne Netz) und Turnierdaten | `lib/protocol`, `lib/nostr` |
| `lib/badges/` | Katalog, Meilensteine, NIP-58 lesen und schreiben | `lib/protocol`, `lib/nostr`, `lib/storage` |
| `lib/payments/` | NWC-Verbindung, Bezahlen, Empfangen, Zaps, Zahlungsjournal | `lib/nostr`, `lib/storage` |
| `components/<bereich>/` | Oberflächen je Bereich | alles oben über die öffentlichen Funktionen |

Dateien unter `lib/`, die in Node getestet werden, verwenden relative Importe mit `.ts`-Endung und nur löschbare TypeScript-Syntax (keine `enum`, `namespace`, Parameter-Properties), wie die bestehenden Dateien.

**Nachtrag 6. Oktober 2026 (Review P4 Runde 1, Entscheidung a):** `lib/live` darf zusätzlich `lib/storage` und `lib/profile/vault.ts` importieren. Ein Board hält seine Datensätze bis zur sicheren Speicherung und die Plätze seiner Spieler im Store „pending“ (`lib/storage/db.ts`), ein bestätigtes Ergebnis wandert in das eigene Archiv des Spielers (`lib/storage/archive.ts`), und die Schlüssel eines Spiels liegen versiegelt mit dem Geräteschlüssel (`lib/profile/vault.ts`), weil §4 Klartextschlüssel verbietet. Zwei Folgen: Wer sich abmeldet (`forgetVaultKey`), kann die Schlüssel eines laufenden Live-Spiels nach einem Neustart nicht mehr öffnen, das Spiel ist dann einfach nicht mehr live. Und die eigene Outbox des Boards verdoppelt, was die generische Outbox von `lib/sync` (P3a.02) übernehmen soll; sobald es sie gibt, zieht das Board dorthin um, statt zwei zu halten.

**Nachtrag 16. Oktober 2026 (Zusammenführung Welle 3):** `lib/live` darf `lib/sync/outbox.ts` importieren; das Board hält keine eigene Warteschlange mehr, alle seine Datensätze und der Stand gehen durch die eine Outbox (Reihenfolge je Eintrag über `after`, Endgültigkeit nach deren Regel).

**Nachtrag 16. Oktober 2026 (Review P2.03/P2.04 Runde 1):** `lib/devices` importiert `lib/protocol` (Kopplungsprotokoll, Kinds, Links, private Datensätze), `lib/storage` (Store „pending“ für den laufenden Vorgang), `lib/sync` (Datenschlüssel, Geräte-ID des Abgleichs, Outbox, versiegelte Datensätze für die Geräteliste) und `lib/recovery` (das Profilpaket `package.ts`, den Sicherungsstand `status.ts`). `lib/recovery` importiert `lib/protocol` (Tag-Prüfungen, Kinds) und `lib/sync` (Datenschlüssel, Outbox), aber nie `lib/devices`: Die Abhängigkeit geht nur in eine Richtung. Dass eine gespeicherte Sicherungsdatei in der Geräteliste vermerkt wird, verbindet die Oberfläche (`components/devices`), nicht die Module.

**Nachtrag 16. Oktober 2026 (Schlussdurchgang):** Geprüft mit einem Importgraphen über `lib/` und `madge` (ohne reine Typimporte und ohne faule `import()`: keine Zyklen; mit ihnen bleiben nur Typzyklen in `lib/i18n` und die faulen Rückwege der Bereichs-Einstiege in `components/live` und `components/profile`). `nostr-core` wird nur von `lib/nostr/runtime.ts` geladen, über `import()` in `lib/nostr/core.ts`; `lib/` importiert nie `components/`. Zusätzlich zur Tabelle gelten diese Importe als richtig:
- `lib/game` nutzt seit 1.0.0 `lib/feedback.ts` (Ton, Vibration, Ansage) und `lib/i18n` (gesprochene Wörter).
- `lib/storage` nennt den Typ `NostrEvent` aus `lib/nostr/types.ts` (Kopien von Events, `record-copy.ts`).
- `lib/protocol/tournament.ts` nutzt `lib/tournaments/draw.ts` (rein, importiert nichts aus `lib/protocol`): Seed und Auslosungsreihenfolge sind Teil der Regel, die der Prüfer durchsetzt.
- `lib/profile` nutzt `lib/protocol` (Kinds, Links, Profil- und Badge-Schemas) und `lib/shell/links.ts`; `lib/sync` nutzt `lib/protocol` (private Datensätze, Wurfprotokoll).
- `lib/clubs` und `lib/tournaments` nutzen `lib/game` (Spiele nachrechnen), `lib/storage` (`db.ts`, `ids.ts`, `lock.ts`, `record-copy.ts`), `lib/shell/links.ts` und `lib/sync/outbox.ts`; `lib/clubs` dazu `lib/profile/storage-keys.ts` (nur Namen), `lib/tournaments` dazu `lib/profile/vault.ts` (Board-Schlüssel) und als Typen `lib/badges/organizer.ts` und die Turniertexte aus `lib/i18n`.
- `lib/badges` nutzt `lib/game`, `lib/profile` (Sitzung, eigene Events, Relay-Liste, öffentliches Profil, `storage-keys.ts`) und `lib/sync/publish.ts`; `lib/payments` nutzt `lib/game` (Typen) und `lib/profile` (Sitzung, Metadaten, öffentliches Profil, `vault.ts` für die Wallet-Verbindung).
- `lib/shell` (Navigation, Links, Registry) nutzt `lib/game` und `lib/i18n` nur als Typen.
- Die NIP-52-Kinds der Club-Termine stehen im Katalog `lib/protocol/kinds.ts`; die Speichernamen des Profils nur in `lib/profile/storage-keys.ts`.
- `lib/tournaments/sync.ts` nutzt `lib/live/follow.ts` (`readMatch`) und `lib/live/copy.ts` (Nachtrag zu den P8-Befunden): Die persönliche Kopie eines freigegebenen Board-Spiels entsteht aus dem Live-Spiel, in dem das Board es gezählt hat, mit demselben Helfer wie die bestätigte Live- und Clubpartie.

**Nachtrag 16. Oktober 2026 (Freigabeprüfung):**
- `lib/clubs/store.ts` nutzt `getSession` aus `lib/profile/session.ts`: Die lokale Kopie eines Clubs wird nur für das Profil geschrieben, das gerade angemeldet ist, damit eine langsame Relay- oder Signer-Antwort nach einem Abmelden oder Profilwechsel nichts zurückbringt.
- `lib/storage/archive.ts` nutzt `lib/profile/storage-keys.ts` (nur Namen): Eine Löschmarke nennt das Profil der gespeicherten Sitzung, gelesen aus dem Speicher, damit der Spielbildschirm (Gastweg) das Sitzungsmodul nicht lädt.
- `lib/protocol` nutzt `nowSeconds` aus `lib/nostr/time.ts` (ohne Abhängigkeiten) als Vorgabe für `now` beim Lesen: Jeder Leser prüft gegen dieselbe korrigierte Uhr, mit der signiert wird.
- `lib/tournaments/store.ts` nutzt `lib/profile/storage-keys.ts` (nur Namen): Turnierentwürfe sind Daten des Profils und gehen mit ihm.

## 3 Speicherung

- Das **laufende Spiel** bleibt in `localStorage` unter `dart-scorer.current-match.v1` (synchron, klein, kompatibel zu 1.0.0). Schreibfehler werden sichtbar: „Dein Spiel konnte nicht gespeichert werden.“ mit „Erneut versuchen“; die Eingaben bleiben im Speicher der Seite.
- **IndexedDB** `blueline` (Version 1) mit den Stores `matches` (vollständiges Archiv), `players` (Spielerverzeichnis), `kv` (kleine Zustände), `outbox` (signierte Events und Zustand je Relay), `payments` (Zahlungsjournal), `objects` (zwischengespeicherte Club-, Turnier- und Profil-Events), `pending` (laufende Kopplungen, Signer-Anfragen).
- **Migration:** Beim Start werden Einträge aus `dart-scorer.matches.v1` idempotent als `source: "imported-v1"` übernommen (nur vorhandene Summen, keine erfundenen Würfe). Neue Spiele werden **zusätzlich** im v1-Format nach `matches.v1` geschrieben, damit eine Rückkehr zu 1.0.0 keine Spiele verliert. Vorhandene v1-Schlüssel werden nie umgeschrieben oder um unbekannte Felder in Settings/Rules ergänzt.
- **Spieler-IDs:** Das Spielerverzeichnis vergibt stabile IDs (`pl_` + 128 Bit Zufall). Die Einrichtung verwendet für bekannte Namen die vorhandene ID. Eine optionale `pubkey` verbindet einen lokalen Spieler mit einem Profil. Gleichnamige Personen werden nie automatisch zusammengeführt; Platzhalternamen („Spieler 1“) gelten als unbenannt.
- **Neue Objekt-IDs** sind 128 Bit aus `crypto.getRandomValues`, hex.
- Tabs bleiben über `BroadcastChannel("blueline")` synchron.

## 4 Identität und Signer

```ts
// lib/profile/session.ts
type SessionKind = "local" | "nip07" | "nip46" | "nip55"
interface Session { pubkey: string; kind: SessionKind; createdAt: number }
getSession(): Session | null
useSession(): Session | null            // React, useSyncExternalStore
getSigner(): Promise<Signer>            // lädt nostr-core lazy; wirft, wenn keine Sitzung
startLocalProfile(): Promise<Session>    // erzeugt Schlüssel
importLocalKey(secretKey: Uint8Array): Promise<Session>
connectExternal(kind, params): Promise<Session>
signOut(options: { keepLocalData: boolean }): Promise<void>
```

- Lokale Schlüssel liegen in IndexedDB, verschlüsselt mit einem nicht exportierbaren AES-GCM-Schlüssel (WebCrypto). Keine Klartext-Schlüssel in `localStorage`.
- Jede Signatur wird geprüft: gültige Signatur, `pubkey` gleich Sitzung, Kind/Inhalt/Tags/Zeit unverändert. Sonst Abbruch und Hinweis.
- Externe Signer: NIP-07 (vor allem Desktop), NIP-46 (`bunker://` einfügen, `nostrconnect://` als QR für Amber und andere), NIP-55 (Android; nur Schlüssel abfragen und gelegentliches Signieren, Rückgabe über `/#signer-return`).
- **Datenschlüssel:** Jedes Profil hat einen zufälligen 32-Byte-Datenschlüssel. Er wird einmal mit `signer.nip44.encrypt(selbst)` verpackt und als NIP-78-Datensatz gespeichert. Private Inhalte werden lokal mit XChaCha20-Poly1305 unter diesem Schlüssel verschlüsselt. Dadurch braucht ein externer Signer nur eine Entschlüsselung pro Gerät.

## 5 Relays

| Rolle | Standard | Verwendung |
| --- | --- | --- |
| Profil | `wss://nos.lol`, `wss://relay.primal.net`, `wss://nostr-01.yakihonne.com`, `wss://nostr.oxtr.dev`, `wss://purplepag.es` | Kind 0, 10002, 10008 (purplepag.es nimmt nur 0, 3 und 10000er-Listen an) |
| Allgemein | die ersten vier | BlueLine-Events, private Datensätze, NIP-51-Sets (30000er), Live-Spiele, Auszeichnungen |

- „Veröffentlicht“ ab zwei bestätigten Relays verschiedener Betreiber; vollständig verteilt erst bei allen Zielen. Fehlende Kopien werden beim Öffnen der App erneut gesendet.
- Bestätigt heißt: `OK true` des Relays. Private Datensätze und das Passkey-Paket gelten erst als gesichert, wenn sie über eine neue Verbindung wieder gelesen wurden (Prüfung beim Selbstheilen). Ein Abfrageergebnis ohne Antwort eines Relays ist „unbekannt“, nie „leer“.
- Für Tests und Vorschauen ersetzt die Build-Variable `NEXT_PUBLIC_BLUELINE_RELAYS` (kommagetrennt) alle Standardrelays, etwa durch `ws://localhost:10547` von `nak serve`. Sie enthält keine Geheimnisse.
- Für NWC gelten ausschließlich die Relays der Wallet-Verbindung.

## 6 BlueLine-Events

Eine Kind-Nummer je Bereich, Typ als NIP-32-Label. Geprüft am 4. Oktober 2026 gegen das Kind-Register, die NIP-Übersicht und offene NIP-Pull-Requests: frei. (Der erste Entwurf 1501/31501/21501 kollidierte mit dem offenen Vorschlag NIP-101g „Golf Events“, PR #2272, und wurde ersetzt; 180 ist die Höchstpunktzahl einer Aufnahme.)

| Kind | Bereich | Verwendung |
| --- | --- | --- |
| **1180** | regulär | Unveränderliche Datensätze: Gründungen, Änderungen, Anfragen, Ergebnisse, Bestätigungen |
| **31180** | adressierbar | Aktuelle Zustände mit `d`: Live-Spielstand, Statistikkarte |
| **21180** | flüchtig | Kopplungs- und Board-Handshake-Nachrichten |
| 30078 | NIP-78 | Private, verschlüsselte Datensätze des Profils, je Datensatz ein nicht sprechendes `d` = HMAC(Datenschlüssel, Datensatz-ID). Kind 78 wird nicht verwendet, weil nos.lol und Primal es am 4. Oktober 2026 nicht auslieferten. |
| 1059 | NIP-59 | Verpackte Zahlungsanfragen an Mitspieler |

Pflicht-Tags für 1180/31180: `["L","blueline"]`, `["l","<typ>","blueline"]`, `["v","1"]`. Bezug auf ein Wurzelobjekt (Club, Turnier, Match) mit `["e","<id der Gründung>"]`. Club- und Turnier-IDs sind die Event-IDs ihrer Gründung (bleiben bei Eigentümerwechsel gleich). Typen und Inhalte stehen in `docs/protocol/`.

**Zustand durch Abspielen:** Club- und Turnierzustand ergibt sich deterministisch aus Gründung und allen gültigen Änderungen, sortiert nach `created_at`, dann `id`. Jede Änderung wird beim Abspielen gegen die Rechte des Autors zu diesem Zeitpunkt geprüft; ungültige werden ignoriert und in der Diagnose angezeigt. Endet eine Befugnis (Übergabe der Leitung oder des Eigentums, Herabstufung eines Admins), nennt der beendende Datensatz den Stand, den sein Autor sah; was die abgegebene Befugnis danach in ihre Amtszeit zurückdatiert und nicht zu diesem Stand gehört, gilt nicht. Übergaben (Nachtrag Runde 2): Ein Angebot ist höchstens 7 Tage offen und nennt den Stand, den es übergibt; die Annahme muss mindestens diesen Stand nennen, und nur die erste Annahme der angebotenen Person, die das Abspielen selbst annimmt, beendet die Amtszeit. Ein Rückzug hält nur ehrliche Geräte auf, weil die angebotene Person eine Annahme vor ihn datieren kann; Angebote gehen deshalb nur an Vertraute und sind kurz gültig. Nachtrag Runde 3: Bis zur Annahme folgen die übergebenen Gegenstände dem Stand, den sie nennt, gleich wer darüber schrieb; die Rollen eines Clubs entscheiden nur, ob ein Turnier zu ihm gehört, nicht über dessen Übergaben. Die Regeln Ü1 bis Ü6 stehen in `docs/protocol/conflicts.md` („Ende einer Befugnis“), alles, was ohne vertrauenswürdige Zeit offen bleibt, dort unter „Grenzen ohne vertrauenswürdige Zeit“.

**Geschlossene Clubs:** Jedes vertrauliche Objekt (Mitgliederliste, Einladungen, Ergebnisse, Termine) wird mit einem eigenen zufälligen Inhaltsschlüssel (XChaCha20-Poly1305) verschlüsselt; dieser Schlüssel wird für jedes aktuelle Mitglied einzeln mit NIP-44 verpackt und im selben Event mitgeliefert (PLAN.md Zeile 352: pro Objekt zufällige Inhaltsschlüssel, geprüfte Bausteine). Es gibt kein gemeinsames Club-Geheimnis. Ein entferntes Mitglied bekommt neue Objekte einfach nicht mehr verpackt; Bereits gelesenes bleibt bei ihm, das wird nicht anders dargestellt. Neue Mitglieder lesen den jeweils aktuellen Zustand, den ein Verantwortlicher für alle Mitglieder neu verpackt veröffentlicht, sobald sein Gerät online ist. Weil jedes Event jede Verpackung tragen muss, hat ein geschlossener Club höchstens 100 Mitglieder. Ein öffentlicher Club versiegelt nichts außer Schlüsselfreigaben, damit jeder Leser dieselben Datensätze prüft (Nachtrag Runde 2). Die Vorschau vor dem Beitritt (Name, Beschreibung, Veranstalter, nächster Termin) steckt verschlüsselt im Einladungslink. Das Verfahren wird vor der Veröffentlichung extern geprüft (Nutzerhandlung).

**Einladungen:** Zwei Arten. Ein **Gruppenlink** (bis zu seinem Ablauf oder Widerruf beliebig oft nutzbar) nimmt Beitretende sofort auf, die den Besitz des Tokens beweisen: mit einer BIP-340-Signatur über den eigenen Pubkey durch einen aus dem Token abgeleiteten Einladungsschlüssel (HKDF). Der Einladungsdatensatz nennt nur dessen öffentlichen Schlüssel, nie den Token; so prüft jeder Leser des Datensatzes den Beitritt (in einem öffentlichen Club also jeder), und der Beitritt klappt, ohne dass ein Admin online ist. (Der erste Entwurf nannte `HMAC(token, eigener pubkey)`; das konnten nur Inhaber des Tokens prüfen, Außenstehende eines öffentlichen Clubs sahen Beitretende deshalb nie als Mitglieder.) Eine **persönliche Einladung** (einmalig) und jede Anfrage ohne Einladung gelten erst, wenn ein Admin sie bestätigt; bis dahin zeigt die App „Deine Anfrage wartet auf Bestätigung“. Kapazität, Ablauf und Reihenfolge entscheidet damit die berechtigte Rolle, nie ein vom Beitretenden gesetzter `created_at` (Entscheidung 0001, Punkt 10). Eine Einladung endet mit der Rolle ihres Erstellers als Eigentümer oder Admin (Nachtrag Runde 2), endgültig, auch wenn er die Rolle wieder bekommt (Nachtrag Runde 3). **Ausnahme (Nachtrag Runde 2, offene Nutzerentscheidung):** An der Grenze von 100 Mitgliedern eines geschlossenen Clubs ohne eigene Höchstzahl entscheiden die Zeitstempel der Gruppenlink-Beitritte, wer noch Mitglied wurde; ein später, zurückdatierter Beitritt kann ein Mitglied, das in Wirklichkeit früher kam, wieder zur Anfrage machen. Ohne Entscheidung einer Rolle ist jede Grenze ein Wettlauf um Zeitstempel. Deshalb setzt das Gerät des Eigentümers (oder eines Admins) bei etwa 90 Mitgliedern `capacity: 100`; ab dann entscheidet ein Admin über jeden Beitritt. Ob das genügt oder geschlossene Clubs immer eine Höchstzahl haben, entscheidet die Nutzerin oder der Nutzer (Aufgabenkarte P0.05).

**Live-Spiele:** Das Board erzeugt pro Spiel einen Sitzungsschlüssel und veröffentlicht nach jeder Aufnahme den adressierbaren Spielstand (31180, `d` = Match-ID, steigende Version, kompakte Würfe). Private Spiele verschlüsseln den Inhalt mit einem Spielschlüssel aus dem Link-Fragment. Spieler verbinden sich über einen Board-QR, der nie einen Profilschlüssel überträgt. **Nachtrag 6. Oktober 2026 (Review P4 Runde 1, Entscheidung b):** Ein Freundschaftsspiel gründet das Board mit einem Autoritätsschlüssel nur für dieses Spiel, auch wenn ein Profil angemeldet ist: Kein Profilschlüssel auf einem gemeinsamen Board, Plätze lassen sich ohne Signer-Abfrage vergeben, und der Schlüssel zieht beim Schreiberwechsel mit dem Spiel um ([session-authorization.md](../protocol/families/session-authorization.md)). Club- und Turnierspiele nutzen weiter den Veranstalter als Autorität, über die vorhandene Option `authorities` von `reduceMatch`.

**Auszeichnungen:** NIP-58 mit 30009 (Definition), 8 (Vergabe), 10008 (Profilauswahl, Altformat 30008 lesbar). Aussteller ist der Veranstalter oder, gekennzeichnet „Selbst erreicht“, der Spieler. Prüfung: Signaturen, Vergabe-Autor gleich Definitions-Autor, Empfänger im `p`-Tag, deterministischer Anlass-Tag gegen Doppelte.

## 7 Kopplung, Sicherung, Wiederherstellung

- **Kopplung:** Das neue Gerät zeigt einen QR beziehungsweise Link `/#pair=<einmaliger Pubkey>.<Sitzungs-ID>.<Ablauf>.<Relays>` und alternativ einen 12-stelligen Code aus 32 Zeichen (Crockford-Base32, 60 Bit). Das vorhandene Gerät öffnet „Eigenes Gerät hinzufügen“ (nie über den allgemeinen Scanner), tauscht verschlüsselte flüchtige Nachrichten (21180, NIP-44 zwischen Einmalschlüsseln) aus, beide Geräte zeigen dieselbe aus beiden Schlüsseln berechnete Prüfkennung, und erst nach Bestätigung wird das Profilpaket übertragen. Das neue Gerät bestätigt die Entschlüsselung; erst dann erscheint „Dein Profil ist dabei.“ Wiederholung bis Bestätigung oder Ablauf (10 Minuten).
- **Sicherungsdatei:** JSON `blueline-sicherung.json` mit NIP-49-`ncryptsec` (log_n 16, im Web Worker), Datenschlüssel und Relays, verschlüsselt mit einem erzeugten starken Kennwort. „Gesichert“ erst nach erfolgreicher Probe-Entschlüsselung.
- **Passkey:** Nur wenn PRF beim Anlegen und beim sofortigen erneuten Abrufen funktioniert. Aus dem PRF-Wert werden per HKDF ein Locator-Schlüssel und ein Verschlüsselungsschlüssel abgeleitet; das Paket liegt als 30078 (`d=blueline-backup-v1`, signiert vom Locator) auf den allgemeinen Relays.
- Externe Profile sichern ihren Hauptschlüssel im Signer; BlueLine sichert nur App-Daten.

## 8 Zahlungen

- NWC über die `NWC`-Klasse von nostr-core, Verbindung lokal verschlüsselt gespeichert, nie in Sicherungen, Links oder Events.
- Vor jeder Zahlung: `connect({ verifyEncryption: true })`, Rechnung mit `decodeBolt11` gegen Betrag und Ablauf prüfen, Journal-Eintrag schreiben, dann `payInvoice`. Timeout oder Entschlüsselungsfehler heißt „Status unbekannt“ und wird über `lookupInvoice` geklärt, nie durch erneutes Senden.
- Empfänger: Lightning-Adresse aus dem Profil des Mitspielers oder eine angezeigte Rechnung („Empfangen“). Zaps nach NIP-57 mit vollständiger Belegprüfung.

## 9 Oberfläche

- Tab-Leiste (Telefon, iPad hoch) beziehungsweise Seitenleiste (iPad quer, Desktop): **Spielen, Rangliste, Clubs, Turniere, Profil**. Einstellungen und „Über“ liegen im Profil-Tab und sind auch als Gast erreichbar.
- Jeder Tab hat einen eigenen Navigationsstapel mit großem Titel und Zurück-Taste. Sekundäres öffnet sich als Sheet.
- Links (`/#p=`, `/#watch=`, `/#club=`, `/#tournament=`, `/#pair=`, `/#board=`, `/#signer-return`) öffnen direkt die passende Ansicht.
- Der Spielbildschirm bleibt ein fester Bildschirm ohne Scrollen. Neue Funktionen erscheinen dort nur im Menü „Spieloptionen“.
- Bestehende Bausteine aus `components/ui` (Group, Zeilen, Segmented, Sheet, Button, AlertDialog) werden wiederverwendet. Berührungsflächen ≥ 44 pt, keine Kürzung von Namen mit „…“, Text statt Farbe allein, reduzierte Bewegung, VoiceOver-Beschriftungen, Deutsch und Englisch vollständig.

## 10 Bedrohungsmodell in Kürze

- Öffentliche Relays sehen Autor, Kind, Zeitpunkt, Größe und Tags. Private Inhalte sind verschlüsselt, aber dauerhaft abrufbar; NIP-44 hat keine Vorwärtssicherheit.
- Code derselben Website kann Schlüssel im Browser nutzen. Schutz: keine fremden Skripte, feste Abhängigkeitsversionen, keine `dangerouslySetInnerHTML` mit fremden Inhalten, fremde Bilder nur als https-Raster ohne Referrer.
- Ein verlorenes Gerät mit Profilschlüssel lässt sich nicht kryptografisch widerrufen; die Geräteliste ist informativ.
