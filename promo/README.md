# BlueLine Darts: social video

A 37-second vertical film (1080 × 1920, 30 fps) for BlueLine Darts, built entirely from code: the real app recorded frame by frame, 3D-rendered dartboard shots, synthesized sound design and music, and a temporary text-to-speech narrator.

The idea, from the brief: the darts stay physical, and Blue Line takes care of everything around them. Every shot follows the same pattern: throw, impact, input, score, next player.

## Files (`out/`)

| File | What it is |
| --- | --- |
| `BlueLine-Darts-Social-9x16.mp4` | The film with the temporary narration. H.264 High, BT.709, CRF 16 (about 12 Mbit/s), AAC 320 kbit/s, mixed to −14 LUFS and −1 dBTP |
| `BlueLine-Darts-Social-9x16-no-voiceover.mp4` | The same picture with music and sound effects only, for posting with on-screen captions or for laying a recorded narrator on top |
| `BlueLine-Darts-Social-9x16.srt` | Captions for the narration, timed to the voice |
| `stems/music.wav`, `stems/sound-effects.wav`, `stems/voiceover-temp.wav` | The three stems (48 kHz, 24-bit), so a sound designer can remix |

`out/` and `build/` are git-ignored (video and frames are large). Everything in them can be rebuilt with the scripts below.

## What is real, and what stands in

- **The app is real.** Every app shot is the production build (`npm run build && npx next start -p 3123`) driven by real taps in a phone-sized browser (393 × 852 at 4× pixel density). Scores, checkout routes ("T20 T20 Bull" for 170) and the result statistics are what the app computes from the darts in `timeline/game.mjs`: Mia wins with a 170 checkout, averaging 100.2. Nothing on screen is mocked or painted over.
- **The board shots are CGI stand-ins** for filmed footage: a regulation board built from the app's own geometry (`lib/board-geometry.ts`), steel-tip darts, an LED ring light, rendered with motion blur, depth of field and soft multi-shadows. They can be swapped for filmed shots (see below).
- **The narrator is a temporary voice.** It's Kokoro-82M (Apache-2.0 open model, voice `af_heart`), generated locally, word for word from the brief. Speech recognition reads every line back correctly from the finished mix, music and effects included (`npm run qa`). For release, record a real narrator.
- **Music and sound effects are synthesized** (Web Audio, offline): layered dart THUDs (steel tip, sisal crunch, board body, low weight), keypad clicks, a two-tone confirmation per dart, a swish when the turn moves on, room tone, and a minimal 120 BPM score in D minor that resolves to D major on the winning bull. Every dart in the app section lands on a beat or an eighth note, and the bull lands on a downbeat.

## The edit

| Time (s) | Picture | Narration |
| --- | --- | --- |
| 0.0 – 3.5 | Cold open: three darts, THUD, THUD, THUD (T20, 20, 5). People around the board. The chalkboard gets 361 − 85 wrong. "Who's counting?" | none |
| 3.5 – 11.85 | Hard cut into the app on the downbeat: home screen, X01, setup. Players added one tap at a time from 1 to 6 until "Add player" disappears. Start game | v1, v2a, v2b |
| 11.85 – 15.4 | Split screen: dart lands above, entered below. Mia's visit (T20, 20, T20), then the turn moves to Leo by itself | v3 |
| 15.4 – 21.05 | Dart, score, next player: Leo, Sam. Later in the game, Lena on 140 with her route T20 T20 D10 | v4 |
| 21.05 – 27.8 | Lena left on 10, Ben misses, Mia on 170 with T20 T20 Bull in her empty dart slots. Three darts, the bull in slow motion | v5, v6 |
| 27.8 – 30.5 | "Mia wins", with the real per-player statistics | v6 |
| 30.5 – 34.6 | 1 Player, 2 Players, 6 Players. "Same board. Same game. No paperwork." The last dart, cut to black on the impact | none |
| 34.6 – 37.0 | App icon, "Throw darts. We'll keep score.", BlueLine Darts and the web address. Ends on a mechanical click | none |

The film runs 37 seconds, not 30. The brief's narration alone is about 22 seconds. Add the cold open, the checkout tension and the closing montage, and 30 seconds would mean rushing the app interactions, which the brief rules out. For a strict 30-second cut, the clearest candidates are the Leo and Sam rhythm (15.4–18.2) and the montage (30.5–32.75).

The whole edit lives in `timeline/edit.mjs`: clips, the camera on the app, board shots, words on screen, narration cues and music sections. The picture and the sound both read it.

## Rebuilding

Needs Node 22.18+, ffmpeg, and the app running on port 3123 (`npm run build && npx next start -p 3123` in the repo root).

```sh
cd promo
npm install
npm run shoot      # app takes        -> build/takes/   (about 3 min)
npm run board      # board shots      -> build/board/   (about 6 min, uses the GPU)
npm run voice      # temp narration   -> build/vo/      (downloads the Kokoro model once)
npm run audio      # soundtrack       -> build/audio/
npm run frames     # the film         -> build/frames/  (about 2 min)
npm run encode     # deliverables     -> out/
npm run qa         # loudness per line, and a transcript of the narration from the mix
```

`npm run check 12.4,27.6` renders single frames to `build/check/` for a quick look.

How the app is recorded (`capture/recorder.mjs`): the page runs on a virtual clock. Timers, `Date`, `performance.now`, animation frames, CSS transitions and Web Animations all advance exactly one frame per screenshot. So framer-motion's springs and the screen pushes come out smooth and at real speed, however long each screenshot takes, and every run is identical.

## Replacing the temporary narrator

The lines and their slots in the film:

| Line | Slot (s) | Text |
| --- | --- | --- |
| v1 | 3.64 – 5.79 | Blue Line keeps the scoring out of your game. |
| v2a | 6.05 – 8.65 | Playing alone, head-to-head, or with the whole group. |
| v2b | 9.30 – 11.77 | Start a game for one to six players in seconds. |
| v3 | 12.35 – 14.97 | Enter the throw, and Blue Line handles the rest. |
| v4 | 15.40 – 20.83 | Even with six players, everyone knows whose turn it is, what they need, and where the game stands. |
| v5 | 21.20 – 24.75 | When the game gets close, the important information is already there. |
| v6 | 26.12 – 29.21 | And when the last dart lands, the result is already done. |

Timing worth keeping: "head-to-head" just as Leo is added (6.95 s), "what they need" on the zoom into Lena's route (18.8 s), and "lands" just before the bull hits (27.5 s).

To use a recording: save each phrase as `build/vo/<name>/<line>.wav` (trimmed, mono is fine). Add its length to `build/vo/durations.json`, run `node audio/render.mjs <name>` and `node tools/encode.mjs <name>`, and nudge the cue times in `VO` in `timeline/edit.mjs` if a take runs long. The music ducks under each line by itself. The no-voiceover file and the stems also work for mixing a recording in any editor.

## Replacing the CGI board shots with filmed footage

Each board shot is a PNG sequence in `build/board/<shot>/00000.png …` at 1080 × 1920. A filmed shot exported to the same name and frame count drops straight in. Run `npm run frames && npm run encode` after.

| Shot | In the film (s) | Dart landing | Already in the board | Flights |
| --- | --- | --- | --- | --- |
| co1 | 0.00 – 0.80 | T20 at 0.38 | none | blue |
| co2 | 0.80 – 1.36 | 20 at 0.96 | T20 | blue |
| co3 | 1.36 – 1.92 | 5 at 1.52 | T20, 20 | blue |
| co4 | 1.92 – 2.62 | wide: people around the board | T20, 20, 5 | blue |
| co5 | 2.62 – 3.50 | the chalkboard: MIA 501 / ~~441~~ / 361 / ~~281~~ / 276 ? | | |
| g1 | 11.85 – 13.05 | T20 at 12.00 (top band of the split screen) | none | blue |
| g2 | 13.05 – 13.45 | 20 at 13.25 | T20 | blue |
| g3 | 13.87 – 14.27 | T20 at 14.00 | T20, 20 | blue |
| l1 / l2 / l3 | 15.38 – 16.95 | 20, T20, 5 at 15.50, 16.00, 16.75 | the visit so far | white |
| s1 | 17.40 – 17.65 | T19 at 17.50 | none | black |
| lena1 / lena2 / lena3 | 19.40 – 21.05 | T20, T20, single 10 at 19.50, 20.25, 21.00 | the visit so far | graphite |
| ck1 / ck2 | 24.75 – 26.30 | T20, T20 at 25.00, 26.00 | the visit so far | blue |
| ck3 | 26.75 – 27.80 | Bull at 27.50, slow motion (about 4×) | T20, T20 | blue |
| beauty | 32.75 – 34.27 | T20, T20 and Bull in the board, slow push in; leave the lower half calm for the words | | blue |
| final | 34.27 – 34.60 | Bull at 34.50, cut to black three frames later | none | blue |

The impact frames carry the THUD in the soundtrack, so keep each landing on its time.

## Noticed in the app while making this

The home screen's practice board is meant to open with a dart flying into T20 (`components/hero-board.tsx`), but the dart appears without its fly-in. Cause: the page-level `<AnimatePresence initial={false}>` in `app/page.tsx` suppresses the initial animation of motion components mounted inside it later, which includes the darts thrown by tapping the practice board. The film shows the app as it behaves today.
