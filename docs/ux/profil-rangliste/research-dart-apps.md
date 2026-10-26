# Research: what dart apps do for profiles, stats and leaderboards (2026-10-26)

Sources: official docs, release notes, store listings, help centres and explainer sites (Reddit was not reachable from the research environment; complaints come from store reviews and FAQs).

## Per app

- **DartCounter** ([stats manual](https://dartcounter.net/darts-manual/dartcounter-statistics), [v9.0.0](https://dartcounter.net/release-notes/release-notes-dartcounter-v9-0-0), [v9.5.0](https://dartcounter.net/release-notes/release-notes-dartcounter-v9-5-0), [local tournaments](https://dartcounter.net/press/local-tournaments)): key stats 3-dart average, first 9, checkout %, best legs, darts per leg, W-D-L, tournaments won; recent games in "15 chunks" to spot streaks; date range and mode drive a trend line and "% improved"; scoring-range histogram. Periods day/week/month/year/all time. No global board; Ranked is an Elo-style ladder. Share a result card and a "My Year" recap; head-to-head bar on friends' profiles; local-tournament guests by name, account holders link via QR and matches flow into their stats. Complaints: stats behind the paywall, guests take taps, cricket average missing.
- **Autodarts** ([stats page](https://autodarts-docs.pages.dev/statistics/stats-page/), [player cards / H2H](https://autodarts-docs.pages.dev/statistics/player-cards/)): mode pills first; legs played/won; 3DA and checkout % each with a "Prev." value over the previous 100 legs; scoring table 60+/100+/140+/170+/180; match history with date range and opponent filter. Deliberately no global ranking ("could lead to cheating"); H2H with side-by-side bars and the leading side highlighted. No export; the community built [autodarts-stats](https://github.com/TimHasenkamp/autodarts-stats) (sortable leaderboard with a minimum-matches filter). Review: family play "without affecting my stats".
- **Scolia** ([FAQ](https://scoliadarts.com/faq/)): 3DA, first 9, checkout rate on a timeline; recent form, best legs; "Hall of Fame" from tournament points; unlimited accounts per device; guest games without stats; data export.
- **n01 (nakka)** ([site](https://nakka.com/soft/n01/index_eng.html)): winning average, dart average, checkout %; CSV save.
- **My Dart Training**, **Dartsmind**, **Darts Scoreboard (Haaz)**, **Dart Tracker** ([App Store](https://apps.apple.com/mt/app/dart-tracker/id6759006910)): training progress, per-game stats, multiple profiles with merge; Dart Tracker has a global leaderboard sortable by average, win rate, games, 180s; pre-account games carry over on sign-up; a bug once duplicated profiles on cloud restore. Haaz complaint: stats cannot move to another device.
- **DartConnect** ([leaderboard](https://leaderboard.dartconnect.com/leaderboard?x=1639858385808)): default sort 3DA, filters minimum matches, season segment; guest-to-member merge; "Home vs Away" keeps stats off accounts.
- **Strava** ([filters](https://support.strava.com/en-us/articles/15401771-segment-leaderboard-filters)): scope Overall / Following / Clubs / My Results; time Today / This Year / All-Time; progress chart with compare date range.
- **Apple Fitness** ([Trends](https://support.apple.com/108359)): last 90 days vs last 365; arrows; needs 180 days; coaching sentence on a down arrow.

## Users expect (ranked)
1. 3-dart average as the headline, first 9 and checkout % beside it.
2. "Recent vs before", not only all-time.
3. Period switching: all time / year / month / last N.
4. 180s, highest finish, best leg as highlights.
5. Win rate and W/L split by context (personal / tournament / ranked).
6. Head-to-head against a person with side-by-side bars.
7. Leaderboards sortable by several keys with a minimum-games qualifier.
8. Guest play that does not pollute one's own stats but can be claimed later.
9. A shareable result card or season recap.
10. Score-band breakdown (60+/100+/140+/180).

## Patterns worth adopting
1. Figure + "Prev." pair (Autodarts).
2. Rolling "last N" as the default form window (Autodarts 100 legs; about 10 sessions for casual players).
3. Trend arrow with threshold and a plain coaching sentence (Apple Fitness).
4. Bar per game for recent games (DartCounter chunks).
5. Context tabs for form (personal / tournament / ranked) → our Gerät / Club / Turnier.
6. Scope label on every leaderboard (Strava).
7. Minimum-games qualifier and multi-key sort (DartConnect, Dart Tracker).
8. H2H bars with the leading side highlighted (Autodarts).
9. Claim or merge a guest into a profile (DartConnect, Dart Tracker).
10. Shareable recap or result card (DartCounter).

## Anti-patterns
1. Paywalling the basic trio.
2. Averaging leg averages instead of total points ÷ total darts.
3. Unlabelled checkout % (dart-based vs turn-based differ 2–3×).
4. Silent duplicate profiles from guests or restores without a merge.
5. Mixing scopes (device, club, tournament) in one list, or global rankings without integrity.

## Field definitions
- **3-dart average** = total points ÷ total darts × 3 across all legs; a bust counts 3 darts and 0 points; the winning visit counts only darts thrown.
- **First-9 average** = the same over the first 9 darts of each leg.
- **Checkout %** = checkouts ÷ darts at a double (dart-based); turn-based = legs won ÷ visits with a finish possible. Label which one.
- **Win rate** = matches (or legs) won ÷ played; state the unit.
- **Best leg** = fewest darts to finish a leg. **Highest finish** = largest checkout in one visit. **Darts per leg** = darts ÷ legs.
