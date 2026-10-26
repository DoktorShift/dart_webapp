# Audit: Rangliste und Profil heute (2026-10-26, Zweig ux/clubs-turniere-einladen)

Read-only audit of the current state, with file:line references, as the basis of the proposal.

## A. Rangliste

**Mount and shell.** `app/page.tsx:370` renders `LeaderboardScreen` directly; unlike Clubs, Turniere and Profil (`components/shell/tab-roots.tsx:28-53`) there is no `ScreenFrame`, no registry slot and nothing pushed, so no area can contribute to the tab.

**Data.** `useMatchHistory` (`lib/leaderboard.ts:23-32`): archive filtered to games with two or more players, plus imported aliases. `sameAs` is never passed.

**Standings** (`lib/storage/stats.ts:409-458`), totals only: `winRate = wins/matches`, `average = points/darts*3`, sort `wins desc, winRate desc, average desc, name`. Key `playerKey(match, player, aliases)`: `id:<playerId>` for local games, `imported:<nameKey>` for 1.0.0 results, `unnamed:<label>` for empty seats. The pubkey is not part of the key; it only feeds the "Kennung …" hint (`sameNames`).

**Imported 1.0.0 rows.** `V1MatchRecord` (`lib/storage/v1.ts:29-45`): no ids, pubkeys, throws, config, legs; newest 500 kept. Tapping a row with imported games opens `ImportedSheet` (`components/data/imported-sheet.tsx`) to assign the name to one player.

**Modes and periods.** Segmented `all | x01 | cricket | clock`; no period; reset lives in Settings (versus games only).

**Layout at 320×548.** Own scroll container, title, subtitle, segmented control, podium (only when two or more players have wins), card table with 3–4 text lines per row and two large numerals; the first row sits below the fold on an SE.

### Befunde Rangliste
- **B1 (hoch)** Ranking = raw win count across all modes: 12 of 30 beats 5 of 5; no minimum games; Cricket wins equal X01 wins under "Alle".
- **B2 (hoch)** No period or season; one all-time device list.
- **B3 (hoch)** A profile played under several player ids (other devices, re-created players) appears as several rows: `computeStandings` ignores `sameAs` although Profil uses it.
- **B4 (mittel)** Imported "Anna" and local "Anna" stay two rows until assigned; the only affordance is a tinted third line.
- **B5 (mittel)** Empty seats ("Spieler 2") get rows.
- **B6 (mittel)** The podium repeats the first three rows and costs about 130 pt on an SE; rows carry four text lines, not an iOS list idiom.
- **B7 (mittel)** Nothing opens: no player detail or head-to-head (although `profile.player` and `profile.match` screens exist); recent games are not tappable.
- **B8 (mittel)** Not a `ScreenFrame` root: no collapsing title, no bar actions, no slot for club or tournament content.
- **B9 (niedrig)** Unknown average shows "–" while Profil shows "—" with a spoken "nicht erfasst".
- **B10 (niedrig)** The HIG matrix only checks protocol words on this tab; no scroll or ellipsis audit, no component tests.

## B. Profil

**Root** `components/profile/own-profile.tsx:37-114`: `ProfileCard` with three X01 all-time figures (`x01Figures`: games, wins "von n gegen andere", average), Teilen/Bearbeiten, three recent `GameRow`s, group [Statistik, Spiele, slot `profile.rows`: Auszeichnungen, Geräte, Sicherung, Zahlungen], group [Vorschau, Einstellungen, Info, Erweitert], Abmelden. Solo games count in the summary.

**Figures** (`lib/storage/stats.ts`): all sums before dividing; `winRate = wins/versus`; `average = points/darts*3` (imported totals included); `first9` from detailed games only; `checkoutRate = checkouts/dartsAtDouble` only where doubles were measured; `highestFinish`, `bestLeg` (fewest darts in a won leg), `highestVisit`, `visits180/140/100` from throws; cricket `marksPerRound`; clock `hitRate`. Replay cached per match.

**Statistik screen** (`components/profile/stats-view.tsx`): mode and period (`all | 365 d | 30 d`, rolling), groups Ergebnisse / Punkte / Bestleistungen, basis line. Trend: one row "Ø der letzten 10 Spiele", shown only from 15 games, no direction, no series.

**Public stats card:** kind 31180, `d="stats"`, unencrypted, signed by the player; raw counts per mode (games, versus, wins, darts, x01 points, highestFinish, bestLeg, visits180, cricket marks, clock hits). Off by default ("Statistik im Profil zeigen", found only inside "So sehen andere dein Profil"). Local-key sessions republish automatically; signer sessions by hand.

**Games from other devices:** one encrypted private record per game (`lib/sync/history.ts`), merged by match id, local change wins, full game beats imported totals.

### Befunde Profil
- **B11 (hoch)** The card is X01 all-time only; no form or trend on it; the only trend is one hidden row in Statistik.
- **B12 (hoch)** Interop: no import from other apps; personal game export only as the whole-device JSON; the backup file carries the key, not games.
- **B13 (mittel)** Comparing: only local head-to-head on `PlayerScreen`; nothing compares with another profile's card; the card schema lacks first9, checkout and legs.
- **B14 (mittel)** Account matters sit directly under three recent games: 12+ rows before the fold on an SE.
- **B15 (mittel)** Scope wording: "Alle Zeiten" without saying what it covers (this device's archive plus synced profile games); guest texts say "Auf diesem Gerät".
- **B16 (mittel)** Cost: `summarizePlayer` walks every player; card, stats card and StatsView each replay every throw log on first open.
- **B17 (niedrig)** Periods are rolling 30/365 days; no calendar month or year, no season.
- **B18 (niedrig)** "Statistik im Profil zeigen" is hidden inside the preview screen.

## C. Club and tournament rankings

**Club season table** (`lib/clubs/table.ts`): `Standing{pubkey, alias, games, wins, draws, losses, points, legsFor, legsAgainst, average, rank}`; `SeasonTable{ranked, unranked, counted, open}`; rules per season (modes, points per result, confirmations, minGames, tiebreak wins / leg difference / average / head-to-head); `currentSeason`. Guests have no row. Needs `ClubState` and `view.games` (sealed in closed clubs, members only). UI today: `table-screen.tsx` HTML table with four columns on phones, season segmented control, "Du" chip, scoring sheet.

**Tournaments:** group tables `lib/tournaments/standings.ts` (2 points per win, set and leg difference, head-to-head, lot; `decidedBy` per row); final `Placement{participant, place, placeTo}` in `TournamentView.placements`. Participants are pubkeys or guest ids. Read by replaying stored events. Badges carry `places{pubkey, place, games}`; for tournaments never opened on this device only the badge exists.

## D. Data-model facts
- `ArchivedPlayer{name, won, darts, points, playerId|null, unnamed?, pubkey?}`; `ArchivedMatch` adds source `local | imported-v1`, config, throws, engineVersion. v1 lacks ids, pubkeys, throws, legs, start time.
- Per-dart data only for local games; X01 visits may be totals, so the checkout rate is conditional. Cricket/Clock figures: marks per round, hit rate, wins, legs.
- `sameAs` maps player ids to a main id; `aliases` map names to a player id. Cross-device merge by match id with (rev, device) versions.
- Formats: `blueline-data` JSON (all games, import merges by id), `blueline-club` JSON, tournament CSV (semicolon) and JSON, `blueline-backup` (key only). No CSV or other-app import anywhere.

## E. Shell, UI, i18n, tests
- Tabs in `lib/shell/nav.ts`; slot lists in `lib/shell/registry.ts:333-345` (no leaderboard slot).
- Reusable: `Group/SwitchRow/ChoiceRow/LinkRow/DisclosureRow`, `ListRow` (wraps, no ellipsis), `Segmented`, `Chip`, `AvatarStack`, `Menu`, `ActionRow`, `PhaseSteps`, `EmptyState`, `Sheet`, `Confirm`, `InlineStatus`, `FitText`, `Avatar`, `ProfileCard/Figures`.
- i18n: Rangliste texts in the start bundle `lib/i18n/de.ts:385-409`; profile texts in `features/profile*.de.ts`; `data.de.ts` for import/export.
- Tests: `storage-stats`, `profile-stats-card`, `clubs-table`, `tournament-engine`, `sync-history`; no component tests for the leaderboard or own profile.

## Capabilities and constraints
- Can: rank by any key from totals; add `sameAs` to the Rangliste with one argument; period filters via `StatsOptions.from/to`; per-game series via `gamesOf` + `matchState`; club tables per stored club via `seasonTable`; own tournament placings via `view.placements`; badges for unknown tournaments.
- Constraints: club and tournament tables need replayed state (null when sealed or not loaded); the public card has only raw totals, so friend comparison beyond games/wins/average needs a schema extension (protocol change); every summary replays throws (cache advisable); 1.0.0 mirror capped at 500; start bundle must stay small; HIG: no ellipsis, 44 pt, 320×548.
