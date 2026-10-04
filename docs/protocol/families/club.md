# Familie: Club

Stand: P0.05. Code: [`club.ts`](../../../lib/protocol/club.ts) (Typen und Schemas), [`club-state.ts`](../../../lib/protocol/club-state.ts) (Zustand), [`invite.ts`](../../../lib/protocol/invite.ts) (Einladungen), [`seal.ts`](../../../lib/protocol/seal.ts) (geschlossene Clubs). Schema: [`schemas/club.schema.json`](../schemas/club.schema.json). Vektoren: [`vectors/club.json`](../vectors/club.json), [`vectors/invite.json`](../vectors/invite.json), [`vectors/seal.json`](../vectors/seal.json). Rechte: [permissions.md](../permissions.md).

## Zweck

Ein Club ist die Event-ID seines `club.found`. Mitglieder, Rollen, Einladungen, Saisons, Termine und Ergebnisentscheidungen ergeben sich durch Abspielen aller Club-Datensätze ([conflicts.md](../conflicts.md)). Es gibt keinen Server, der Mitgliedschaft durchsetzt: Jeder Client spielt dieselben signierten Datensätze ab und kommt zum selben Zustand.

## Kind, Tags, Verschlüsselung

Kind 1180, Pflicht-Tags nach [kinds.md](../kinds.md); `e` = Club-ID (außer bei `club.found`).

- **Öffentlicher Club** (`visibility: "public"`): Datensätze im Klartext; nur `club.invite` und `club.keys` sind immer versiegelt (sie tragen Geheimnisse).
- **Geschlossener Club** (`visibility: "closed"`, Standard für neue Clubs, PLAN.md „Clubs und Saisons“): ab der Gründung ist jeder Datensatz versiegelt, außer `club.join` (kommt von jemandem, der die Leser nicht kennt) und `club.leave` (sagt nichts, was ein Relay nicht ohnehin sieht). Ein Klartext-Datensatz eines anderen Typs wird mit `sealing_required` abgelehnt; eine geschlossene Gründung im Klartext ergibt keinen Club.

Versiegelt wird nach dem Umschlag in [kinds.md](../kinds.md#versiegelter-umschlag): eigener Inhaltsschlüssel je Datensatz, NIP-44-Verpackung je Leser im selben Event. **Leser sind die aktuellen Mitglieder nach dem Stand des Autors**; `club.accept` zusätzlich die aufgenommene Person, `club.remove` zusätzlich die entfernte Person (damit ihre App den Ausschluss zeigt). Ein entferntes Mitglied wird danach nicht mehr verpackt; bereits Gelesenes bleibt bei ihm, das wird nicht anders dargestellt (Entscheidung 0002 §6).

**Neue Mitglieder** lesen Früheres über `club.keys`: Ein Eigentümer oder Admin teilt die Inhaltsschlüssel früherer Datensätze, versiegelt für die aktuellen Mitglieder. `openSealedEvents` öffnet erst über die eigenen Verpackungen, dann mit geteilten Schlüsseln; Signatur und Berechtigung jedes geöffneten Datensatzes werden wie immer geprüft, ein falscher Schlüssel öffnet nichts. So muss niemandem ein Zustand geglaubt werden, den er nicht selbst nachprüft.

## Datensatztypen

„Leser“ gilt für geschlossene Clubs. Alle Änderungen werden gegen die Rolle des Autors zum Zeitpunkt des Abspielens geprüft ([permissions.md](../permissions.md)).

| Typ | Autor | Inhalt | Regeln |
| --- | --- | --- | --- |
| `club.found` | Gründer (wird Eigentümer) | `name`, `about?`, `picture?` (https), `visibility`, `capacity?` (2–100) | Event-ID = Club-ID; geschlossen nur versiegelt |
| `club.update` | Eigentümer, Admin | `prev`, geänderte Felder (`name`, `about`, `picture` oder `null`, `visibility`, `capacity` oder `null`, `archived`) | `visibility` und `archived` nur Eigentümer; `prev` = letzte Club-Änderung oder Club-ID |
| `club.invite` | Eigentümer, Admin | `kind` (`group` / `personal`), `token` (16 Byte), `expires`, `label?` | immer versiegelt; Umschlag trägt die Vorschau `p`; Einladungs-ID = Event-ID; `expires` nach `created_at` |
| `club.invite.revoke` | Eigentümer, Admin | `invite` (Event-ID) | einmal |
| `club.join` | Beitretende | `invite?` (Event-ID), `proof?` (HMAC, beide zusammen) | nie versiegelt; siehe Beitritt |
| `club.accept` | Eigentümer, Admin | `request` (Event-ID des `club.join`), `member` | Kapazität wird hier geprüft |
| `club.decline` | Eigentümer, Admin | `request` | |
| `club.leave` | Mitglied, oder wer eine Anfrage zurückzieht | `{}` | Eigentümer erst nach Übergabe |
| `club.remove` | Eigentümer, Admin | `member`, `prev` (letzte Änderung des Mitglieds), `reason?` | Admin entfernt keine Admins, niemand den Eigentümer |
| `club.role` | Eigentümer, Admin | `member`, `role` (`admin` / `director` / `member`), `prev` | Admins ernennt und ändert nur der Eigentümer |
| `club.owner.offer` | Eigentümer | `to` (Mitglied), `prev` | |
| `club.owner.cancel` | Eigentümer | `offer` | |
| `club.owner.accept` | angebotenes Mitglied | `offer` | Eigentümer wird Admin; Club-ID bleibt |
| `club.keys` | Eigentümer, Admin | `keys`: bis 150 × [Event-ID, Inhaltsschlüssel] | immer versiegelt; ändert keinen Zustand |
| `club.season` | Eigentümer, Admin | `season` (16 Byte), `name`, `starts`, `ends?`, `rules` | Regelversion 1 |
| `club.season.rules` | Eigentümer, Admin | `season`, `version` (+1), `rules`, `reason?` | nach Saisonbeginn nur mit sichtbarer Begründung; nicht nach dem Ende |
| `club.season.end` | Eigentümer, Admin | `season` | |
| `club.result` | Eigentümer, Admin, Turnierleiter | `season`, `match`, `result` (Event-ID), `count` (zählt / zählt nicht), `prev`, `reason?` | `prev` = letzte Entscheidung zu diesem Match oder Club-ID; nicht nach Saisonende |
| `club.date` | Eigentümer, Admin, Turnierleiter | `date` (16 Byte), `title`, `starts`, `ends?`, `place?`, `note?`, `cancelled?`, `prev` | `prev` = letzte Fassung des Termins oder Club-ID |

Saisonregeln (`rules`): `modes` (zählende Spielarten), `points` (Sieg, Remis, Niederlage), `confirmations` (`none` / `opponent` / `all`), `minGames`, `tiebreak` (`wins`, `legDifference`, `headToHead`, `average`). Die Tabelle selbst berechnet `lib/clubs` aus den Matchergebnissen; `club.result` hält die Entscheidungen fest, die die Regeln nicht selbst treffen (etwa ein bestrittenes Ergebnis).

Öffentliche Termine laufen über NIP-52; `club.date` ist der Termin des geschlossenen Clubs, den NIP-52 nicht verschlüsselt anbietet (Recherche PR-13).

## Einladungen und Beitritt

Ein Einladungslink zeigt auf `/#club=C1.<club-id>.<einladungs-event-id>.<token>.<relays>` ([pairing.md](pairing.md#links-und-qr-codes)); der Token verlässt den Browser nie in Richtung Server.

**Nachweis:** `proof = HMAC-SHA256(key = token, "blueline-invite-v1:" + pubkey des Beitretenden)`. Kopiert jemand den Nachweis eines anderen, gilt er nicht für den eigenen Schlüssel. Prüfen kann ihn, wer die Einladung öffnen kann (die Mitglieder).

**Vorschau:** `vorschauschlüssel = HKDF-SHA256(ikm = token, salt = "blueline-invite-v1", info = "preview", 32 Byte)`. Die Vorschau (Name, Beschreibung, Bild, Gastgeber mit Anzeigename, Art, Ablauf, nächster Termin) steckt verschlüsselt im Umschlag des `club.invite`; der Link genügt, um sie zu lesen, auch ohne Profil.

| Art | Wirkung eines gültigen `club.join` | Kapazität, Ablauf, Reihenfolge |
| --- | --- | --- |
| **Gruppenlink** (`group`) | sofort Mitglied (`via: "group"`), solange der Club **keine Höchstzahl** hat; mit Höchstzahl eine Anfrage (`check: "ok"`), über die ein Eigentümer oder Admin entscheidet | Ablauf: `created_at` des Beitritts ≤ `expires`; Widerruf: Beitritte danach werden abgelehnt |
| **Persönliche Einladung** (`personal`) | Anfrage (`check: "ok"`); Mitglied erst mit `club.accept`, einmalig | entscheidet die annehmende Person; eine zweite Nutzung wird abgelehnt (`invite_exhausted`) |
| **Ohne Einladung** | Anfrage (`check: "none"`) | entscheidet die annehmende Person |

So entscheidet über Kapazität und Reihenfolge immer die berechtigte Rolle, nie ein vom Beitretenden gesetzter `created_at` (Entscheidung 0001 Punkt 10, Vektor `group-link-with-limit`: Carol fragt zuletzt und wird zuerst aufgenommen). Die App zeigt bis zur Annahme „Deine Anfrage wartet auf Bestätigung“.

Weitere Regeln beim Abspielen:

- Ein Beitritt, der vor seiner Einladung datiert ist, wird abgelehnt (`invite_unknown`, Vektor `backdated-join`).
- Kann der Leser die genannte Einladung nicht öffnen (nicht für ihn verpackt, noch nicht geladen), bleibt der Beitritt eine Anfrage mit `check: "unverified"`; die App zeigt „wartet auf Daten“, keine Ablehnung (Vektor `outsider-reader`).
- Entfernte Personen brauchen eine Einladung, die nach ihrer Entfernung erstellt wurde (`removed_requires_new_invite`); wer selbst ausgetreten ist, kann mit jeder gültigen Einladung zurück.
- Ein Gruppenlink ist ein Inhaber-Token: Wer ihn hat, kann bis zum Ablauf beitreten. Ablauf und Widerruf wirken gegenüber ehrlichen Uhren; einen rückdatierten Beitritt mit gültigem Token erkennt niemand ([conflicts.md](../conflicts.md#einladungen)). Das Gegenmittel ist `club.remove`; wer das nicht will, nutzt persönliche Einladungen oder eine Höchstzahl.
- Wer eine Anfrage stellt, kann sie mit `club.leave` zurückziehen.

## Zustand

`reduceClub(events, clubId, { now, open })` liefert `ClubState`: Eigentümer, Angaben, Mitglieder mit Rolle, Seit und Weg (`founder` / `group` / `accepted`), Einladungen mit Nutzungen, wartende Anfragen mit Prüfstatus, ehemalige Mitglieder (`left` / `removed`), offenes Eigentümerangebot, Saisons mit allen Regelversionen, Ergebnisentscheidungen je Saison und Match, Termine, Schlüsselfreigaben, Rollenverlauf (`clubRoleAt` für Club-Turniere) und das Protokoll (`applied`, `rejected` mit Grund, `unapplied` als „versiegelt“ oder „unbekannte Version“). Einladungs-Tokens stehen bewusst nicht im Zustand.

## Aufbewahrung und Löschung

Club-Datensätze sind regulär und werden nicht ersetzt; die Rollenhistorie bleibt nachvollziehbar. Relays sagen keine Aufbewahrung zu: Die Clients der Verantwortlichen senden fehlende Kopien beim Öffnen erneut (ADR 0002 §5). Löschen ist nur eine NIP-09-Bitte. Der Clubexport (P5.02) soll Gründung, Rollenhistorie, Saisonregeln, Ergebnisse und die für den Exportierenden lesbaren Inhaltsschlüssel enthalten (PLAN.md); die Event-Form dafür steht hier, der Export selbst nicht.

## Ablehnungen

`not_authorized`, `stale_predecessor`, `sealing_required`, `already_member`, `not_member`, `duplicate`, `request_unknown`, `club_full`, `club_archived`, `invite_unknown`, `invite_expired`, `invite_revoked`, `invite_exhausted`, `invite_proof_invalid`, `removed_requires_new_invite`, `owner_cannot_leave`, `no_open_offer`, `season_unknown`, `season_exists`, `season_version_mismatch`, `season_ended`, `rules_change_needs_reason`, dazu die allgemeinen Gründe ([conflicts.md](../conflicts.md#ablehnungsgründe)).

## Vektoren

[`vectors/club.json`](../vectors/club.json) liest jeden Fall aus Sicht von `reader` (geöffnet mit dessen Schlüssel über `openSealedEvents`): `group-link`, `replayed-proof`, `group-link-with-limit`, `personal-invite`, `expired-and-revoked`, `requests`, `roles`, `role-conflict`, `owner-transfer`, `leave-and-rejoin`, `new-member-reads-history`, `removed-member`, `closed-club-in-clear`, `closed-founding-in-clear`, `season-rules`, `results-and-dates`, `unknown-version-and-time`, `archived`, `outsider-reader`, `backdated-join`.
