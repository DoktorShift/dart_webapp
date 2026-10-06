# Rechte

Stand: P0.05 (nach Review Runde 3). Verbindlich ist der Code der Reducer ([`club-state.ts`](../../lib/protocol/club-state.ts), [`tournament-state.ts`](../../lib/protocol/tournament-state.ts), [`match-state.ts`](../../lib/protocol/match-state.ts)); diese Tabellen beschreiben ihn, die Vektoren prüfen ihn. Grundlage: PLAN.md „Eigentum Berechtigungen und Konflikte“, „Clubs und Saisons“, „Turniere“.

Jede Änderung wird **gegen die Rolle des Autors zu dem Zeitpunkt geprüft, an dem sie beim Abspielen an der Reihe ist** (Reihenfolge `created_at`, dann `id`, [conflicts.md](conflicts.md)). Eine unberechtigte Änderung ändert nichts und steht mit `not_authorized` im Protokoll. Ohne Server ist ein einzelner Eigentümer- oder Veranstalterschlüssel die einzige Wurzel der Befugnis: Geht er verloren, lässt sich der Club oder das Turnier nicht mehr verwalten; wird er kompromittiert, kann der Angreifer übergeben (Recherche PR-10, offene Nutzerentscheidung über mehrere Eigentümer).

„Zu diesem Zeitpunkt“ heißt: nach dem `created_at`, das der Autor selbst setzt. Damit eine abgegebene Befugnis sich nicht nachträglich zurückdatiert, nennt das Ende einer Leitung, eines Eigentums oder einer Admin-Rolle den Stand, den sein Autor sah; Turnierkern, Clubangaben, Übergabekette und die Mitgliedschaft der übernehmenden Person sind damit festgehalten, Plätze, Spiele, Boards, andere Mitglieder, Termine und Ergebnisse nicht ([conflicts.md](conflicts.md#ende-einer-befugnis), bekannte Grenze zu PR-10; alle Grenzen: [Grenzen ohne vertrauenswürdige Zeit](conflicts.md#grenzen-ohne-vertrauenswürdige-zeit)). Eine Übergabe gilt nur nach den Regeln Ü1 bis Ü6 ([conflicts.md](conflicts.md#übergaben-turnierleitung-club-eigentum)): Angebote sind höchstens 7 Tage offen und nennen, was sie übergeben; die erste Annahme der angebotenen Person zählt, wenn das Abspielen sie annimmt.

## Club

✓ = darf, – = darf nicht. „Gast“ ist keine Club-Rolle mit Schlüssel: Gäste spielen unter einem Alias in Spielen und Turnieren mit ([privacy.md](privacy.md)) und haben keine Rechte am Club.

| Handlung (Datensatz) | Eigentümer | Admin | Turnierleiter | Mitglied | Außenstehende |
| --- | --- | --- | --- | --- | --- |
| Name, Beschreibung, Bild, Höchstzahl ändern (`club.update`) | ✓ | ✓ | – | – | – |
| Sichtbarkeit ändern, archivieren (`club.update`) | ✓ | – | – | – | – |
| Einladen, Einladung beenden (`club.invite`, `club.invite.revoke`; eine Einladung endet auch mit der Rolle ihres Erstellers, endgültig) | ✓ | ✓ | – | – | – |
| Anfrage annehmen oder ablehnen (`club.accept`, `club.decline`) | ✓ | ✓ | – | – | – |
| Mitglied entfernen (`club.remove`) | ✓ alle außer sich (einen Admin mit `info`) | ✓ Turnierleiter und Mitglieder | – | – | – |
| Rolle Admin vergeben oder ändern (`club.role`; Herabstufen mit `info`) | ✓ | – | – | – | – |
| Rolle Turnierleiter / Mitglied vergeben (`club.role`) | ✓ | ✓ (nicht an Admins) | – | – | – |
| Eigentum anbieten (`club.owner.offer`, höchstens 7 Tage offen, nennt `info` und `member`), Angebot zurückziehen (`.cancel`) | ✓ | – | – | – | – |
| Eigentum annehmen (`club.owner.accept`, nennt `info` und `member`, mindestens den Stand des Angebots) | – | nur die angebotene Person | | | |
| Zugriff auf Früheres freigeben (`club.keys`) | ✓ | ✓ | – | – | – |
| Saison anlegen, Regeln ändern, beenden (`club.season*`) | ✓ | ✓ | – | – | – |
| Ergebnis für die Saison zählen lassen oder nicht (`club.result`) | ✓ | ✓ | ✓ | – | – |
| Termine anlegen, ändern, absagen (`club.date`) | ✓ | ✓ | ✓ | – | – |
| Auf einen Termin antworten (`club.rsvp`, zählt die neueste Antwort) | ✓ | ✓ | ✓ | ✓ | – |
| Ein Clubspiel nennen (`club.game`, mit dem Schlüssel eines privaten Spiels) | ✓ | ✓ | ✓ | ✓ | – |
| Turnier für den Club gründen (zählt als Turnier des Clubs) | ✓ | ✓ | ✓ | – | – |
| Clubauszeichnung vergeben (`mayIssueClubBadge`) | ✓ | ✓ | – | – | – |
| Austreten (`club.leave`) | – (erst übergeben) | ✓ | ✓ | ✓ | Anfrage zurückziehen |
| Beitreten oder anfragen (`club.join`) | | | | | ✓ |
| Versiegelte Clubdaten lesen | ✓ | ✓ | ✓ | ✓ | – (nur Vorschau mit Link) |

Nach `club.owner.accept` ist der bisherige Eigentümer Admin. Lesen ist keine Rolle, sondern Verschlüsselung: Wer verpackt wurde, liest; wer entfernt wurde, wird für Neues nicht mehr verpackt ([club.md](families/club.md)).

Einladungen eines Admins enden, sobald er nicht mehr Admin ist, und bleiben beendet, auch wenn er wieder Admin wird: Beitritte danach werden abgelehnt, Anfragen über seine persönliche Einladung nicht mehr angenommen (`invite_revoked`). Andere Verantwortliche erstellen eigene Links.

Eine wartende Anfrage nimmt nicht nur `club.accept` an: Eine Rollenänderung oder Entfernung, die den Beitritt als `prev` nennt, und ein Eigentumsangebot an die Person nehmen sie zuerst an, mit denselben Prüfungen (persönliche Einladung unbenutzt, Höchstzahl). So sieht auch ein Leser, der den Gruppenlink nicht öffnen kann, die Entscheidung von Eigentümer oder Admin ([club.md](families/club.md#einladungen-und-beitritt)).

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
| Leitung anbieten (höchstens 7 Tage offen, nennt `core`) / annehmen (nennt `core`, mindestens den des Angebots) | ✓ / – | – | – / nur die angebotene Person | – |
| Turnierauszeichnung vergeben (`mayIssueTournamentBadge`) | wer das Turnier beendet hat | – | – | – |

Ein Turnier zählt als Turnier eines Clubs (`club.verified`), wenn die gründende Person zur Zeit der Gründung im Club Eigentümer, Admin oder Turnierleiter war (`clubRole`); sonst ist es ein gewöhnliches Turnier. Wer die Leitung übernimmt, prüft das Protokoll nicht gegen die Clubrolle, weil Eigentümer und Admins die Rollengeschichte des Clubs zurückdatieren können und eine vollzogene Übergabe davon nicht abhängen darf; `lib/tournaments` bietet die Leitung nur Eigentümern, Admins und Turnierleitern des Clubs an. Ein Board hat nur seinen eingeschränkten Zugang; niemand nutzt am Board den Hauptschlüssel des Veranstalters.

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
