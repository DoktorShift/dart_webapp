# Kinds, Labels, Pflicht-Tags und Versionsregeln

Stand: P0.05, 4. Oktober 2026. Code: [`lib/protocol/kinds.ts`](../../lib/protocol/kinds.ts), [`tags.ts`](../../lib/protocol/tags.ts), [`records.ts`](../../lib/protocol/records.ts), [`seal.ts`](../../lib/protocol/seal.ts). Grundlage: [Entscheidung 0002](../decisions/0002-architektur.md) §6.

## Kinds

Eine Kind-Nummer je NIP-01-Bereich; der Datensatztyp ist ein NIP-32-Label. Relays und Filter sehen dadurch nur drei BlueLine-Nummern. Die Kollisionsprüfung gegen das Kind-Register, die NIP-Übersicht und offene NIP-Pull-Requests vom 4. Oktober 2026 steht in Entscheidung 0002 (der erste Entwurf 1501/31501/21501 kollidierte mit NIP-101g, PR #2272); P0.05 hat sie nicht erneut ausgeführt. 180 ist die Höchstpunktzahl einer Aufnahme. Eine Eintragung ins Kind-Register ist eine Nutzerhandlung (Recherche PR-12) und offen.

| Kind | Bereich | Inhalt | Familien |
| --- | --- | --- | --- |
| **1180** | regulär | Unveränderliche Datensätze: Gründungen, Änderungen, Anfragen, Ergebnisse, Bestätigungen, Log-Stücke, Auszeichnungsnachweise | [club](families/club.md), [tournament](families/tournament.md), [session-authorization](families/session-authorization.md), [match-result](families/match-result.md), [badges](families/badges.md); als ungesignetes Rumor in [payment-request](families/payment-request.md) |
| **31180** | adressierbar | Aktueller Zustand unter `d`: Live-Spielstand (`d` = Match-ID), Statistikkarte (`d` = `stats`) | [match-live](families/match-live.md), [profile](families/profile.md) |
| **21180** | flüchtig | Kopplungs- und Board-Nachrichten, nie gespeichert | [pairing](families/pairing.md), [board-join](families/board-join.md) |
| 30078 | NIP-78 | Private, verschlüsselte Datensätze des Profils mit nicht sprechendem `d` | [private-records](families/private-records.md) |
| 1059 / 13 | NIP-59 | Gift Wrap und Seal um Zahlungsanfragen | [payment-request](families/payment-request.md) |
| 30009 / 8 / 10008 | NIP-58 | Auszeichnungs-Definition, Vergabe, Profilauswahl | [badges](families/badges.md) |

Die selbst veröffentlichte Statistikkarte (31180 mit `d` = `stats`, Entscheidung 0002 §6, Recherche PR-13) hat ihren Vertrag seit P2.01 in [profile.md](families/profile.md). Profilmetadaten (0), Relay-Liste (10002), blockierte Relays (10006) und Spielerrunden (30000) sind Standardformate; wie BlueLine sie liest und schreibt, steht ebenfalls dort.

## Pflicht-Tags für 1180 und 31180

| Tag | Pflicht | Bedeutung |
| --- | --- | --- |
| `["L","blueline"]` | ja | NIP-32-Namensraum |
| `["l","<typ>","blueline"]` | ja, genau einmal | Datensatztyp, siehe unten |
| `["v","1"]` | ja, genau einmal | Hauptversion des Inhaltsformats dieses Typs |
| `["e","<id>"]` | ja, außer bei Gründungen | Wurzelobjekt: Club-, Turnier- oder Match-ID. Genau ein `e`-Tag. Gründungen haben keines, ihre eigene Event-ID ist die Objekt-ID. |
| `["d","<match-id>"]` | nur 31180 | Gleich dem `e`-Tag; bei der Statistikkarte `stats` (ohne `e`-Tag) |
| `["enc","seal"]` | wenn versiegelt | Inhalt ist ein versiegelter Umschlag für seine Leser (unten) |
| `["enc","nip44","<pubkey>"]` | wenn mit Link-Schlüssel verschlüsselt | Inhalt ist NIP-44 vom Autor an den Schlüssel aus einem Link (privates Spiel) |
| `["alt","BlueLine Darts <typ>"]` | empfohlen | NIP-31-Hinweis für andere Clients; Leser verlangen ihn nicht |

Weitere Tags trägt ein BlueLine-Datensatz nicht. Insbesondere keine `p`-Tags: Personen stehen im Inhalt, damit versiegelte Clubdaten keine Mitglieder verraten ([privacy.md](privacy.md)). Ausnahmen mit eigenem Grund: `p` im Zahlungs-Rumor und in Kopplungs- und Board-Nachrichten (Empfänger), `p` bei NIP-58-Vergaben (vom Standard verlangt).

Club-, Turnier- und Match-IDs sind die Event-IDs ihrer Gründung und bleiben bei Eigentümer-, Veranstalter- oder Schreiberwechsel gleich (Recherche PR-9). Einladungen werden mit der Event-ID ihres `club.invite` benannt. Neue Objekt-IDs innerhalb eines Objekts (Saison, Termin, Gast, Board) sind 16 Zufallsbytes, hex.

## Verschlüsselung

Jeder Typ legt fest, wie sein Inhalt verschlüsselt sein darf (`encryption` in [`records.ts`](../../lib/protocol/records.ts), Spalte „Verschlüsselung“ in den Familienverträgen):

| Form | Tag | Verwendung | Leser |
| --- | --- | --- | --- |
| keine | – | öffentliche Clubs (dort ist nur `club.keys` versiegelt; jeder andere versiegelte Datensatz: `invalid_tags`), öffentliche Turniere und Spiele, Beitrittsanfragen | alle |
| **Siegel** | `["enc","seal"]` | geschlossene Clubs (mit ihren Einladungen) und ihre Turniere; Schlüsselfreigaben immer | jede Person, für die der Inhaltsschlüssel verpackt ist |
| **Link-Schlüssel** | `["enc","nip44",<pubkey>]` | private Spiele (Spielschlüssel aus dem Link-Fragment) | wer den Link hat |

### Versiegelter Umschlag

Es gibt kein gemeinsames Club-Geheimnis (Entscheidung 0002 §6). Jeder versiegelte Datensatz hat seinen eigenen zufälligen Inhaltsschlüssel:

```
content = {"v":1,"n":<nonce>,"c":<ciphertext>,"k":[[<hinweis>,<verpackung>],…],"p":{"n":…,"c":…}}

n           24 Zufallsbytes, base64
c           base64(XChaCha20-Poly1305(inhaltsschlüssel, n, klartext, aad = "blueline-seal-v1:" + typ))
verpackung  NIP-44-v2 vom Autor an einen Leser; Klartext = Inhaltsschlüssel als 64 Hex-Zeichen
hinweis     hex(sha256("blueline-seal-hint-v1" ‖ n ‖ pubkey des Lesers)[0..4])
p           nur bei club.invite: die Vorschau, verschlüsselt unter vorschauschlüssel(token), aad "blueline-preview-v1"
```

- Die Verpackungen sind nach Hinweis sortiert; die Reihenfolge verrät nicht, wer wann dazukam.
- Der Hinweis lässt den Leser seine Verpackung ohne Probieren finden. Er hängt von der Nonce ab: Wer die Liste der Leser nicht kennt, kann sie nicht ablesen; wer einen Pubkey vermutet, kann ihn prüfen ([privacy.md](privacy.md)).
- Höchstens 100 Leser je Event (`MAX_SEAL_READERS`): Eine Verpackung kostet rund 190 Byte. Gemessen: ein versiegeltes Event mit 100 Lesern und kleinem Inhalt bleibt unter 32 KiB ([`tests/protocol-seal.test.ts`](../../tests/protocol-seal.test.ts)).
- Ein falscher Schlüssel, ein unter anderes Label verschobener oder veränderter Inhalt öffnet nicht (authentifizierte Verschlüsselung).
- NIP-44 läuft beim Signer (`lib/nostr`); `lib/protocol` legt Format und symmetrischen Teil fest und braucht keinen geheimen Schlüssel einer Person. Öffnen: `openSealedEvents` ([`seal.ts`](../../lib/protocol/seal.ts)) über die eigene Verpackung, dann über Schlüsselfreigaben (`club.keys`).
- Jeder kann versiegelte Events an jeden adressieren. Damit ein Fremder den Signer nicht beschäftigt (bei NIP-46 ist jede Entschlüsselung eine Anfrage), probiert der Leser höchstens drei Verpackungen mit seinem Hinweis je Event (`MAX_WRAP_TRIES`) und kann Signer-Aufrufe auf vertraute Autoren beschränken (`trust`, etwa alle, die je im Club gehandelt haben); geteilte Schlüssel kosten nichts und werden immer probiert.
- Unbekannte Umschlagversion (`v` ≠ 1): aufbewahrt, nicht ausgeführt.

Das Verfahren ist eine eigene Zusammensetzung geprüfter Bausteine (NIP-44, XChaCha20-Poly1305 aus `@noble/ciphers`) und wird vor der Veröffentlichung extern geprüft (Entscheidung 0002 §6, Nutzerhandlung).

## Datensatztypen (NIP-32-Labels)

Die vollständigen Inhaltsschemas stehen maschinenlesbar in [`schemas/`](schemas/) und werden aus dem Code erzeugt.

| Familie | Typen |
| --- | --- |
| Club (1180) | `club.found`, `club.update`, `club.invite`, `club.invite.revoke`, `club.join`, `club.accept`, `club.decline`, `club.leave`, `club.remove`, `club.role`, `club.owner.offer`, `club.owner.cancel`, `club.owner.accept`, `club.keys`, `club.season`, `club.season.rules`, `club.season.end`, `club.result`, `club.date`, `club.game`, `club.rsvp` |
| Turnier (1180) | `tournament.found`, `tournament.update`, `tournament.phase`, `tournament.seed`, `tournament.draw`, `tournament.register`, `tournament.withdraw`, `tournament.admit`, `tournament.waitlist`, `tournament.remove`, `tournament.guest`, `tournament.claim`, `tournament.link`, `tournament.checkin`, `tournament.board`, `tournament.board.revoke`, `tournament.assign`, `tournament.result`, `tournament.approve`, `tournament.correct`, `tournament.handover.offer`, `tournament.handover.cancel`, `tournament.handover.accept` |
| Match (1180) | `match.session`, `match.seat`, `match.result`, `match.log`, `match.confirm` |
| Match (31180) | `match.live` |
| Profil (31180) | `profile.stats` |
| Zahlung (Rumor, 1180) | `payment.request` |
| Handshake (21180) | Bereich `pair` oder `board` als Label; der Nachrichtentyp steht im verschlüsselten Inhalt |
| Auszeichnung | `badge.evidence` (1180); im NIP-58-Format `badge.definition` (30009), `badge.award` (8) |

## Grenzen

| Grenze | Wert | Grund |
| --- | --- | --- |
| Signiertes Event als JSON | ≤ 32 768 Byte | strfry-Standard ist 64 KiB; die Hälfte passt bei allen Relays des Katalogs (Recherche PR-07) |
| Ein Tag-Wert | ≤ 1 024 Byte | strfry `maxTagValSize`; eingebettete Nachweise stehen deshalb im Inhalt |
| Klartext vor NIP-44 oder Siegel | ≤ 20 480 Byte | passt verschlüsselt in 32 KiB |
| Klartext im Gift Wrap | ≤ 13 887 Byte | Seal und Wrap zusammen in 32 KiB |
| `created_at` in der Zukunft | ≤ 900 s | strfry verwirft weiter vorausdatierte Events; Leser wenden dasselbe Fenster an |
| Alter flüchtiger Nachrichten | ≤ 600 s beim Leser | Relays verwerfen ältere als 60 s; der Leser lässt einen Kopplungsvorgang lang Uhrabweichungen zu |
| Kopplungs-QR / Code | ≤ 10 min gültig | Entscheidung 0002 §7 |
| Board-QR | ≤ 60 min gültig | Spieler sammeln sich am Board; danach zeigt das Board einen neuen QR |
| Übergabeangebot (`tournament.handover.offer`, `club.owner.offer`) | ≤ 7 Tage offen (`MAX_OFFER_SECONDS`) | eine Annahme danach gilt nicht; ein Rückzug hält nur ehrliche Geräte auf ([conflicts.md](conflicts.md#übergaben-turnierleitung-club-eigentum), Ü1, Ü6) |
| Leser eines versiegelten Events, Mitglieder eines geschlossenen Clubs | ≤ 100 | jede Verpackung kostet Platz im Event; ein geschlossener Club ohne eigene Höchstzahl nimmt danach nur noch auf Anfrage auf (an der Grenze entscheiden die Zeitstempel, deshalb setzt `lib/clubs` ab etwa 90 Mitgliedern eine Höchstzahl, [club.md](families/club.md#einladungen-und-beitritt)), ein größerer öffentlicher Club lässt sich nicht schließen |
| Geteilte Schlüssel je `club.keys` | ≤ 150 laut Schema; wie viele passen, hängt von den Lesern ab: 150 bis 20 Leser, 122 bei 50, 68 bei 100 (`maxSharedKeys`) | Verpackungen und Schlüssel teilen sich die 32 KiB; mehr in mehreren Datensätzen |
| Turnierteilnehmer | ≤ 128 | erste verbindliche Lastgröße (PLAN.md); wie die Turnier-Engine |

Größere Daten werden in hash-verkettete Stücke geteilt ([`chunks.ts`](../../lib/protocol/chunks.ts)): `prev_0` = 64 × „0", `hash_i = sha256(prev_i ‖ data_i)`, jedes Stück nennt den Kopf `set`; der verweisende Datensatz nennt Kopf, Stückzahl und Größe. Vektoren: [`vectors/chunks.json`](vectors/chunks.json).

## Versionsregeln

1. **`v` ist die Hauptversion des Inhalts eines Typs.** Heute gilt überall `"1"`.
2. **Innerhalb einer Hauptversion** sind nur zusätzliche optionale Felder erlaubt. Leser ignorieren unbekannte Felder (Objekte sind offen), Schreiber deuten kein Feld um, Pflichtfelder kommen nicht hinzu, Wertebereiche werden nicht so erweitert, dass ältere Leser gültige Daten ablehnen würden. Alles andere ist eine neue Hauptversion.
3. **Unbekannte Version oder unbekannter Typ** im Namensraum `blueline`: Das Event wird aufbewahrt, unter „Erweitert" als „unbekannte Version" gezeigt und **nicht ausgeführt**. Ändert ein späteres bekanntes Event denselben Gegenstand auf Basis des unbekannten, ist es ein sichtbarer Konflikt (`stale_predecessor`), keine stille Übernahme. Vektor: `club` › `unknown-version-and-time`.
4. **Nachrichten ohne Speicherwert** (Kopplung, Board) sind strikt: unbekannte Felder führen zur Ablehnung, damit nichts unbemerkt mitreist.
5. **Eigene Versionskennungen** tragen außerdem: die Wurfkodierung (führende Ziffer, heute `1`), die Spielregeln (`agreement.engine`, heute `1` = `lib/game/engine.ts`), die Turnierregeln (`tournament.found.engine`, heute `1` = `lib/tournaments`; ein Turnier einer neueren Engine wird nicht abgespielt), der versiegelte Umschlag (`v` im Umschlag), der private Umschlag (erstes Byte `0x01`), die Link-Nutzlasten (`P1`, `B1`, `W1`, `C1`, `T1`, `U1`).
6. **Kind-Nummern ändern sich nicht.** Neues Verhalten bekommt einen neuen Typ oder eine neue Hauptversion.

## Prüfreihenfolge beim Lesen

`parseRecord` ([`records.ts`](../../lib/protocol/records.ts)) prüft in dieser Reihenfolge und nennt den ersten Grund ([conflicts.md](conflicts.md#ablehnungsgründe)): Form (`invalid_event`) → Kind (`wrong_kind`) → Labels (`not_blueline`) → Größe (`too_large`) → Tag-Längen (`tag_too_long`) → Zeit (`future_timestamp`) → bekannter Typ und Version (sonst „unbekannt", nicht abgelehnt) → Kind passt zum Typ → Wurzel- und `d`-Tags (`invalid_tags`) → Verschlüsselungsform des Typs (`invalid_tags`, `sealing_required`) → Umschlag (`invalid_content`, neuere Umschlagversion: „unbekannt“) → ohne Klartext: „versiegelt“ → Inhalt gegen Schema (`invalid_content`) → Querprüfungen (Gültigkeit eines Übergabeangebots `invalid_content`, `stake_requires_private`, `sealing_required`). Signatur und Id prüft vorher `lib/nostr` mit nostr-core; die Berechtigung prüfen danach die Reducer.
