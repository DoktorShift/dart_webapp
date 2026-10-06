# P3a.03 Profilverteilung und Listen

**Status:** In Prüfung (Schreibtest auf öffentlichen Relays offen)
**Paket:** P3a · **Planstelle:** [PLAN.md](../PLAN.md), Zeilen 157–180 (Relays, NIP-65), 201–218 (NIP-51)

## Ziel

Profile verteilen Metadaten und Relay-Liste an die fünf Profilziele, ohne fremde Einträge zu verlieren; persönliche Sammlungen (Spielerrunden) laufen als NIP-51-Sets und werden nie überschrieben, wenn ihr privater Teil hier nicht lesbar ist.

## Umfang und Stand

| Teil | Ort |
| --- | --- |
| Ziele je Kind: Profil-Kinds an die fünf Profil-Relays, sonst die allgemeinen, jeweils plus die ersten vier eigenen Schreib-Relays (`MAX_OWN_RELAYS`), nie an blockierte (10006); `submitOwn` schickt ohne Warten, `publishOwn` wartet auf die Antworten | `lib/profile/relay-list.ts`, `lib/sync/publish.ts` |
| Neue Relay-Liste: die vier allgemeinen Relays (purplepag.es nur als Verteilungsziel) | `newRelayList` |
| Bearbeiten der Liste unter „Erweitert“: unbekannte Tags und hier unbrauchbare Einträge bleiben; Entfernen fragt zuerst; bis nachgesehen wurde „Wird geladen“ / „nicht geladen“ statt der App-Relays; nach dem Hinzufügen eines Relays wird dort gleich nachgesehen | `relayListTemplate`, `advanced-screen.tsx` |
| Eigene Events lesen an allen möglichen Zielen, eine gefundene Relay-Liste erweitert die Suche; Nachsehen je Seitenaufruf und vor jeder Änderung (`lookupOwnEvents`, `changeBase`) | `lib/profile/own-events.ts` |
| „Meine Spielerrunden“ (30000, `blueline-round-<id>`): öffentliche `p`-Tags, Plätze und Gäste verschlüsselt, fremde Einträge erhalten, Weigerung bei unlesbarem privatem Teil, Löschen durch leere Fassung; der Signer wird nur für noch nie gelesene Runden geweckt; ein Platz zählt nur mit dem Profil, mit dem er gefüllt wurde | `lib/profile/rounds.ts` |
| Vertrag | [docs/protocol/families/profile.md](../../protocol/families/profile.md) |

## Abschlussnachweise

| Nachweis | Ergebnis |
| --- | --- |
| `tests/profile-relays.test.ts`, `profile-rounds.test.ts`, `profile-metadata.test.ts`, `profile-publish.test.ts`, `profile-own-events.test.ts` | bestanden (478 von 478 in `npm test`) |
| `tests/relay/profile.test.ts` gegen zwei `nak serve`: Verteilung, Lesen über neue Verbindung, Erhalt fremder Felder und Tags, Runde mit `nak decrypt` | bestanden |

Nicht nachgewiesen: Annahme und Aufbewahrung auf den fünf öffentlichen Relays (Nutzerfreigabe E7), Ersatz-Relays aus einem Katalog, Selbstheilung fehlender Kopien (Abgleich-Spur, Outbox).

## Nächster Schritt

Persistente Outbox hinter `lib/sync/publish.ts` (Abgleich-Spur), dann Schreibtest auf den öffentlichen Zielen.
