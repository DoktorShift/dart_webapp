# Familie: Private Datensätze des Profils

Stand: P0.05, umgesetzt in P3b.01 (Verschlüsselung und Abgleich: [`lib/sync/records.ts`](../../../lib/sync/records.ts), [`lib/sync/data-key.ts`](../../../lib/sync/data-key.ts), [`lib/sync/engine.ts`](../../../lib/sync/engine.ts)). Code: [`private.ts`](../../../lib/protocol/private.ts), [`chunks.ts`](../../../lib/protocol/chunks.ts). Schema: [`schemas/private-records.schema.json`](../schemas/private-records.schema.json). Vektoren: [`vectors/private-records.json`](../vectors/private-records.json). Grundlage: Entscheidung 0001 F2, Entscheidung 0002 §4 und §6.

## Zweck

Lokal ist die maßgebliche Kopie. Mit einem Profil liegt die private Spielhistorie (und weitere private Daten: Spielerverzeichnis, Einstellungen, Clubliste, Geräte, Auszeichnungsauswahl, Zahlungsjournal) zusätzlich verschlüsselt auf mindestens drei Relays verschiedener Betreiber, damit „Ergebnisse mitnehmen“ auf einem neuen Gerät funktioniert.

## Kind und Tags

NIP-78, Kind **30078**, signiert vom Profil, **genau ein Tag**: `["d", <nicht sprechende Kennung>]`. Keine Labels, kein Typ, keine Verweise. Kind 78 wird nicht verwendet, weil nos.lol und Primal es am 4. Oktober 2026 nicht auslieferten (Entscheidung 0002 §6). Ein Datensatz mit weiteren Tags oder von einem anderen Autor wird abgelehnt.

## Schlüssel und Kennungen

```
d       = hex(HMAC-SHA256(datenschlüssel, "blueline-record-v1:" + datensatz-id))
content = base64(0x01 ‖ 24-Byte-Nonce ‖ XChaCha20-Poly1305(datenschlüssel, nonce, klartext, aad = d))
```

Der Datenschlüssel (32 Zufallsbytes je Profil) liegt in einem eigenen Datensatz, den man allein über den Pubkey findet, NIP-44-verschlüsselt an das Profil selbst; so braucht ein externer Signer nur eine Entschlüsselung je Gerät:

```
d = hex(sha256("blueline-data-key-v1:" + pubkey)),  content = NIP-44({ "v": 1, "key": <hex>, "created": <zeit> })
```

Die Bindung an `d` als zusätzliche Daten verhindert, dass ein Datensatz unbemerkt in eine andere Kennung verschoben wird.

## Klartext

`{ v: 1, type, id, rev, device, at, data | parts | deleted }`: `type` (etwa `match`, `players`, `settings`, `clubs`, `devices`, `friends`, `badges`, `payments`), `id`, Lamport-Zähler `rev` und schreibendes Gerät `device` (zwei Geräte, die denselben Datensatz offline ändern, werden unterschieden statt überschrieben, Recherche PR-18), genau eines von `data` (bis 20 000 Byte), `parts` (Kopf, Stückzahl, Größe größerer Daten) oder `deleted`. Teile liegen unter `recordSlot(schlüssel, id + "#" + seq)` mit `{ v, of, set, seq, total, prev, data }` und werden wie Matchprotokolle hash-verkettet.

## Sichtbarkeit, Aufbewahrung, Löschung

Öffentliche Relays sehen Autor, Kind 30078, Zeitpunkt, Größe (mit Auffüllung nur teilweise verdeckt) und eine Kennung ohne Bedeutung ([privacy.md](../privacy.md)). NIP-44 und der Datenschlüssel haben keine Vorwärtssicherheit: Wer später den Datenschlüssel erlangt, liest alles. „Gesichert“ gilt erst, wenn ein Datensatz über eine neue Verbindung wieder gelesen wurde (Entscheidung 0002 §5). Löschen ist eine NIP-09-Bitte und ein überschreibender Datensatz mit `deleted`.

## Ablehnungen

`wrong_kind`, `not_authorized` (anderer Autor), `invalid_tags`, `too_large`, `invalid_content`, `unknown_version` (Umschlag ≠ 0x01).
