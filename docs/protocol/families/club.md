# Familie: Club

Stand: P0.05 (nach Review Runde 3). Code: [`club.ts`](../../../lib/protocol/club.ts) (Typen und Schemas), [`club-state.ts`](../../../lib/protocol/club-state.ts) (Zustand), [`invite.ts`](../../../lib/protocol/invite.ts) (Einladungen), [`seal.ts`](../../../lib/protocol/seal.ts) (geschlossene Clubs). Schema: [`schemas/club.schema.json`](../schemas/club.schema.json). Vektoren: [`vectors/club.json`](../vectors/club.json), [`vectors/invite.json`](../vectors/invite.json), [`vectors/seal.json`](../vectors/seal.json). Rechte: [permissions.md](../permissions.md).

## Zweck

Ein Club ist die Event-ID seines `club.found`. Mitglieder, Rollen, Einladungen, Saisons, Termine und Ergebnisentscheidungen ergeben sich durch Abspielen aller Club-Datensätze ([conflicts.md](../conflicts.md)). Es gibt keinen Server, der Mitgliedschaft durchsetzt: Jeder Client spielt dieselben signierten Datensätze ab und kommt zum selben Zustand.

## Kind, Tags, Verschlüsselung

Kind 1180, Pflicht-Tags nach [kinds.md](../kinds.md); `e` = Club-ID (außer bei `club.found`).

- **Öffentlicher Club** (`visibility: "public"`): Datensätze im Klartext, auch Einladungen (sie nennen nur den öffentlichen Einladungsschlüssel, nie den Token, und tragen dort keine Bezeichnung); nur `club.keys` ist versiegelt. Jeder Leser prüft damit jeden Beitritt selbst und sieht denselben Club. Einen anderen versiegelten Datensatz lehnt ab, wer ihn öffnen kann (`invalid_tags`), wer nicht, kann ihn nicht anwenden; so wirkt er für niemanden (Vektoren `public-club-sealed-invite-read-by-*`). Eine versiegelte öffentliche Gründung ergibt keinen Club.
- **Geschlossener Club** (`visibility: "closed"`, Standard für neue Clubs, PLAN.md „Clubs und Saisons“): ab der Gründung ist jeder Datensatz versiegelt, außer `club.join` (kommt von jemandem, der die Leser nicht kennt) und `club.leave` (sagt nichts, was ein Relay nicht ohnehin sieht). Ein Klartext-Datensatz eines anderen Typs wird mit `sealing_required` abgelehnt; eine geschlossene Gründung im Klartext ergibt keinen Club. **Höchstens 100 Mitglieder** (`MAX_CLUB_MEMBERS`): Jedes versiegelte Event trägt eine Verpackung je Mitglied, mehr passen nicht in 32 KiB. Ohne eigene Höchstzahl gilt diese; ein öffentlicher Club mit mehr Mitgliedern lässt sich nicht schließen (`club_full`). An dieser Grenze entscheiden die Zeitstempel der Beitretenden (Ausnahme, siehe „Einladungen und Beitritt“).

Versiegelt wird nach dem Umschlag in [kinds.md](../kinds.md#versiegelter-umschlag): eigener Inhaltsschlüssel je Datensatz, NIP-44-Verpackung je Leser im selben Event. **Leser sind die aktuellen Mitglieder nach dem Stand des Autors**; `club.accept` (und jeder Datensatz, der eine Anfrage annimmt) zusätzlich die aufgenommene Person, `club.remove` zusätzlich die entfernte Person (damit ihre App den Ausschluss zeigt). Ein entferntes Mitglied wird danach nicht mehr verpackt; bereits Gelesenes bleibt bei ihm, das wird nicht anders dargestellt (Entscheidung 0002 §6).

**Neue Mitglieder** lesen Früheres über `club.keys`: Ein Eigentümer oder Admin teilt die Inhaltsschlüssel früherer Datensätze, versiegelt für die aktuellen Mitglieder. `openSealedEvents` öffnet erst über die eigenen Verpackungen, dann mit geteilten Schlüsseln; Signatur und Berechtigung jedes geöffneten Datensatzes werden wie immer geprüft, ein falscher Schlüssel öffnet nichts. So muss niemandem ein Zustand geglaubt werden, den er nicht selbst nachprüft.

## Datensatztypen

„Leser“ gilt für geschlossene Clubs. Alle Änderungen werden gegen die Rolle des Autors zum Zeitpunkt des Abspielens geprüft ([permissions.md](../permissions.md)).

| Typ | Autor | Inhalt | Regeln |
| --- | --- | --- | --- |
| `club.found` | Gründer (wird Eigentümer) | `name`, `about?`, `picture?` (https), `visibility`, `capacity?` (2–100) | Event-ID = Club-ID; geschlossen nur versiegelt, öffentlich nur im Klartext |
| `club.update` | Eigentümer, Admin | `prev`, geänderte Felder (`name`, `about`, `picture` oder `null`, `visibility`, `capacity` oder `null`, `archived`) | `visibility` und `archived` nur Eigentümer; `prev` = letzte Club-Änderung oder Club-ID; schließen nur mit höchstens 100 Mitgliedern |
| `club.invite` | Eigentümer, Admin | `kind` (`group` / `personal`), `key` (öffentlicher Einladungsschlüssel), `expires`, `label?` | Einladungs-ID = Event-ID; `expires` nach `created_at`; öffentlicher Club: Klartext ohne `label`; geschlossener Club: versiegelt, der Umschlag trägt die Vorschau `p`; endet endgültig mit der Rolle der erstellenden Person |
| `club.invite.revoke` | Eigentümer, Admin | `invite` (Event-ID) | einmal; kann der Leser die Einladung nicht öffnen: wartet |
| `club.join` | Beitretende | `invite?` (Event-ID), `proof?` (Signatur, beide zusammen) | nie versiegelt; siehe Beitritt |
| `club.accept` | Eigentümer, Admin | `request` (Event-ID des `club.join`), `member` | Kapazität wird hier geprüft |
| `club.decline` | Eigentümer, Admin | `request` | |
| `club.leave` | Mitglied, oder wer eine Anfrage zurückzieht | `{}` | Eigentümer erst nach Übergabe |
| `club.remove` | Eigentümer, Admin | `member`, `prev` (letzter Rollenwechsel des Mitglieds, sonst sein Beitritt), `reason?`, `info?` | Admin entfernt keine Admins, niemand den Eigentümer; einen Admin nur mit `info` (letzte gesehene `club.update`, [Ende einer Befugnis](../conflicts.md#ende-einer-befugnis)) |
| `club.role` | Eigentümer, Admin | `member`, `role` (`admin` / `director` / `member`), `prev`, `info?` | Admins ernennt und ändert nur der Eigentümer; einen Admin herabstufen nur mit `info` |
| `club.owner.offer` | Eigentümer | `to` (Mitglied), `prev`, `expires` (höchstens 7 Tage nach `created_at`), `info` (aktuelle `club.update` oder Club-ID), `member` (aktuelle Basis der angebotenen Person) | nennt den Stand, den es übergibt |
| `club.owner.cancel` | Eigentümer | `offer` | gilt nicht gegen eine Annahme, die vor ihm einsortiert ist oder ihn nicht kannte (Ü5, Ü6 a) |
| `club.owner.accept` | angebotenes Mitglied | `offer`, `info` (letzte gesehene `club.update` oder Club-ID), `member` (eigener letzter Rollenwechsel, sonst eigener Beitritt); beide der Stand des Angebots oder einer, der darauf aufbaut | nur die erste Annahme zählt, bis `expires`; Eigentümer wird Admin; Club-ID bleibt; bis zur Annahme folgen Clubangaben und die eigene Mitgliedschaft dem genannten Stand, gleich wer darüber schrieb ([Übergaben](../conflicts.md#übergaben-turnierleitung-club-eigentum)) |
| `club.keys` | Eigentümer, Admin | `keys`: bis 150 × [Event-ID, Inhaltsschlüssel] | immer versiegelt; ändert keinen Zustand; wie viele Schlüssel bei wie vielen Lesern passen, sagt `maxSharedKeys(leser)` in [`records.ts`](../../../lib/protocol/records.ts): 150 bis 20 Leser, 122 bei 50, 68 bei 100 |
| `club.season` | Eigentümer, Admin | `season` (16 Byte), `name`, `starts`, `ends?`, `rules` | Regelversion 1 |
| `club.season.rules` | Eigentümer, Admin | `season`, `version` (+1), `rules`, `reason?` | nach Saisonbeginn nur mit sichtbarer Begründung; nicht nach dem Ende |
| `club.season.end` | Eigentümer, Admin | `season` | |
| `club.result` | Eigentümer, Admin, Turnierleiter | `season`, `match`, `result` (Event-ID), `count` (zählt / zählt nicht), `prev`, `reason?` | `prev` = letzte Entscheidung zu diesem Match oder Club-ID; nicht nach Saisonende |
| `club.date` | Eigentümer, Admin, Turnierleiter | `date` (16 Byte), `title`, `starts`, `ends?`, `place?`, `note?`, `cancelled?`, `prev` | `prev` = letzte Fassung des Termins oder Club-ID |

Saisonregeln (`rules`): `modes` (zählende Spielarten), `points` (Sieg, Remis, Niederlage), `confirmations` (`none` / `opponent` / `all`), `minGames`, `tiebreak` (`wins`, `legDifference`, `headToHead`, `average`). Die Tabelle selbst berechnet `lib/clubs` aus den Matchergebnissen; `club.result` hält die Entscheidungen fest, die die Regeln nicht selbst treffen (etwa ein bestrittenes Ergebnis).

Öffentliche Termine laufen über NIP-52; `club.date` ist der Termin des geschlossenen Clubs, den NIP-52 nicht verschlüsselt anbietet (Recherche PR-13).

## Einladungen und Beitritt

Ein Einladungslink zeigt auf `/#club=C1.<club-id>.<einladungs-event-id>.<token>.<relays>` ([pairing.md](pairing.md#links-und-qr-codes)); der Token verlässt den Browser nie in Richtung Server.

**Nachweis** (Entscheidung 0002 §6, präzisiert nach Review P0.05 Runde 1):

```
einladungsschlüssel = HKDF-SHA256(ikm = token, salt = "blueline-invite-v1", info = "proof", 32 Byte)
key                 = x-only-Pubkey des Einladungsschlüssels      (steht im club.invite)
proof               = BIP-340-Signatur des Einladungsschlüssels über sha256("blueline-invite-v1:" + pubkey des Beitretenden)
```

Der Datensatz nennt nur `key`, nie den Token. Prüfen kann jeder, der den Datensatz lesen kann: in einem öffentlichen Club jeder, in einem geschlossenen die Mitglieder. Kopiert jemand den Nachweis eines anderen, gilt er nicht für den eigenen Schlüssel. Den Link kennt nur, wer ihn erstellt hat (seine Geräte halten den Token privat); andere Verantwortliche erstellen eigene Links, und ein Mitglied kann einen Gruppenlink nicht aus dem Datensatz wiederherstellen. **Eine Einladung endet mit der Rolle ihres Erstellers, endgültig:** Ist er nicht mehr Eigentümer oder Admin (herabgestuft, entfernt, ausgetreten), wird ein Beitritt darüber abgelehnt und eine Anfrage über seine persönliche Einladung nicht mehr angenommen (`invite_revoked`), auch wenn er die Rolle später wieder bekommt: Ein Link, der in falsche Hände kam, ist oft der Grund der Herabstufung (Vektoren `invite-ends-with-role`, `invite-ends-for-good`). Sonst könnte ein entfernter Admin mit neuen Schlüsseln weiter beitreten, und in einem geschlossenen Club sehen später ernannte Verantwortliche seine Einladung nicht, um sie zu beenden. Vektoren: [`vectors/invite.json`](../vectors/invite.json).

**Vorschau** (nur geschlossene Clubs): `vorschauschlüssel = HKDF-SHA256(ikm = token, salt = "blueline-invite-v1", info = "preview", 32 Byte)`. Die Vorschau (Name, Beschreibung, Bild, Gastgeber mit Anzeigename, Art, Ablauf, nächster Termin) steckt verschlüsselt im Umschlag des `club.invite`; der Link genügt, um sie zu lesen, auch ohne Profil. Ein öffentlicher Club zeigt vor dem Beitritt einfach seine öffentlichen Datensätze.

| Art | Wirkung eines gültigen `club.join` | Kapazität, Ablauf, Reihenfolge |
| --- | --- | --- |
| **Gruppenlink** (`group`) | sofort Mitglied (`via: "group"`), solange der Club **keine Höchstzahl** hat; mit Höchstzahl eine Anfrage (`check: "ok"`), über die ein Eigentümer oder Admin entscheidet. Ein geschlossener Club ohne eigene Höchstzahl nimmt bis 100 Mitglieder sofort auf, danach werden Beitritte Anfragen | Ablauf: `created_at` des Beitritts ≤ `expires`; Widerruf und Ende der Rolle des Erstellers: Beitritte danach werden abgelehnt |
| **Persönliche Einladung** (`personal`) | Anfrage (`check: "ok"`); Mitglied erst mit `club.accept`, einmalig | entscheidet die annehmende Person; eine zweite Nutzung wird abgelehnt (`invite_exhausted`) |
| **Ohne Einladung** | Anfrage (`check: "none"`) | entscheidet die annehmende Person |

So entscheidet über Kapazität und Reihenfolge die berechtigte Rolle, nie ein vom Beitretenden gesetzter `created_at` (Entscheidung 0001 Punkt 10, Vektor `group-link-with-limit`: Carol fragt zuletzt und wird zuerst aufgenommen). Die App zeigt bis zur Annahme „Deine Anfrage wartet auf Bestätigung“.

**Ausnahme: die Grenze von 100 Mitgliedern eines geschlossenen Clubs ohne eigene Höchstzahl.** Wer davor noch direkt aufgenommen wurde, folgt aus den Zeitstempeln der Beitritte. Ein späterer Beitritt mit gültigem Link, der vor einen anderen datiert ist, nimmt dessen Platz ein: Das Mitglied, das in Wirklichkeit früher kam, wird wieder eine Anfrage (`check: "ok"`) und verliert eine Rolle, die auf seinen Beitritt aufbaut (Vektor `member-limit-displacement`). Ein reiner Reducer kann das nicht verhindern, jede Grenze ohne Entscheidung einer Rolle ist ein Wettlauf um Zeitstempel. Deshalb gilt für `lib/clubs` (P5): **Das Gerät des Eigentümers veröffentlicht `club.update` mit `capacity: 100`, sobald ein geschlossener Club ohne eigene Höchstzahl etwa 90 Mitglieder hat** (bei jedem Öffnen geprüft, auch auf dem Gerät eines Admins). Danach werden Gruppenlink-Beitritte Anfragen, über die ein Admin entscheidet; eine Verdrängung bräuchte vorher mehr als zehn zurückdatierte Beitritte. Ob das genügt oder geschlossene Clubs immer eine Höchstzahl haben sollen, ist eine offene Nutzerentscheidung (Aufgabenkarte P0.05, Entscheidung 0002 §6).

Weitere Regeln beim Abspielen:

- Ein Beitritt, der vor seiner Einladung datiert ist, wird abgelehnt (`invite_unknown`, Vektor `backdated-join`).
- Kann der Leser die genannte Einladung nicht öffnen (in einem geschlossenen Club nicht für ihn verpackt und nicht freigegeben, oder noch nicht geladen), bleibt der Beitritt eine Anfrage mit `check: "unverified"`; die App zeigt „wartet auf Daten“, keine Ablehnung. Eigentümer und Admins können den Nachweis prüfen: Ihre Annahme, eine Rollenänderung oder Entfernung mit diesem Beitritt als `prev` oder ein Eigentumsangebot an die Person nimmt die Anfrage für diesen Leser an (mit den Prüfungen von `club.accept`; `via: "accepted"`). Die Basis des Mitglieds ist dabei für alle Leser sein Beitritt. Vektoren `public-club-read-by-owner`, `-mallory`, `-carol` (öffentlicher Club, jeder prüft selbst) und `closed-club-partial-reader`.
- Entfernte Personen brauchen eine Einladung, die nach ihrer Entfernung erstellt wurde (`removed_requires_new_invite`); wer selbst ausgetreten ist, kann mit jeder gültigen Einladung zurück.
- Ein Gruppenlink ist ein Inhaber-Token: Wer ihn hat, kann bis zum Ablauf beitreten. Ablauf, Widerruf und das Ende der Rolle des Erstellers wirken gegenüber ehrlichen Uhren; einen rückdatierten Beitritt mit gültigem Token erkennt niemand ([conflicts.md](../conflicts.md#einladungen)). Das Gegenmittel ist `club.remove`; wer das nicht will, nutzt persönliche Einladungen oder eine Höchstzahl.
- Wer eine Anfrage stellt, kann sie mit `club.leave` zurückziehen.

## Übergabe des Eigentums

Es gelten die Übergaberegeln Ü1 bis Ü6 in [conflicts.md](../conflicts.md#übergaben-turnierleitung-club-eigentum). Die erste rechtzeitige Annahme der angebotenen Person, die mindestens den Stand des Angebots nennt, beendet das Eigentum, wenn das Abspielen sie annimmt. Bis zur Annahme folgen die Clubangaben und die Mitgliedschaft der übernehmenden Person dem Stand, den sie nennt: Eine Entfernung oder Rollenänderung, die davon abzweigt, gilt nicht, auch wenn ein Admin sie später vor die Annahme oder das Angebot datiert (Vektor `admin-backdates-around-handover`); Datensätze über eine frühere Mitgliedschaft bleiben (Vektor `owner-transfer-after-rejoin`).

Vorgaben für `lib/clubs`: Angebote gelten 24 Stunden; angeboten und angenommen wird nur auf einem Gerät, das gerade geladen hat, und beide Seiten sehen den übergebenen Stand (Name, Sichtbarkeit, Rolle); angeboten wird nur Mitgliedern, deren Mitgliedschaft ein Eigentümer oder Admin bestätigt hat. Was offen bleibt, steht in [conflicts.md](../conflicts.md#grenzen-ohne-vertrauenswürdige-zeit) (Punkte 1 bis 4).

## Zustand

`reduceClub(events, clubId, { now, open })` liefert `ClubState`: Eigentümer, Angaben, Mitglieder mit Rolle, Seit und Weg (`founder`, `group` = dieser Leser hat den Nachweis selbst geprüft, `accepted`), Einladungen mit Einladungsschlüssel, Nutzungen und Ende (`ended`: `revoked` oder `maker_role`), wartende Anfragen mit Prüfstatus, ehemalige Mitglieder (`left` / `removed`), offenes Eigentümerangebot, Saisons mit allen Regelversionen, Ergebnisentscheidungen je Saison und Match, Termine, Schlüsselfreigaben, Rollenverlauf (`clubRoleAt` für Club-Turniere) und das Protokoll (`applied`, `rejected` mit Grund, `unapplied` als „versiegelt“, „unbekannte Version“ oder „wartet“). Einladungs-Tokens kommen in keinem Datensatz vor.

## Aufbewahrung und Löschung

Club-Datensätze sind regulär und werden nicht ersetzt; die Rollenhistorie bleibt nachvollziehbar. Relays sagen keine Aufbewahrung zu: Die Clients der Verantwortlichen senden fehlende Kopien beim Öffnen erneut (ADR 0002 §5). Löschen ist nur eine NIP-09-Bitte. Der Clubexport (P5.02) soll Gründung, Rollenhistorie, Saisonregeln, Ergebnisse und die für den Exportierenden lesbaren Inhaltsschlüssel enthalten (PLAN.md); die Event-Form dafür steht hier, der Export selbst nicht.

## Ablehnungen

`not_authorized`, `stale_predecessor`, `superseded`, `sealing_required`, `invalid_tags` (versiegelter Datensatz außer `club.keys` in einem öffentlichen Club), `invalid_content` (Einladungsbezeichnung im Klartext, Herabstufung eines Admins ohne `info`, Angebot länger als 7 Tage offen, Annahme mit älterem Stand als das Angebot), `already_member`, `not_member`, `duplicate`, `request_unknown`, `club_full`, `club_archived`, `invite_unknown`, `invite_expired`, `invite_revoked`, `invite_exhausted`, `invite_proof_invalid`, `removed_requires_new_invite`, `owner_cannot_leave`, `no_open_offer`, `season_unknown`, `season_exists`, `season_version_mismatch`, `season_ended`, `rules_change_needs_reason`, dazu die allgemeinen Gründe ([conflicts.md](../conflicts.md#ablehnungsgründe)).

## Vektoren

[`vectors/club.json`](../vectors/club.json) liest jeden Fall aus Sicht von `reader` (geöffnet mit dessen Schlüssel über `openSealedEvents`): `group-link`, `replayed-proof`, `group-link-with-limit`, `personal-invite`, `expired-and-revoked`, `requests`, `roles`, `role-conflict`, `owner-transfer`, `leave-and-rejoin`, `new-member-reads-history`, `removed-member`, `closed-club-in-clear`, `closed-founding-in-clear`, `season-rules`, `results-and-dates`, `unknown-version-and-time`, `archived`, `public-club-read-by-owner`, `public-club-read-by-mallory`, `public-club-read-by-carol` (mit dem Clubturnier des Turnierleiters), `closed-club-partial-reader`, `former-owner-backdates`, `ex-admin-backdates`, `member-limit`, `backdated-join`, `owner-accept-names-older-info`, `offer-recipient-left`, `admin-backdates-around-handover`, `owner-transfer-after-rejoin`, `public-club-sealed-invite-read-by-owner`, `public-club-sealed-invite-read-by-mallory`, `invite-ends-with-role`, `invite-ends-for-good`, `member-limit-displacement`, `missing-predecessor`. Die Grenze beim Schließen eines Clubs mit mehr als 100 Mitgliedern prüft [`tests/protocol-state.test.ts`](../../../tests/protocol-state.test.ts).
