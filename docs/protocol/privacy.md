# Was öffentliche Relays sehen

Stand: P0.05. Grundlage: Entscheidung 0001 („Was ohne Backend nicht möglich ist“), Entscheidung 0002 §10, Recherche PR-01, PR-02, PR-14, PR-15. Diese Seite ist die Vorlage für die Texte unter „Erweitert“ und für das Bedrohungsmodell; normale Ansichten sprechen nicht von Relays.

## Grundsatz

Es gibt keinen eigenen Relay und keine Zugriffsrechte durch einen Server. **Schutz entsteht nur durch Verschlüsselung.** Alles, was BlueLine auf öffentliche Relays legt, kann jeder abrufen und dauerhaft kopieren, auch Geheimtext; Löschen ist nur eine Bitte (NIP-09). NIP-44 hat keine Vorwärtssicherheit: Wer später einen Schlüssel erlangt, liest alles, was damit verschlüsselt war.

## Je Familie

| Familie | Immer sichtbar | Nur für Berechtigte lesbar |
| --- | --- | --- |
| Öffentlicher Club | alles außer Schlüsselfreigaben: Name, Beschreibung, Saisons, Rollen, wer beigetreten ist und wer wen aufgenommen hat, Einladungen mit Art, Ablauf und öffentlichem Einladungsschlüssel (ohne Bezeichnung) | Schlüsselfreigaben; der Token eines Einladungslinks steht in keinem Event |
| Geschlossener Club | Club-ID (Gründungs-ID), Pubkeys aller, die im Club **handeln** (Gründer, Beitretende, Verantwortliche, Austretende), Zeitpunkte, Anzahl und Größe der Datensätze, Datensatztyp im Label, Zahl der Verpackungen je Datensatz (≈ Mitgliederzahl aus Sicht des Autors) | Name, Beschreibung, Mitgliederliste und Rollen, Einladungen, Saisons, Termine und Antworten darauf, Clubspiele samt Spielschlüssel (die Spiele selbst sind privat), Ergebnisentscheidungen, Gründe |
| Einladungslink | – (geht nie an einen Server) | Vorschau und Beitritt für jeden, der den Link hat |
| Öffentliches Turnier | Regeln, Phase, Teilnehmende als Pubkey oder **Gast-Alias**, Auslosung, Boards, Ergebnisse | – |
| Turnier eines geschlossenen Clubs | wie geschlossener Club | wie geschlossener Club |
| Öffentliches Spiel | Vereinbarung (Aliasse, Pubkeys der Spieler mit Profil), Live-Stand, Würfe, Ergebnis, Bestätigungen | – |
| Privates Spiel | Match-ID, Pubkeys von Autorität, Sitzungsschlüssel und bestätigenden Spielern, Zeitpunkte | Vereinbarung, Einsatz, Würfe, Ergebnis — für jeden mit dem Zuschauerlink; der Spielschlüssel lässt sich nicht widerrufen |
| Kopplung, Board | Kind 21180, Pubkeys der Einmalschlüssel und des Spielers, Zeit, IP beim Relay (verknüpft Geräte einer Person) | Inhalt (NIP-44) |
| Private Datensätze | Profil-Pubkey, Kind 30078, Zeitpunkte (wann gespielt wurde), Zahl und ungefähre Größe, Kennungen ohne Bedeutung | Inhalt (Datenschlüssel) |
| Auszeichnungen | Aussteller, Empfänger, Definition, Nachweis-ID, Anlass | – |
| Zahlungsanfrage | ein Gift Wrap an den Zahler (Empfänger-Pubkey, zufälliger Wrap-Schlüssel, verschleierte Zeit) | Anfragender, Betrag, Rechnung, Match |

Zusätzlich sieht jedes Relay die IP-Adresse und die Zeit jeder Verbindung; alle Geräte eines Clubabends teilen oft eine IP. Die BlueLine-Kinds selbst verraten „diese Person nutzt BlueLine für Clubs oder Turniere“ (PR-15).

## Geschlossene Clubs im Einzelnen

- Kein gemeinsames Club-Geheimnis: Jeder versiegelte Datensatz hat einen eigenen Inhaltsschlüssel, für jedes aktuelle Mitglied mit NIP-44 verpackt ([kinds.md](kinds.md#versiegelter-umschlag)).
- Die Verpackungen nennen keine Pubkeys. Ihr Hinweis hängt von der Zufallsnonce des Datensatzes ab: Eine Mitgliederliste lässt sich daraus nicht ablesen; wer einen bestimmten Pubkey vermutet, kann ihn aber prüfen. Wer selbst im Club handelt (beitritt, annimmt, austritt), ist als Autor ohnehin sichtbar.
- Entfernte Mitglieder bekommen Neues nicht mehr verpackt; was sie schon gelesen haben, behalten sie.
- Die Vorschau im Einladungslink zeigt Name, Beschreibung, Bild, Gastgeber, Art und Ablauf der Einladung und den nächsten Termin, nicht mehr.
- Ein Beitritt über einen Gruppenlink trägt einen Nachweis, den jeder mit dem öffentlichen Einladungsschlüssel prüfen kann. In einem geschlossenen Club steht dieser Schlüssel nur im versiegelten Einladungsdatensatz; dass jemand beigetreten ist, verrät ohnehin der Klartext-Beitritt.

## Gäste und Dritte

Signierte öffentliche Daten über Dritte lassen sich nicht zuverlässig zurückholen (PR-14). Deshalb:

- **Gäste erscheinen in öffentlichen Datensätzen nur unter einem Alias**, den die Leitung wählt (Vorschlag „Gast 1“, „Gast 2“). Ein echter Name steht dort nur, wenn die Person zugestimmt hat; das hält `named: true` fest (`tournament.guest`). Ohne Zustimmung bleibt `named` weg, und die App schlägt einen neutralen Alias vor.
- In Spielen stehen Plätze als `alias` mit optionalem `pubkey`; ein Pubkey nur, wenn die Person selbst mit ihrem Profil beigetreten ist. Für Gäste ohne Profil gilt dasselbe wie im Turnier: ein neutraler Alias, außer `named: true` hält die Zustimmung fest.
- Echte Namen von Gästen gehören in verschlüsselte Daten (private Datensätze, versiegelte Clubdaten), nie in Klartext-Events. Deshalb trägt eine Einladung im Klartext keine Bezeichnung (sonst `invalid_content`): „Für Tom“ steht nur in versiegelten Einladungen.
- Öffentliche Zusagen (NIP-52-RSVP) sind eine Entscheidung je Person.
- Vergaben aus privaten Spielen oder geschlossenen Clubs nur nach ausdrücklicher Freigabe.

## Was die App deshalb nie behauptet

„Zugriffsbeschränkt“, „gelöscht“ (statt „Löschung erbeten“), „nur der Club sieht, dass du Mitglied bist“, „anonym“. Richtig ist: „verschlüsselt; wer im Club handelt und wann, ist sichtbar“.
