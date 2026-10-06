# P3b.01 Private Daten

**Status:** In Prüfung (Schreib- und Aufbewahrungstest auf öffentlichen Relays offen, Nutzerfreigabe E7)
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
| Abgleich: alle 30078 des Profils seitenweise von jedem Relay lesen (kein Relay = unbekannt), Fremdes übernehmen, Eigenes als neue Version schreiben, Kopien prüfen und fehlende erneut senden | Erledigt | `lib/sync/engine.ts` |
| Hintergrund: beim Start, beim Zeigen der App, wenn das Gerät wieder online ist, kurz nach Änderungen, auf Wunsch; einer je Browser | Erledigt | `lib/sync/service.ts`, `components/sync/register.ts`, Registry `registerStartTask` |
| Profil und Profil › Spiele: „Deine Spiele werden geladen“ beziehungsweise „konnten noch nicht geladen werden“ mit „Erneut versuchen“, solange dieses Gerät nicht nachgesehen hat; erst dann „Noch keine Spiele“ | Erledigt | `components/sync/history-state.tsx`, Einbau in `own-profile.tsx`, `games-screen.tsx` |
| Profil › Erweitert: Zuletzt abgeglichen (Zustand), Kopien zuletzt geprüft, wartende Übertragungen, Events mit weniger als zwei bestätigten Kopien, „Jetzt abgleichen“; Abschnitt „Sync“ in „Diagnose kopieren“ | Erledigt | `components/sync/advanced-section.tsx`, `lib/sync/service.ts` (`addDiagnostics`) |
| Signer-App: `sign_event:30078` wird beim Verbinden mit erbeten, damit die App nicht je Datensatz fragt | Erledigt | `components/profile/connect-screen.tsx` |

Nicht dazu gehören: Sicherungsdatei und Passkey (P2.04, Spur Sicherung), Gerätekopplung (Spur Geräte), Clubdaten, Zahlungsjournal.

## Fehlerfälle

| Fall | Verhalten | Prüfung |
| --- | --- | --- |
| Kein Relay antwortet | „Nicht verfügbar“, kein Zeitstempel; Profil sagt „konnten noch nicht geladen werden“ | `tests/sync-history.test.ts`, Browserlauf Gerät C |
| Ein Teil der Relays antwortet nicht | „Teilweise · Kein Relay hat geantwortet.“, Spiele trotzdem übernommen | `tests/sync-history.test.ts`, `tests/relay/sync.test.ts` |
| Datensatz unlesbar oder Teil fehlt | zählt als unlesbar, „Teilweise“, nichts wird überschrieben | `tests/sync-records.test.ts` |
| Signer lehnt ab oder antwortet nicht | „Nicht verfügbar“ mit Grund; Datenschlüssel wird nie ersetzt | `lib/sync/data-key.ts` (`DataKeyError`), `isSignerFailure` |
| Signer ohne NIP-44 (Android Signer) | „Dein Signer kann nicht ver- und entschlüsseln. Deine Spiele bleiben auf diesem Gerät.“; die Spieleliste sagt ehrlich „Noch keine Spiele“ | Texte `sync.screens.*`, `useEmptyHistory` |
| Datenschlüssel öffnet nicht | „unreadable“, kein neuer Schlüssel | `unwrapDataKey` |
| Zwei Datenschlüssel | der früher erzeugte bleibt, jedes Spiel lesbar | `tests/sync-history.test.ts` „two data keys“ |
| Fremde 30078 anderer Apps | öffnen nicht mit dem Datenschlüssel, werden übergangen | `openRecords` |

## Abschlussnachweise

| Nachweis | Ergebnis |
| --- | --- |
| `tests/sync-records.test.ts` (9), `tests/sync-history.test.ts` (7), `tests/sync-outbox.test.ts` (9) | bestanden |
| `tests/relay/sync.test.ts` gegen `nak serve` und `nak bunker` (6): Datensätze von nak geprüft, nicht lesbar, Datenschlüssel mit `nak decrypt` geöffnet; neues Gerät liest zurück; Signer-App-Profil über nostrconnect | bestanden |
| Browserlauf [evidence/P3b/scripts/sync-checks.mjs](../evidence/P3b/scripts/sync-checks.mjs) (Produktionsbuild, zwei lokale Relays, nak bunker): Gerät A beansprucht ein Spiel, Datensätze erreichen beide Relays von selbst, Gerät B findet das Spiel ohne Zuordnung, Gerät C ohne Relay zeigt die ehrlichen Zustände | siehe [evidence/P3b/README.md](../evidence/P3b/README.md) |
| Bilder | [evidence/P3b/screens](../evidence/P3b/screens) |

## Ergebnis

| Punkt | Wert |
| --- | --- |
| Branch / PR | `wave2/sync` |
| Basiscommit | `a56d8ed` |
| Prüfcommit | Der Commit, der diese Karte einführt |
| nostr-core-Version | 1.0.4 |
| Ausgeführte Prüfungen | `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:relay`, `npm run build`, Browserlauf; 6. Oktober 2026; Ergebnisse in [evidence/P3b/README.md](../evidence/P3b/README.md) |
| Nicht ausgeführte Prüfungen | Öffentliche Relays (E7); echte Signer-Apps (Amber, nsec.app) und Geräte; Safari, Firefox, installierte PWA; VoiceOver |
| Verbleibende Einschränkungen | Keine Vorwärtssicherheit (Bedrohungsmodell 0002 §10); NIP-55-Profile ohne private Historie; Abgleich schreibt automatisch, eine Signer-App ohne gemerkte Erlaubnis fragt je Datensatz; „gesichert“ heißt: bei einem vollständigen Abgleich wieder gelesen |

## Nächster Schritt

Schreib- und Aufbewahrungstest (24 Stunden, 7 Tage) auf den fünf öffentlichen Relays nach Nutzerfreigabe E7.
