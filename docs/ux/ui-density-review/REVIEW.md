# UI density review — work in progress

Baseline: origin/main at 2a857eb. Screenshots are from Chromium against the local application in the indicated viewport sizes. They do not establish native iOS behavior.

## Evidence checked

- `dart-ranks-320.png`: empty leaderboard at 320 × 548; all four sections are visible.
- `dart-filter-568.png`: filter sheet at 568 × 320; its body scrolls.
- `dart-game-320.png` and `dart-game-568.png`: six-player X01 at 320 × 548 and 568 × 320; names and scores remain visible for the sample players.
- `dart-result-320.png` and `dart-result-568.png`: completed two-player X01 at those sizes. The result menu was opened and exposed New Game, Share, Statistics, Visits and Leaderboard.

## Red-team findings and blue-team response

| Finding | Response | Status |
| --- | --- | --- |
| A segmented radio group lacked arrow-key navigation after replacing scrollable pills. | Added arrow-key navigation and roving tab stops. | Implemented; needs keyboard interaction test. |
| Matching names do not prove two rows are the same player; some people can share a name or even appear in the same game. | Preserve separate identities until an explicit, reversible linking flow is designed and tested. | Open. |
| Two players can share a first name, and long names can still exceed a short game tile. | Full names are retained when first names collide. | Needs collision and long-name layout tests across X01, Cricket and Clock. |
| Pull-to-refresh can conflict with scrolling and must remain accessible to non-touch users. | A downward gesture at the top triggers refresh; the existing explicit refresh action remains. | Implemented; needs real touch and offline/error interaction tests. |
| Import provenance can be lost when badges are removed. | Separate symbols and a legend preserve the distinction; screen readers receive the full labels. | Implemented; needs populated-list and screen-reader testing. |
| A compact filter sheet can hide its later controls in landscape. | Its contents have a scrolling body with a pinned Done action. | Visual check only; test actual selection in both languages. |
| Existing evening and screenshot scripts refer to old labels and direct scan actions. | Matrix section labels were updated. | Evening flow and filter interactions need updating and running. |

The full suite passed 722 tests after the club, tournament, payment, setup and copy changes. Type checking and lint also passed. A full end-to-end run remains necessary. Other requested UI improvements remain open, including profile action hierarchy and safe player linking. This is not a completed red-team/blue-team review.
