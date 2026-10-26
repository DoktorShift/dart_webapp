# Research: Apple HIG patterns for Profil and Rangliste (2026-10-26)

Source basis: the HIG pages (read through Apple's JSON backend, since the pages are JS-rendered), WWDC sessions verified by ID, the iPhone User Guide pages for Health, Fitness and the Games app. Items marked *(observed)* are app behaviour, not written HIG rules. Note: the HIG "Navigation bars" page now redirects to Toolbars; iOS 26 treats the navigation bar as a toolbar.

## A. Pattern catalogue

1. **Scope selector above a ranked list.** GameKit leaderboards have `playerScope` (global/friends) and `timeScope` (today/week/all time); the HIG recommends leaderboard sets to group boards by theme. [HIG Game Center](https://developer.apple.com/design/human-interface-guidelines/game-center), [WWDC25-214](https://developer.apple.com/videos/play/wwdc2025/214/). → Rangliste: the segmented control "Gerät · Club · Turnier" is a leaderboard set; the time scope goes in a secondary menu, not a second segmented row.
2. **Own rank row pinned.** GameKit returns `localPlayerEntry` separately, so the player's row sits pinned even when ranked 400th; Fitness Sharing lists your own card first. [GKLeaderboard](https://developer.apple.com/documentation/gamekit/gkleaderboard) → sticky "Du · Platz 7" row.
3. **Achievement cards, four states.** Locked / in progress / hidden / completed, grouped by completion, titles capped at two lines. [HIG Game Center](https://developer.apple.com/design/human-interface-guidelines/game-center) → awards grid with greyed locked cards and a progress ring.
4. **Profile card with avatar and nickname.** Games app: tap avatar → profile → "Edit Profile"; sharing is one choice: Everyone / Friends Only / Only You. [Game Center profile](https://support.apple.com/guide/iphone/set-up-your-game-center-profile-iphd26b2beaa/ios) → visibility is one picker row, not several toggles.
5. **Summary made of cards.** Fitness Summary: rings, Trends, Sessions, Awards as tappable areas. [Activity summary](https://support.apple.com/guide/iphone/see-your-activity-summary-iph4c34a8a95/ios) → key figures as a card.
6. **Trend arrow with explicit comparison period.** Fitness: "Your last 90 days are compared to the last 365"; a down arrow comes with a coaching sentence; "It takes 180 days to start your trends." → "Ø 48,2 ↑ · letzte 10 Spiele gegenüber davor"; show the threshold text when there are too few games.
7. **Trends vs. Highlights.** Health: Highlights describe the present, Trends the direction. [Health data](https://support.apple.com/guide/iphone/view-your-health-data-iphe3d379c32/ios) → separate "Form" (trend) from "Bestleistungen" (highlights).
8. **Chart continuity small → large.** The expanded chart keeps the style, colours, marks and annotations of the small one. [HIG Charting data](https://developer.apple.com/design/human-interface-guidelines/charting-data)
9. **Descriptive headline over a chart.** One sentence takeaway above every chart; it does not replace accessibility labels. [Charting data](https://developer.apple.com/design/human-interface-guidelines/charting-data), [WWDC22-110340](https://developer.apple.com/videos/play/wwdc2022/110340/)
10. **Period picker with at most five short nouns.** [HIG Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls), [WWDC22-110342](https://developer.apple.com/videos/play/wwdc2022/110342/) → "10 · 30 · 100 · Alle" games as the period axis.
11. **Audio graphs and chart labels.** [WWDC21-10122](https://developer.apple.com/videos/play/wwdc2021/10122/) → each chart gets an `aria-label` summary and a hidden table.
12. **Friends comparison list.** Fitness Sharing: rows with avatar + one figure; privacy and destructive actions in the row's More menu. [Share your activity](https://support.apple.com/guide/iphone/share-your-activity-iph0b826155d/ios)
13. **Inset-grouped lists with headers and footers.** Footers explain; chevron for drill-down. [HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)
14. **Large title that collapses on scroll.** [HIG Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
15. **Floating Liquid Glass tab bar, minimize on scroll, search at the bottom.** [HIG Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [WWDC25-323](https://developer.apple.com/videos/play/wwdc2025/323/), [WWDC25-219](https://developer.apple.com/videos/play/wwdc2025/219/), [WWDC25-356](https://developer.apple.com/videos/play/wwdc2025/356/)
16. **Materials in the right layer.** "Don't use Liquid Glass in the content layer." [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials) → cards and tiles stay flat.
17. **One tinted primary action.** [HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)
18. **Honest sync state.** iCloud: tell people unobtrusively when changes will not be on other devices; Files labels local data "On My iPhone" *(observed)*. [HIG iCloud](https://developer.apple.com/design/human-interface-guidelines/icloud) → scope footers.
19. **Export via the Share sheet, kept out of the main flow.** Health: profile picture → Export All Health Data → share sheet. [Health export](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios), [HIG Activity views](https://developer.apple.com/design/human-interface-guidelines/activity-views)
20. **Placeholders and last-updated.** [HIG Loading](https://developer.apple.com/design/human-interface-guidelines/loading), [HIG Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators); Health shows "No Data" tiles *(observed)*.

## B. Do not

1. Do not hide or disable the Club or Turnier segment when empty; explain why it is empty.
2. Do not exceed five segments or mix icons with text in one segmented control.
3. Do not use a segmented control to switch between unrelated sections or to trigger actions.
4. Do not encode trend direction with red/green alone: arrow + word + colour.
5. Do not truncate award titles or names with "…"; wrap or shorten.
6. Do not put Liquid Glass on cards or stat tiles.
7. Do not stack sheets or open a sheet from a sheet.
8. Do not use Ultralight/Thin/Light weights for figures; the hierarchy must survive 200 % Dynamic Type ([WWDC24-10074](https://developer.apple.com/videos/play/wwdc2024/10074/)).

## C. Information hierarchy (390×844)

**Profil:** sports card (photo, name, up to three award badges, three figures) with a one-line trend sentence above the fold; "Form" sparkline card with headline (period control inside the pushed detail); "Letzte Spiele" three rows + "Alle anzeigen"; "Bestleistungen" value rows that push to the game; "Auszeichnungen" strip with "Alle"; "Konto" section at the bottom (Geräte, Sicherung, Zahlungen, Einstellungen) as inset groups with footers. Sheets: edit, visibility, export/import. Share via the toolbar button.

**Rangliste:** large title, toolbar with Share and More (time scope, sort, import/export); segmented control Gerät · Club · Turnier; scope footer stating what the data covers; optional top-3 strip, then the ranked list (rank tabular, avatar, name, one figure right-aligned, own row highlighted); pinned own-rank row above the tab bar; push for player, season and bracket details; sheet for filters; search field at the bottom only for lists over about 20 rows.

## D. Typography and numbers

System text styles (Large Title 34, Title 1 28, Title 2 22, Title 3 20, Headline 17 semibold, Body 17, Subheadline 15, Footnote 13, Caption 1 12). Pairs: hero figure Title 1 + Caption 1; tile Title 2 + Footnote; list value Body right-aligned. All figures `font-variant-numeric: tabular-nums`. Averages one decimal with locale separator (48,2), percentages without decimals, ranks "7." in German. Unknown values as "—" with the label kept and an aria-label ("keine Daten"), never "0" or an empty slot; below a threshold add a footnote ("Ab 5 Spielen"). Trend: arrow + word + semantic colour, semibold. No light weights; test at the largest accessibility size and let tiles wrap to one column.
