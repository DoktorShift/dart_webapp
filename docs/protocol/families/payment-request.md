# Familie: Zahlungsanfrage zwischen Spielern

Stand: P0.05. Code: [`payment.ts`](../../../lib/protocol/payment.ts). Schema: [`schemas/payment-request.schema.json`](../schemas/payment-request.schema.json). Vektoren: [`vectors/payment-request.json`](../vectors/payment-request.json). Grundlage: PLAN.md „Direkte Zahlungen“, Entscheidung 0002 §8, Recherche PR-06, PR-17.

## Zweck

„Empfangen“ erzeugt über die Wallet des Gewinners eine Rechnung; sie kann als QR gezeigt (vor Ort, ohne Event) oder dem Mitspieler als private Anfrage geschickt werden. **Eine Anfrage ist nie eine Zahlungsfreigabe:** Der Zahler sieht Empfänger, Betrag und Ablauf und entscheidet selbst; nichts in BlueLine zahlt von allein, keine fremde Nachricht löst `payInvoice` aus.

## Form

Ein **ungesignetes Rumor** der Kind 1180 mit den Pflicht-Labels (`payment.request`), `["e", <match-id>]` und genau einem `["p", <zahler>]`, versiegelt vom Profilschlüssel des anfragenden Spielers (NIP-59 Seal, Kind 13) und als Gift Wrap (Kind 1059) an den Zahler. Als gewöhnliches signiertes Event ist der Typ ungültig (`wrong_kind`): Anfragen reisen nur verpackt. Zustellung nur an die Inbox-Relays des Zahlers (Kind 10050); ohne solche bleibt der QR vor Ort (PR-17). nostr-core 1.0.4 versiegelt nur mit rohem Schlüssel und prüft die Rumor-ID nicht; beides ergänzt `lib/nostr` (PR-06).

| Feld | Bedeutung |
| --- | --- |
| `amount` | Betrag in msat, ganze sats, ≥ 1 000 |
| `invoice` | BOLT11-Rechnung, klein geschrieben |
| `hash` | Zahlungs-Hash der Rechnung; Idempotenzschlüssel (eine Rechnung wird nie zweimal bezahlt) |
| `expires` | Ablauf der Anfrage, nicht nach dem der Rechnung |
| `seat` | Platz des anfragenden Spielers im Match |
| `memo?` | kurzer Text |

## Prüfung vor der Anzeige (`checkPaymentRequest`)

1. Die Rumor-ID stimmt mit dem Inhalt überein (`invalid_event`).
2. Seal-Autor = Rumor-Autor (`not_authorized`): die einzige Bindung an eine Identität ist die Seal-Signatur des Profils.
3. Typ, Version (neuere Version: nicht ausgeführt, `unknown_version`), Match (`wrong_root`), Zahler (`invalid_tags`), Zeit (`future_timestamp`), Schema.
4. **Der Anfragende ist ein Spieler dieses Matches mit Profil** und beansprucht seinen eigenen Platz; der Zahler ist ein anderer Spieler (`not_a_player`). Ein Board-, Sitzungs- oder fremder Schlüssel kommt nie in Frage (Vektor `session-key-requests`).
5. Betrag = vereinbarter Einsatz, wenn einer vereinbart ist (`amount_mismatch`); Rechnung mit `decodeBolt11` von nostr-core: Betrag vorhanden und gleich, Hash gleich, Anfrage überdauert die Rechnung nicht (`invoice_mismatch`), beide nicht abgelaufen (`invoice_expired`).

Danach zeigt die App „500 sats an Mia zahlen“; bezahlt wird erst nach Bestätigung, mit Journal-Eintrag und Klärung eines unbekannten Status über `lookupInvoice`, nie durch erneutes Senden (Entscheidung 0002 §8).

## Sichtbarkeit

Relays sehen einen Gift Wrap an den Zahler (Empfänger im `p`-Tag des Wraps, zufälliger Wrap-Schlüssel, verschleierte Zeit); Inhalt, Betrag und Anfragender sind verschlüsselt ([privacy.md](../privacy.md)).

## Vektoren

`valid`, `session-key-requests`, `seal-differs`, `wrong-amount`, `hash-differs`, `expired`, `other-seat`, `newer-version`, `tampered-id`. Die Rechnung ist das Beispiel aus der BOLT11-Spezifikation; ihre Dekodierung prüft der Test unabhängig mit nostr-core.
