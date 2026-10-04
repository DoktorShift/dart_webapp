# Rechte

Stand: P0.05. Verbindlich ist der Code der Reducer ([`club-state.ts`](../../lib/protocol/club-state.ts), [`tournament-state.ts`](../../lib/protocol/tournament-state.ts), [`match-state.ts`](../../lib/protocol/match-state.ts)); diese Tabellen beschreiben ihn, die Vektoren prüfen ihn. Grundlage: PLAN.md „Eigentum Berechtigungen und Konflikte“, „Clubs und Saisons“, „Turniere“.

Jede Änderung wird **gegen die Rolle des Autors zu dem Zeitpunkt geprüft, an dem sie beim Abspielen an der Reihe ist** (Reihenfolge `created_at`, dann `id`, [conflicts.md](conflicts.md)). Eine unberechtigte Änderung ändert nichts und steht mit `not_authorized` im Protokoll. Ohne Server ist ein einzelner Eigentümer- oder Veranstalterschlüssel die einzige Wurzel der Befugnis: Geht er verloren, lässt sich der Club oder das Turnier nicht mehr verwalten; wird er kompromittiert, kann der Angreifer übergeben (Recherche PR-10, offene Nutzerentscheidung über mehrere Eigentümer).

## Club

✓ = darf, – = darf nicht. „Gast“ ist keine Club-Rolle mit Schlüssel: Gäste spielen unter einem Alias in Spielen und Turnieren mit ([privacy.md](privacy.md)) und haben keine Rechte am Club.

| Handlung (Datensatz) | Eigentümer | Admin | Turnierleiter | Mitglied | Außenstehende |
| --- | --- | --- | --- | --- | --- |
| Name, Beschreibung, Bild, Höchstzahl ändern (`club.update`) | ✓ | ✓ | – | – | – |
| Sichtbarkeit ändern, archivieren (`club.update`) | ✓ | – | – | – | – |
| Einladen, Einladung beenden (`club.invite`, `club.invite.revoke`) | ✓ | ✓ | – | – | – |
| Anfrage annehmen oder ablehnen (`club.accept`, `club.decline`) | ✓ | ✓ | – | – | – |
| Mitglied entfernen (`club.remove`) | ✓ alle außer sich | ✓ Turnierleiter und Mitglieder | – | – | – |
| Rolle Admin vergeben oder ändern (`club.role`) | ✓ | – | – | – | – |
| Rolle Turnierleiter / Mitglied vergeben (`club.role`) | ✓ | ✓ (nicht an Admins) | – | – | – |
| Eigentum anbieten, Angebot zurückziehen (`club.owner.offer`, `.cancel`) | ✓ | – | – | – | – |
| Eigentum annehmen (`club.owner.accept`) | – | nur die angebotene Person | | | |
| Zugriff auf Früheres freigeben (`club.keys`) | ✓ | ✓ | – | – | – |
| Saison anlegen, Regeln ändern, beenden (`club.season*`) | ✓ | ✓ | – | – | – |
| Ergebnis für die Saison zählen lassen oder nicht (`club.result`) | ✓ | ✓ | ✓ | – | – |
| Termine anlegen, ändern, absagen (`club.date`) | ✓ | ✓ | ✓ | – | – |
| Turnier für den Club gründen, Leitung übernehmen | ✓ | ✓ | ✓ | – | – |
| Clubauszeichnung vergeben (`mayIssueClubBadge`) | ✓ | ✓ | – | – | – |
| Austreten (`club.leave`) | – (erst übergeben) | ✓ | ✓ | ✓ | Anfrage zurückziehen |
| Beitreten oder anfragen (`club.join`) | | | | | ✓ |
| Versiegelte Clubdaten lesen | ✓ | ✓ | ✓ | ✓ | – (nur Vorschau mit Link) |

Nach `club.owner.accept` ist der bisherige Eigentümer Admin. Lesen ist keine Rolle, sondern Verschlüsselung: Wer verpackt wurde, liest; wer entfernt wurde, wird für Neues nicht mehr verpackt ([club.md](families/club.md)).

## Turnier

| Handlung | Veranstalter | Board (zugelassener Geräteschlüssel) | Spieler | Gast |
| --- | --- | --- | --- | --- |
| Angaben, Regeln (vor der Auslosung), Phase, Festlegung, Auslosung | ✓ | – | – | – |
| Anmelden, zurückziehen, sich einchecken, Gastplatz beanspruchen | – | – | ✓ (für sich) | über den Veranstalter |
| Aufnehmen, Warteliste, herausnehmen, Gast anlegen, Gast verknüpfen, für andere einchecken | ✓ | – | – | – |
| Boards zulassen und entziehen, Spiele zuweisen | ✓ | – | – | – |
| Ergebnis einreichen (`tournament.result`) | ✓ (zählt sofort) | ✓ nur für zugewiesene Spiele (zählt bei `approval: "board"`) | – | – |
| Ergebnis freigeben, korrigieren | ✓ | – | – | – |
| Spiel als Autorität gründen und übergeben (`match.session`) | ✓ | ✓ | – | – |
| Leitung anbieten / annehmen | ✓ / – | – | – / nur die angebotene Person | – |
| Turnierauszeichnung vergeben (`mayIssueTournamentBadge`) | wer das Turnier beendet hat | – | – | – |

Bei Club-Turnieren muss die gründende und die übernehmende Person zu diesem Zeitpunkt im Club Eigentümer, Admin oder Turnierleiter sein (`clubRole`). Ein Board hat nur seinen eingeschränkten Zugang; niemand nutzt am Board den Hauptschlüssel des Veranstalters.

## Match

| Handlung | Autorität | Sitzungsschlüssel (Schreiber) | Spieler (Platz mit Profil) | Zuschauer |
| --- | --- | --- | --- | --- |
| Match gründen, Schreiber wechseln (`match.session`) | ✓ | – | – | – |
| Live-Stand (`match.live`) | – | ✓ aktuelle Sitzung, im Fenster | – | lesen (privat: mit Link) |
| Ergebnis, Korrektur, Aufhebung (`match.result`) | ✓ | ✓ nur letzte Sitzung | – | lesen |
| Protokollstücke (`match.log`) | ✓ | ✓ | – | lesen |
| Ergebnis bestätigen oder bestreiten (`match.confirm`) | – | – | ✓ eigener Platz | – |
| Zahlung anfragen (`payment.request`) | – | **nie** | ✓ eigenes Profil, an einen Mitspieler | – |
| Profil ändern, für andere bezahlen | – | – | nur das eigene Profil, nur nach Bestätigung | – |

Wer ein Spiel aufzeichnet, darf daraus keine Spielerprofile ändern und für niemanden bezahlen (PLAN.md).

## Profil

Nur der Profilschlüssel selbst: private Datensätze (Kind 30078), Profilauswahl der Auszeichnungen (Kind 10008), selbst erreichte Auszeichnungen (Scope `self`), Seal einer Zahlungsanfrage, Kind 0 und 10002. Ein Board-, Sitzungs- oder Kopplungsschlüssel tut nichts davon.
