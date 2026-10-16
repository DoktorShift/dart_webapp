# P3b.01 Private Daten

**Status:** Umgesetzt, Nachweis offen: zwei unabhängige Kopien auf öffentlichen Relays (E7)
**Paket:** P3b · **Planstelle:** [PLAN.md](../PLAN.md), Zeile 692; Zeilen 181–199 (Speicherung), 299–316 (Historie)

## Ziel

Die Spiele eines Profils liegen zusätzlich zur lokalen Kopie verschlüsselt auf seinen allgemeinen Relays, je Spiel ein Datensatz, den nur das Profil lesen kann. Ein neu verbundenes Gerät findet und liest seinen Bestand von selbst. Die App unterscheidet ehrlich zwischen „vollständig“, „teilweise“ und „nicht verfügbar“ und zeigt nie eine leere Liste, solange sie nicht nachgesehen hat.

## Produktregeln und Abnahmekriterien

- Betroffene Kriterien: A04, A07, A08, A09, A11.
- [Entscheidung 0001](../../decisions/0001-kein-eigenes-backend.md) F2 (private Historie als NIP-78-Daten, lokal bleibt maßgeblich), [Entscheidung 0002](../../decisions/0002-architektur.md) §1 (nicht geladen ist nicht leer, keine Meldungen über Hintergrundabgleich), §3 (Store `outbox`), §4 (Datenschlüssel, eine Entschlüsselung je Gerät), §5 („veröffentlicht“ ab zwei Betreibern; gesichert erst nach Wiederlesen; fehlende Kopien beim Öffnen erneut).
- Vertrag: [docs/protocol/families/private-records.md](../../protocol/families/private-records.md).
- [Designregeln](../../../../_coordination/NOSTR-DESIGN-RULES.md): Relays nur unter Erweitert; Lade-, Teil- und Offline-Zustände ehrlich; „Diagnose kopieren“ ohne Geheimnis.

## Voraussetzungen

- P1.01–P1.03 (Archiv, Spielerverzeichnis), P2.01 (Sitzung, `lib/profile/session.ts`), P3a.02 (Outbox, diese Spur).
- Nutzerfreigabe E7 für den Test auf den fünf öffentlichen Relays: steht aus.

## Umfang und Stand

| Teil | Stand | Ort |
| --- | --- | --- |
| Datenschlüssel: beim ersten Schreiben erzeugt, NIP-44 an sich selbst als 30078 unter `dataKeySlot(pubkey)`, je Gerät einmal entpackt und wie der Profilschlüssel versiegelt (`SecretPurpose "data-key"`); zwei getrennt erzeugte Schlüssel: der früher erzeugte gewinnt, das andere Gerät versiegelt seine Datensätze neu | Erledigt | `lib/sync/data-key.ts`, `lib/profile/vault.ts` |
| Datensätze: XChaCha20-Poly1305 unter dem Datenschlüssel, `aad` = Slot, Kopf plus verkettete Teile über 20 000 Byte, nur das Neueste je (rev, Gerät) | Erledigt | `lib/sync/records.ts` |
| Was ein Datensatz ist: je Spiel des Profils (Würfe kompakt kodiert; übernommene 1.0.0-Summen als `imported-v1` gekennzeichnet) und eine Spielerliste der Personen aus diesen Spielen; Löschungen als Tombstone-Version | Erledigt | `lib/sync/history.ts` |
| Abgleich: alle 30078 des Profils seitenweise von jedem Relay lesen (kein Relay = unbekannt), Fremdes übernehmen, Eigenes als neue Version schreiben, Kopien prüfen und fehlende erneut senden; in Schritten (lesen, Schlüssel klären, übernehmen, schreiben, heilen, merken), jede Schreibung nur, solange die Sitzung noch die ist, für die der Abgleich begann (Abmelden, Profilwechsel, „alles löschen“ lassen nichts zurück); sobald Relays geantwortet haben, wird die Uhr korrigiert (`syncClock`), und `created_at` einer neuen Version liegt immer über der Version der Relays (`nextCreatedAt`), sonst wartet die Änderung („clock“) | Erledigt | `lib/sync/engine.ts`, `lib/sync/records.ts` |
| Hintergrund: beim Start, beim Zeigen der App, wenn das Gerät wieder online ist, kurz nach Änderungen, auf Wunsch; einer je Browser; ein Gast ohne Profil und ohne wartende Events lädt den Dienst nie (die Startaufgabe sieht nur im kv-Store nach); ein Profil in Signer-App oder Erweiterung schreibt nur beim Start, auf Wunsch und beim Verlassen der App (ein Moment für die Nachfragen), dazwischen wird nur gelesen; nach einem teilweisen „Jetzt abgleichen“ folgt fünf Sekunden später ein zweiter vollständiger Abgleich | Erledigt | `lib/sync/service.ts`, `components/sync/register.ts`, `lib/profile/storage-keys.ts`, Registry `registerStartTask` |
| Profil und Profil › Spiele: „Deine Spiele werden geladen“ beziehungsweise „konnten noch nicht geladen werden“ mit „Erneut versuchen“ (gefüllte Hauptaktion, der Ladezustand bleibt mindestens 0,7 s sichtbar), solange dieses Gerät nicht nachgesehen hat; erst dann „Noch keine Spiele“. Ein hier angelegtes Profil (`Session.madeHere`) gilt ab seiner Geburt als abgeglichen und verspricht nichts von anderen Geräten. Ein Profil, das sich nicht öffnen ließ (Signer, Datenschlüssel), bekommt seinen eigenen Text statt „sobald eine Verbindung besteht“. Das Laden ist begrenzt: nach 20 s ohne Ergebnis „konnten noch nicht geladen werden“ | Erledigt | `components/sync/history-state.tsx`, `lib/sync/engine.ts` (`markSyncedAtBirth`), Einbau in `own-profile.tsx`, `games-screen.tsx` |
| Profil › Erweitert: „Zuletzt abgeglichen“ mit Zustand und Grund in derselben Zeile, „Noch nicht gesendet“ nur, wenn etwas wartet (Änderungen, die der letzte Abgleich nicht schrieb, weil er nur las oder nicht schreiben konnte, plus Events, die noch nicht alle Relays haben; mit dem nächsten Schritt), „Jetzt abgleichen“ (läuft sichtbar mit drehendem Symbol, nicht abgedunkelt); die Relay-Zeilen werden nach jedem Abgleich neu geprüft, damit Liste und Abgleich nie widersprechen. Prüfzeit der Kopien, die Zahl der Events mit weniger als zwei Kopien und der ungeschriebenen Änderungen stehen in „Diagnose kopieren“ (Abschnitt „Sync“) | Erledigt | `components/sync/advanced-section.tsx`, `components/profile/advanced-screen.tsx` (`useRelayStatus`), `lib/sync/service.ts` (`addDiagnostics`) |
| Signer-App: `sign_event:30078` wird beim Verbinden mit erbeten, damit die App nicht je Datensatz fragt | Erledigt | `components/profile/connect-screen.tsx` |

Nicht dazu gehören: Sicherungsdatei und Passkey (P2.04, Spur Sicherung), Gerätekopplung (Spur Geräte), Clubdaten, Zahlungsjournal.

## Fehlerfälle

| Fall | Verhalten | Prüfung |
| --- | --- | --- |
| Kein Relay antwortet | „Nicht verfügbar“, kein Zeitstempel; Profil sagt „konnten noch nicht geladen werden“ | `tests/sync-history.test.ts`, Browserlauf Gerät C |
| Ein Teil der Relays antwortet nicht | „Teilweise · Nicht jedes Relay hat geantwortet.“, Spiele trotzdem übernommen | `tests/sync-history.test.ts`, `tests/relay/sync.test.ts` |
| Datensatz unlesbar oder Teil fehlt | zählt als unlesbar, „Teilweise · Einige Spiele konnten nicht gelesen werden …“, nichts wird überschrieben | `tests/sync-records.test.ts` |
| Signer lehnt ab oder antwortet nicht | „Nicht verfügbar“ mit Grund; Datenschlüssel wird nie ersetzt | `lib/sync/data-key.ts` (`DataKeyError`), `isSignerFailure` |
| Signer ohne NIP-44 (Android Signer) | „Dein Signer kann nicht ver- und entschlüsseln. Deine Spiele bleiben auf diesem Gerät.“; die Spieleliste sagt ehrlich „Noch keine Spiele“ | Texte `sync.screens.*`, `useEmptyHistory` |
| Datenschlüssel öffnet nicht | „key“ („Der Datenschlüssel deines Profils lässt sich mit diesem Signer nicht öffnen …“), kein neuer Schlüssel | `unwrapDataKey` |
| Datenschlüssel-Event eines fremden Autors am Slot des Profils (bösartiges Relay) | wird nie geöffnet oder übernommen (`isDataKeyEvent` prüft Autor, Kind und Slot) | `tests/sync-history.test.ts` „only ever taken from the profile's own record“ |
| Uhr des Geräts geht nach | Versionen werden knapp über der Version der Relays signiert, bis zu 15 Minuten vor der korrigierten Zeit; darüber hinaus wartet die Änderung, „Teilweise · Die Uhr dieses Geräts geht nach …“ | `tests/sync-history.test.ts`, `tests/relay/sync.test.ts` „clock runs behind“ |
| Abmelden („alles löschen“) oder Profilwechsel während eines Abgleichs | der Abgleich endet ohne Spur (kein kv, kein Archiv, keine Outbox, keine eigenen Events), nichts wird später als Löschung gewertet | `tests/sync-history.test.ts` „signing out … during a sync“ |
| „Rangliste zurücksetzen“ | bleibt auf diesem Gerät: keine Löschmarke, keine Tombstones, die Spiele kommen hier nicht zurück und bleiben im Profil und auf den anderen Geräten | `tests/sync-history.test.ts`, `tests/storage-archive.test.ts` |
| Zwei Datenschlüssel | der früher erzeugte bleibt, jedes Spiel lesbar | `tests/sync-history.test.ts` „two data keys“ |
| Fremde 30078 anderer Apps | öffnen nicht mit dem Datenschlüssel, werden übergangen | `openRecords` |

## Abschlussnachweise

| Nachweis | Ergebnis |
| --- | --- |
| `tests/sync-records.test.ts` (11), `tests/sync-history.test.ts` (12), `tests/sync-outbox.test.ts` (12), `tests/storage-archive.test.ts` (Löschmarken) | bestanden |
| `tests/relay/sync.test.ts` gegen `nak serve` und `nak bunker` (7): Datensätze von nak geprüft, nicht lesbar, Datenschlüssel mit `nak decrypt` geöffnet; neues Gerät liest zurück; Signer-App-Profil über nostrconnect | bestanden |
| Browserlauf [evidence/P3b/scripts/sync-checks.mjs](../evidence/P3b/scripts/sync-checks.mjs) (Produktionsbuild, zwei lokale Relays, nak bunker): Gerät A beansprucht ein Spiel, Datensätze erreichen beide Relays von selbst, ein gestopptes Relay macht den Abgleich „Teilweise“ mit Grund in der Zeile, nach dem Neustart ist es wieder gefüllt; Gerät B findet das Spiel ohne Zuordnung; Gerät C (hier angelegt, ohne Relay) verspricht nichts; Gerät E (Profil von anderswo, ohne Relay) zeigt die ehrlichen Zustände mit „Erneut versuchen“ | siehe [evidence/P3b/README.md](../evidence/P3b/README.md) |
| Bilder | [evidence/P3b/screens](../evidence/P3b/screens) |

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch / PR | `wave2/sync` |
| Basiscommit | `a56d8ed` |
| Prüfcommit | Der Commit, der diese Karte einführt |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:relay`, `npm run build`, Browserlauf; 16. Oktober 2026 (Fix-Runde 1); Ergebnisse in [evidence/P3b/README.md](../evidence/P3b/README.md) |
| Nicht ausgeführte Prüfungen | Öffentliche Relays (E7); echte Signer-Apps (Amber, nsec.app) und Geräte; Safari, Firefox, installierte PWA; VoiceOver |
| Verbleibende Einschränkungen | Keine Vorwärtssicherheit (Bedrohungsmodell 0002 §10); NIP-55-Profile ohne private Historie; eine Signer-App ohne gemerkte Erlaubnis fragt je Datensatz, aber nur beim Start, auf Wunsch und beim Verlassen der App; „gesichert“ heißt: bei einem vollständigen Abgleich wieder gelesen; ein hier angelegtes Profil zeigt unter Erweitert seine Geburt als „Zuletzt abgeglichen“, auch wenn noch kein Relay antwortete (zu dem Zeitpunkt war sein Bestand sicher leer) |

## Stand im Integrationszweig (16. Oktober 2026)

| Punkt | Wert |
| --- | --- |
| Zusammengeführt | Spur `wave2/sync`, Endstand `f7bb861`, zusammengeführt in `871e237` (16. Oktober 2026) |
| Review | Review 1 (3 hoch, 4 mittel, 6 niedrig) und HIG 1 (3 mittel, 2 niedrig) → Korrektur `788dfab`/`c01e355`; Review 2: alle drei hohen Befunde halten, ein neuer hoher (Outbox-Schleife) und zwei niedrige → Korrektur `f7bb861`; Koordinator-Review |
| nostr-core-Version | 1.0.6 |
| Prüfungen der Spur | 16. Oktober 2026 auf `f7bb861`: `npm test` 516/516, Relay 31/31; beide neuen Tests scheitern gegen den alten Code. Browser 34/34 auf `788dfab` ([evidence/P3b](../evidence/P3b/README.md)); nach Korrektur 2 kein neuer Browserlauf |
| Prüfungen auf `nostr-plan` `4c4ce92` | 16. Oktober 2026, Prüfung beim Zusammenführen: `lint` und `typecheck` ohne Meldung, `npm test` 662 von 662, `npm run test:relay` 80 von 80 gegen lokale nak-Relays, `build` bestanden (`/` 71,1 kB, First Load 278 kB). Kein Browserlauf auf genau diesem Stand (P8.01). |
| Offen für die Abnahme | Aufbewahrung auf öffentlichen Relays; Android-Signer ohne NIP-44 bekommen keine private Historie (STATUS SY-02) |

## Nächster Schritt

Schreib- und Aufbewahrungstest (24 Stunden, 7 Tage) auf den fünf öffentlichen Relays nach E7.
