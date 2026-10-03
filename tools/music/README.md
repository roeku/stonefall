# Stonefall music

The game no longer plays music rendered here: since 2026-10-03 its music is generated live from the run (`src/client/components/audio/music.ts`). This folder stays as a Strudel sandbox for sketching sounds and textures, and `loops.py` cuts a finished track into bar-aligned loops if a rendered or licensed track is ever used again.

The game's soundtrack, written in [Strudel](https://strudel.cc): adaptive synthwave after Daft Punk's Derezzed, 120 BPM in E minor, played on a TR-909, a Moog Little Phatty and a Roland JD-Xi (public-domain samples) with Strudel's own synths. `stonefall.strudel` is six eight-bar stems that loop together (riff, drums, stabs, arp, lead, drive) and three one-shots (intro, lift, derez); the game sets each stem's level from what the run is doing (`src/client/components/audio/music.ts`). Its own package, not part of the game's build, and `tools/` is never uploaded to Reddit.

- `npm install`, `npm run samples` (fetches the samples, all CC0, into `samples/`: Sonic Pi's library and Freesound sounds whose page says CC0, retuned and trimmed where they need it; sources in `samples/CREDITS.md`), then `npm run repl` opens the Strudel REPL on http://localhost:7480 with the track loaded. A button per mix the game moves between (build, groove, high, streak, danger…) and per one-shot; Ctrl+Enter plays, Ctrl+. stops, Ctrl+S saves back to the file.
- `npm run render` (or `npm run render -- drums lift`) renders offline in headless Chrome, pumps the synth stems on the beat, masters every file the same way, and writes `out/music/*.mp3` with the groove at -21 LUFS. Copy them into `src/client/public/music/` to use them.
- It also plays a scripted run through the game's own engine: `out/stonefall-demo.mp3`, with what happens when in `out/stonefall-demo.txt`.

## Checking the game's sound

Nobody can listen for you, so these measure what the game itself plays, through its own audio code on the play server (`npm run play`, :7474), in headless Chrome:

- `npm run sheet` plays every effect the way the game calls it (`sheet-plan.js`: the board, a run with its music, the relay) and records it to `out/sheet.webm`, with each cue's time in `out/sheet.json`. `python3 sheet_stats.py out/sheet.wav out/sheet.json` (after `ffmpeg -i out/sheet.webm out/sheet.wav`) gives each cue's peak, its loudest moment in LUFS, and the notes it sounds with their cents off true pitch; a note marked `!` is outside E minor.
- `python3 ab.py old.wav old.json new.wav new.json out/ab.mp3` puts two sheets side by side, old then new for each cue, and prints where each one starts.
- `npm run record-run` plays a real run until it falls, then waits on the board, and records it to `out/run.webm`.
- `node combo.mjs 50` plays 50 perfect drops in a row, one block at a time, then one off the edge, and films it with its sound (`out/stonefall-50-combo.mp4`). `PLAN=0,0,0.18,0.35` drops each block that far off the middle (a share of its width; 0 is a perfect): the picture is a CDP screencast, the sound the game's audio context, lined up by `AudioContext.getOutputTimestamp` (the wall clock at the recorder's start is off by however long the context took to start).

Strudel is AGPL-3.0; only the rendered audio goes into the game. Every sample is public domain (CC0), so the rendered music carries no conditions.
