# Familie: Auszeichnungen

Stand: P0.05. Code: [`badges.ts`](../../../lib/protocol/badges.ts). Vektoren: [`vectors/badges.json`](../vectors/badges.json). Grundlage: Entscheidung 0001 F3, Entscheidung 0002 §6, PLAN.md „Auszeichnungen“, Recherche PR-03, PR-04, PR-09.

## Zweck

Auszeichnungen nach NIP-58: Definition (Kind 30009), Vergabe (Kind 8), Profilauswahl (Kind 10008; das Altformat 30008 mit `d=profile_badges` bleibt lesbar). Die Auswahl gehört allen Apps des Profils: `readProfileBadges` liefert die Paare mit ihren Relay-Hinweisen, `otherProfileTags` alles, was kein lesbares Paar ist, und `profileBadgesTemplate(badges, created_at, other)` schreibt beides unverändert zurück (ohne das `d` des Altformats); beim Zurückschreiben geht nichts einer anderen App verloren. Es gibt keinen BlueLine-Ausstellerschlüssel: Club- und Turnierauszeichnungen vergibt der berechtigte Veranstalter mit seinem Schlüssel, persönliche Meilensteine nur der Spieler selbst, gekennzeichnet als „Selbst erreicht“.

## Definition (Kind 30009)

Tags: `d` = `blueline:<scope>[:<scope-id>]:<badge>:v<version>`, `name`, `description`, `image?`, `thumb?` (nur https), `["L","blueline"]`, `["l","badge.definition","blueline"]`, `["v","1"]`, `["scope", <scope>, <scope-id>?]`. Scope: `self`, `club` (mit Club-ID), `tournament` (mit Turnier-ID), `recognition`. Eine neue Bedingung bekommt eine neue Version im `d`; ein neues Bild schreibt eine alte Leistung nicht um. Die Adresse gehört dem Aussteller: Nach einem Eigentümer- oder Veranstalterwechsel stellt der Neue eigene Definitionen aus; alte Vergaben bleiben unter dem alten Aussteller gültig (PR-09).

## Vergabe (Kind 8)

Tags: `["a","30009:<aussteller>:<d>"]`, genau ein `["p",<empfänger>]`, genau ein `["e",<nachweis>]` (Ergebnis oder Entscheidung, auf der sie beruht), `["occasion",<anlass>]` (Turnier-, Saison- oder Ergebnis-ID oder `once`), Labels wie oben mit `badge.award`.

## Prüfung (`checkBadgeAward`)

Signaturen prüft vorher `lib/nostr`. Dann: Kinds und Labels, **Autor der Vergabe = Autor der Definition = Aussteller in der `a`-Adresse** (nostr-core 1.0.4 prüft das nicht, PR-04: eine gefälschte Vergabe würde sonst angenommen), genau ein Empfänger, Nachweis und Anlass vorhanden; `self` nur an den Aussteller selbst; `club`/`tournament` nur, wenn der Zustand des Clubs beziehungsweise Turniers den Aussteller dazu berechtigt (`mayIssue`); ein korrigierter oder aufgehobener Nachweis macht die Vergabe ungültig (`evidence_revoked`). Doppelte Vergaben (gleicher Aussteller, Definition, Empfänger, Anlass) zählen einmal: die erste in Abspielreihenfolge (`dedupeAwards`).

## Sichtbarkeit

Vergaben sind öffentlich und lassen sich nicht zurückholen. Aus einem privaten Spiel oder geschlossenen Club wird nur nach ausdrücklicher Freigabe vergeben; persönliche Meilensteine bleiben „Auf diesem Gerät erreicht“, bis der Spieler „Im Profil zeigen“ wählt ([privacy.md](../privacy.md)). purplepag.es nimmt keine Kind-8-Vergaben an (PR-08).

## Ablehnungen

`wrong_kind`, `not_blueline`, `unknown_version`, `invalid_tags`, `tag_too_long`, `issuer_mismatch`, `recipient_missing`, `evidence_missing`, `occasion_mismatch`, `not_authorized`, `evidence_revoked`.

## Vektoren

`organizer-award`, `forged-issuer`, `self-earned`, `self-for-other`, `club-not-issuer`, `no-recipient`, `evidence-voided`, `duplicate`.
