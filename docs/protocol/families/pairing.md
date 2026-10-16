# Familie: Gerätekopplung (eigenes Gerät hinzufügen)

Stand: P0.05. Code: [`pairing.ts`](../../../lib/protocol/pairing.ts), [`handshake.ts`](../../../lib/protocol/handshake.ts), [`links.ts`](../../../lib/protocol/links.ts). Schema: [`schemas/pairing.schema.json`](../schemas/pairing.schema.json). Vektoren: [`vectors/pairing.json`](../vectors/pairing.json). Grundlage: Entscheidung 0001 F9, Entscheidung 0002 §7, Recherche DR-08 bis DR-11.

## Zweck

Ein neues Gerät bekommt das Profil eines vorhandenen Geräts, ohne Server: verschlüsselte flüchtige Nachrichten über öffentliche Relays zwischen zwei Einmalschlüsseln, eine Prüfkennung auf beiden Bildschirmen und das Profilpaket erst nach Bestätigung auf beiden Geräten. Das Paket selbst (Schlüssel, Relay-Hinweise, Einstellungen) definiert `lib/devices`; die Spielhistorie folgt danach über den normalen Abgleich.

## Sicherheitsregeln

1. **Nur aus „Eigenes Gerät hinzufügen“** im Profil des vorhandenen Geräts, nie über den allgemeinen Scanner oder einen Board-QR (DR-08). Jede QR- und Link-Art hat ihr eigenes Präfix; ein Board-QR (`B1`) wird nie als Kopplungs-QR (`P1`) gelesen und umgekehrt (`wrong_flow`).
2. **Geheimnis im QR oder Code** (F9): Beim QR ist die zufällige 128-Bit-Sitzungs-ID das Geheimnis; sie steht nur im QR beziehungsweise Link-Fragment und auf Relays nur NIP-44-verschlüsselt. Eine `hello`-Nachricht mit falscher Sitzungs-ID wird verworfen. Beim eintippbaren Code ist der Code selbst das Geheimnis (60 Bit).
3. **Prüfkennung** erst nach dem Schlüsselaustausch, aus beiden Einmalschlüsseln und der Sitzungs-ID, nie der eingetippte Code. Beide Personen bestätigen sie; ein Gerät, das die Anzeige kontrolliert, kann sie nicht fälschen, ohne den Schlüssel auszutauschen.
4. **Einmalig und befristet:** Jede Sitzungs-ID gilt einmal; höchstens 10 Minuten; das vorhandene Gerät lehnt abgelaufene QR-Codes ab (Screenshot-Wiederholung); das neue Gerät nimmt nur die erste gültige Antwort an (`session_taken`). Einmalschlüssel werden danach gelöscht.
5. **Fertig erst nach Bestätigung:** „Dein Profil ist dabei.“ erscheint erst, wenn das neue Gerät den Hash des entschlüsselten Pakets zurückgemeldet hat (`ack`). Bis dahin wiederholen die Geräte ihre Nachrichten; Relays verwerfen flüchtige Events ohne Zuhörer („mute:“), das gilt als „später erneut“ (DR-10). Zustand und Einmalschlüssel liegen in IndexedDB, damit die Kopplung einen Neustart übersteht.

## Links und QR-Codes

Alle Links zeigen auf `/` und tragen alles im Fragment (`#…`), das Browser nie an einen Server senden (Entscheidung 0001 F6). Werte mit 32 oder 16 Byte stehen als base64url ohne Auffüllung, Zeiten in Basis 36, Relays kommagetrennt ohne `wss://`, höchstens vier.

| Fragment | Nutzlast | Zweck |
| --- | --- | --- |
| `#pair=` | `P1.<einmal-pubkey>.<sitzungs-id>.<ablauf>.<relays>` | Kopplung (dieses Dokument) |
| `#board=` | `B1.<einmal-pubkey>.<sitzungs-id>.<ablauf>.<relays>` | Platz an einem Board ([board-join.md](board-join.md)) |
| `#handoff=` | `H1.<einmal-pubkey>.<sitzungs-id>.<ablauf>.<relays>` | Laufendes Spiel auf einem anderen Gerät fortsetzen ([session-authorization.md](session-authorization.md#schreiberwechsel-auf-ein-anderes-gerät)) |
| `#watch=` | `W1.<match-id>.<spielschlüssel oder leer>.<relays>` | Zuschauen; der Spielschlüssel öffnet private Spiele |
| `#club=` | `C1.<club-id>.<einladungs-event-id>.<token>.<relays>` (Einladungsteile dürfen fehlen) | Club ansehen oder einladen ([club.md](club.md#einladungen-und-beitritt)) |
| `#tournament=` | `T1.<turnier-id>.<relays>` | Anmeldung oder Zuschauen |
| `#p=` | `U1.<pubkey>.<relays>` | öffentliches Profil |

Spielschlüssel und Einladungs-Token sind Inhabergeheimnisse: Wer den Link hat, liest das private Spiel beziehungsweise die Einladungsvorschau und kann beitreten ([privacy.md](../privacy.md)). Ein Kopplungslink hat etwa 110 Zeichen.

## Code ohne Kamera

12 Zeichen aus dem Crockford-Base32-Alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (60 Zufallsbit), angezeigt als `XXXX-XXXX-XXXX`. Eingabe ohne Unterschied von Groß- und Kleinschreibung, Leerzeichen und Striche egal, `O` gilt als `0`, `I` und `L` als `1`. Aus dem Geheimnis:

```
lookup = HKDF-SHA256(geheimnis, salt "blueline-pair-v1", info "lookup", 16 Byte)   Tag "x" der Ankündigung
auth   = HKDF-SHA256(geheimnis, salt "blueline-pair-v1", info "auth", 32 Byte)     Schlüssel der MACs
announce.mac = HMAC-SHA256(auth, "announce:" + neues-gerät + ":" + sitzungs-id + ":" + ablauf)
hello.mac    = HMAC-SHA256(auth, "hello:" + vorhandenes-gerät + ":" + neues-gerät + ":" + sitzungs-id)
```

Wer auf den Relays mitliest, kann ohne Code weder die Ankündigung finden noch eine gültige Antwort fälschen; 60 Bit lassen sich in zehn Minuten nicht durchprobieren. Ohne Vermittler gibt es keine Ratenbegrenzung (Entscheidung 0001, Grenze 6); deshalb kein kürzerer Code.

## Prüfkennung

```
digest = sha256("blueline-pair-sas-v1" ‖ 0x00 ‖ pubkey neues Gerät ‖ pubkey vorhandenes Gerät ‖ sitzungs-id)
kennung = (erste 5 Byte von digest als Zahl) mod 10^8, achtstellig, angezeigt als "1234 5678"
```

Rund 26 Bit; die Reihenfolge der Schlüssel ist festgelegt (neues Gerät zuerst).

## Nachrichten (Kind 21180, Label `pair`)

Flüchtig, NIP-44 zwischen den Einmalschlüsseln, Empfänger im `p`-Tag. Nur die Ankündigung des Code-Wegs ist Klartext und trägt statt eines Empfängers das `x`-Tag. Der Nachrichtentyp steht im verschlüsselten Inhalt; Relays sehen Kind, Autor, Empfänger und Zeit. Nachrichten sind strikt: unbekannte Felder führen zur Ablehnung.

| Nachricht | Von → an | Inhalt |
| --- | --- | --- |
| `announce` | neues Gerät → alle (nur Code-Weg) | `sid`, `exp`, `mac` |
| `hello` | vorhandenes → neues Gerät | `sid`, `device` (Gerätename), `mac?` (Code-Weg) |
| `accept` | neues → vorhandenes Gerät | `sid`, `device`; nach Bestätigung der Prüfkennung |
| `package` | vorhandenes → neues Gerät | `sid`, `data` (Profilpaket, ≤ 13 687 Byte) |
| `ack` | neues → vorhandenes Gerät | `sid`, `hash` = sha256 des Pakets als JSON |
| `abort` | beide | `sid`, `reason` (`declined` / `expired` / `mismatch` / `error`) |

Ablauf QR: neues Gerät zeigt `P1`-QR → vorhandenes Gerät scannt, sendet `hello` → beide zeigen die Prüfkennung → neues Gerät bestätigt und sendet `accept` → vorhandenes Gerät bestätigt → `package` (wiederholt bis `ack`) → `ack` → beide fertig. Code-Weg: zuerst `announce` unter `x` = lookup, das vorhandene Gerät prüft deren MAC (`checkAnnounce`), danach wie oben mit MAC in `hello`.

`applyPairingMessage` und `confirmPairingHere` führen den Zustand (`waiting` → `confirm` → `transfer` → `done`, oder `aborted` / `expired`) rein funktional; `lib/devices` speichert ihn. Ein `abort` gilt nur vom Gegenüber: Solange das neue Gerät noch auf eine Antwort wartet, kennt jeder Mitleser seine Ankündigung, deshalb wird ein `abort` dann abgelehnt (`out_of_order`).

## Profilpaket

`data` der `package`-Nachricht ([`lib/recovery/package.ts`](../../../lib/recovery/package.ts), dasselbe Paket steckt verschlüsselt in der Sicherungsdatei und im Passkey-Paket):

```
{ v: 1, pubkey, access: { kind: "local", key } | { kind: "nip07" | "nip46" | "nip55" },
  dataKey?: { key, created, event }, events: [<Relay-Liste 10002>, <Metadaten 0>] }
```

`access.kind` „local“ trägt den Profilschlüssel; ein Profil in einer Signer-App trägt keinen Schlüssel, das neue Gerät verbindet seinen eigenen Signer. `dataKey` ist der Datenschlüssel der privaten Datensatze samt seinem signierten Datensatz ([private-records.md](private-records.md)); `events` sind die eigenen ersetzbaren Events, wie das sendende Gerät sie kennt, damit das neue Gerät Name und Relays sofort hat. Das empfangende Gerät prüft jede Signatur und dass der Schlüssel zum `pubkey` gehört, bevor es etwas behält. Name und Relay-Liste werden zuerst weggelassen, wenn das Paket sonst nicht in die Nachricht passt. Das neue Gerät zeigt auf beiden Wegen zuerst den QR-Link und den eintippbaren Code zugleich (zwei Sitzungen auf einem Einmalschlüssel; die zuerst beantwortete gilt, die andere schließt).

## Ablehnungen

`wrong_flow`, `session_mismatch`, `session_taken`, `out_of_order`, `mac_invalid`, `expired_message`, `future_timestamp`, `invalid_content`, `invalid_tags`, `unknown_version`.

## Vektoren

Code, abgeleitete Schlüssel, Prüfkennung, alle Link-Arten und die vollständige Nachrichtenfolge beider Geräte samt gefälschtem `hello` und einer Board-Nachricht als Gegenprobe ([`vectors/pairing.json`](../vectors/pairing.json)).
