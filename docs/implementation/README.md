# Arbeitsablage der Erweiterung

Diese Ablage steuert die Erweiterung von BlueLine Darts um Profile, Geräte, Clubs, Turniere, Auszeichnungen und direkte Zahlungen. Version 1.0.0 auf `main` bleibt davon unberührt; gearbeitet wird im Branch `nostr-expansion`.

## Inhalt

| Datei oder Ordner | Zweck |
| --- | --- |
| [PLAN.md](PLAN.md) | Vollständiger Umsetzungsplan mit 37 Arbeitspunkten und den Abnahmekriterien A01 bis A29 |
| [HANDOFF.md](HANDOFF.md) | Übergabe an den Umsetzer und Review-Verfahren |
| [STATUS.md](STATUS.md) | Aktueller Stand: aktive Aufgabe, letzter Nachweis, offene Befunde, nächster Schritt und Zustand aller 37 Punkte |
| [tasks/](tasks/) | Eine Karte je Arbeitspunkt, angelegt vor Beginn der Arbeit; Muster in [tasks/_VORLAGE.md](tasks/_VORLAGE.md) |
| [evidence/](evidence/) | Nachweise je Arbeitspunkt: Berichte, Bilder, Skripte, Messwerte |
| [../decisions/](../decisions/) | Begründete Entscheidungen; sie gehen dem Plan vor, wo sie ihm widersprechen |
| [../protocol/](../protocol/) | Darts-Format für Nostr: Verträge, Schemas, Testvektoren |
| [../ux/](../ux/) | Klickbarer UX-Entwurf mit Beispieldaten |

## Maßgebliche Reihenfolge

1. Entscheidungen in `docs/decisions/`
2. [PLAN.md](PLAN.md)
3. Aufgabenkarten

Die Plan-Page in ChatGPT ist eine Übersicht. Bei Abweichungen gilt das Repository; Unterschiede werden in einer Entscheidung oder in [STATUS.md](STATUS.md) ausdrücklich benannt.

## Zustände

„Offen“, „In Arbeit“, „In Prüfung“, „Wartet auf Nachweis“, „Abgeschlossen“. Eine Checkbox im Plan wird nur für „Abgeschlossen“ gesetzt. „Wartet auf Nachweis“ nennt immer den fehlenden Nachweis, seine Auswirkung und den nächsten möglichen Schritt.

## Review-Paket

Jede Lieferung nennt:

- Aufgaben-ID und betroffene Kriterien aus A01 bis A29
- Branch, Basiscommit und genauen Prüfcommit
- Was sich für Spieler oder Protokoll ändert und warum
- Ausgeführte Prüfungen mit Ergebnis; nicht ausgeführte Prüfungen ausdrücklich
- Bei UI-Änderungen eine startbare Vorschau, nachgestellte Abläufe und Bilder
- Offene Entscheidungen, Einschränkungen und nächsten Schritt

## Feature-Schalter

Jeder Bereich (`profile`, `payments`, `live`, `sync`, `clubs`, `badges`, `devices`, `tournaments`) steht hinter einem eigenen Schalter (`lib/shell/features.ts`, PLAN.md „Ausrollen“). Die Build-Variable `NEXT_PUBLIC_BLUELINE_FEATURES` nennt die eingeschalteten Bereiche durch Komma getrennt, etwa `NEXT_PUBLIC_BLUELINE_FEATURES=profile,live npm run build`; ohne die Variable sind alle an, mit leerem Wert alle aus. Alles außer `live` und `payments` setzt `profile` voraus: ein Bereich, dessen Voraussetzung aus ist, ist aus. Ein Schalter wirkt nur auf die Registrierung beim Rahmen: `components/<Bereich>/register.ts` umschließt alle seine Registrierungen mit `if (featureOn("<Bereich>"))`. Ein ausgeschalteter Bereich registriert nichts; sein Tab zeigt die Ansicht des Rahmens, seine Links meldet der Rahmen als „noch nicht zu öffnen“, seine Daten auf dem Gerät bleiben unberührt und für den Build lesbar, der ihn wieder einschaltet. Die Gast-App bleibt in jeder Schalterstellung benutzbar.

## Fortsetzen nach einer Pause

Zuerst [STATUS.md](STATUS.md) lesen, dann die Karte der aktiven Aufgabe, dann die dort verlinkten Planstellen und Entscheidungen. Vor dem Wechsel zum nächsten Punkt wird STATUS.md aktualisiert.
