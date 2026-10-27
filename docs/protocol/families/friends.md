# Familie: Freunde

Stand: 26. Oktober 2026. Code: [`friend.ts`](../../../lib/protocol/friend.ts) (die drei Nachrichten), [`lib/friends/`](../../../lib/friends/) (`model.ts` Zustände, `list.ts` der private Datensatz, `messages.ts` Senden und Lesen), [`lib/profile/inbox.ts`](../../../lib/profile/inbox.ts) (Eingang der Gift Wraps). Schema: [`schemas/friends.schema.json`](../schemas/friends.schema.json).

## Zweck

Freunde sind Profile, die sich gegenseitig als solche eingetragen haben: beim Spielen mit einem Tipp am Tisch, in der Rangliste mit den Zahlen nebeneinander, die jeder von sich zeigt. Eine Freundschaft ist gegenseitig wie in Game Center: eine Seite fragt, die andere nimmt an. Wer mit wem befreundet ist, geht niemanden sonst etwas an: Es gibt keine öffentliche Follow-Liste (kein Kind 3, kein Kind 30000 dafür), und Relays sehen weder Absender noch Inhalt der Nachrichten.

## Die Liste: privater Datensatz `friends`

Jedes Profil hält seine Freunde als einen privaten Datensatz ([private-records.md](private-records.md), Kind 30078, `type` = `id` = `friends`), verschlüsselt mit dem Datenschlüssel des Profils, damit alle Geräte des Profils dieselben Personen und dieselben offenen Anfragen zeigen. Die neueste Version gewinnt; jede Änderung wird auf der Version gemacht, die die Relays gerade halten (`lib/sync/small-record.ts`, wie die Geräteliste).

```
data = { "friends": [ { "pubkey", "state", "since", "relays"?, "message"? }, … ],
         "handled": { "<pubkey>": <unix-sekunden>, … } }
```

| Feld | Bedeutung |
| --- | --- |
| `pubkey` | das Profil der Person (32 Byte hex) |
| `state` | `friend` (gegenseitig), `sent` (ich habe gefragt), `received` (die Person hat gefragt) |
| `since` | wann der Eintrag diesen Zustand bekam (Unix-Sekunden) |
| `relays` | höchstens zwei Relays aus dem Profil-Link der Person, damit eine Nachricht sie findet |
| `message` | die Zeile, die mit einer empfangenen Anfrage kam (höchstens 140 Zeichen) |
| `handled` | je Person die Zeit des letzten Worts, das zählte: `created_at` des Rumors einer angenommenen Nachricht oder die Zeit einer eigenen Handlung. Eine Nachricht, deren `created_at` kleiner ist, ist veraltet und ändert nichts. Höchstens 1000 Personen; Personen mit Eintrag bleiben, von den anderen die neuesten |

Namen stehen nicht in der Liste; sie kommen aus dem öffentlichen Profil (Kind 0), wenn die Person gezeigt wird. Eine Liste hat höchstens 500 Einträge (eine 501. Anfrage, eigene oder fremde, wird nicht angenommen); Einträge ohne die Form werden beim Lesen ausgelassen, nie geraten. Änderungen eines Geräts laufen nacheinander, jede auf der Version, die die vorige schrieb.

## Die Nachrichten (Rumor, Kind 1180)

Drei Datensatztypen, jeder nur als Rumor in einem NIP-59 Gift Wrap (Kind 1059) an genau eine Person, versiegelt mit dem Schlüssel des Profils, Tag `p` = die andere Person, kein `e`-Tag. Als signiertes Event sind sie ungültig (`wrong_kind`), wie `club.invitation`.

| Typ | Inhalt | Bedeutung |
| --- | --- | --- |
| `friend.request` | `message?` (≤ 140 Zeichen) | „Ich möchte mit dir befreundet sein“ |
| `friend.accept` | `{}` | nimmt eine Anfrage an; die Freundschaft ist gegenseitig |
| `friend.remove` | `{}` | beendet eine Freundschaft oder zieht die eigene Anfrage zurück |

Gesendet wird an die allgemeinen Relays, die `relays` des Eintrags und bis zu vier Lese-Relays aus der Relay-Liste der Person (Kind 10002), wenn ihr Profil auf dem Gerät bekannt ist, über den Ausgang (`lib/sync/outbox.ts`), also so lange, bis ein Relay die Nachricht hat. Die Nachricht geht innerhalb der Änderung des Datensatzes in den Ausgang: nachdem die Version der Relays gelesen ist (ohne Verbindung oder Datenschlüssel geht nichts raus) und bevor sie geschrieben wird; scheitert das Schreiben danach, wird die Nachricht aus dem Ausgang zurückgenommen. So entsteht weder eine Änderung, von der die andere Seite nie erfährt, noch eine Nachricht ohne Änderung. Eine Nachricht, deren `created_at` gleich dem gemerkten Wort ist, zählt noch (zwei Seiten in derselben Sekunde); nur Älteres ist veraltet. Gelesen werden die eigenen Gift Wraps am Eingang des Profils, nur mit einem Schlüssel auf dem Gerät (eine Signer-App würde bei jedem Wrap fragen); der Rumor zählt nur, wenn sein Autor der Autor des Siegels ist, `p` der eigene Pubkey und der Typ einer der drei.

## Zustände

| Ich | es kommt | dann |
| --- | --- | --- |
| nichts | `friend.request` | `received`, mit `message` |
| `sent` | `friend.request` | `friend`, und ich sende `friend.accept` (beide fragten) |
| `sent` | `friend.accept` | `friend` |
| `received` | ich nehme an | `friend`, ich sende `friend.accept` |
| `received` | ich frage selbst | `friend`, ich sende `friend.accept` |
| `received` | ich lehne ab | Eintrag weg, nichts gesendet (wie „Ignorieren“ in Game Center) |
| `friend` oder `sent` | ich entferne | Eintrag weg, ich sende `friend.remove` |
| beliebig | `friend.remove` | Eintrag weg |
| beliebig | Nachricht mit `created_at` < `handled[pubkey]` | nichts (veraltet: Relays spielen die letzten Tage bei jedem Start erneut aus) |

Ein `friend.accept` von jemandem, den ich nicht gefragt habe, ändert nichts; eine zweite Anfrage derselben Person ändert nichts. Eine abgelehnte Anfrage bleibt abgelehnt, bis die Person neu fragt; ein altes `friend.remove` hebt keine neuere Freundschaft auf. Wer eine Freundschaft entfernt, verschwindet aus beiden Listen, sobald die Nachricht ankommt; gemeinsame Spiele bleiben, wo sie sind.

## Sichtbarkeit

Die Rangliste „Freunde“ zeigt nur, was jede Person selbst unter Sichtbarkeit freigibt (die Statistikkarte `profile.stats`, [profile.md](profile.md)). Eine Freundschaft gibt nichts zusätzlich frei; eine Stufe „nur Freunde“ für die Karte gibt es nicht ([Entscheidung E25](../../ux/profil-rangliste-vorschlag.html)).

## Ablehnungen

`wrong_kind` (als signiertes Event), `invalid_content` (Inhalt passt nicht zum Schema), `invalid_tags` (ein `e`-Tag). Ein Wrap, der sich nicht öffnen lässt oder keinen BlueLine-Rumor trägt, wird übergangen: Andere Apps legen ihre Wraps am selben Ort ab.
