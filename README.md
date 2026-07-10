# gitgroove

> Turn a git repository's history into a chiptune WAV. Zero-dependency CLI.

[![CI](https://github.com/printemps-tokyo/gitgroove/actions/workflows/ci.yml/badge.svg)](https://github.com/printemps-tokyo/gitgroove/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

`gitgroove` sonifies a repository: every commit becomes a beat, the melody
pitch follows how much each commit changed, each author plays their own
waveform, and a bass and drum track keep time. Point it at a repo and get a
little 8-bit theme song for its history.

```console
$ gitgroove --limit 200 --scale blues --bpm 240
gitgroove  200 commits -> 50.2s @ 240 BPM

Instruments (by author)
  square ⊓     alice   (128)
  triangle △   bob     (72)

Melody
  ▆▅▇▁▅█▇▆▁▆▇▆▅▁▅▅▆▅▁█▆▅▆▁▆▅▆▅▁▇▆▆▆▁▅▆▆▄▁▅▆

Wrote gitgroove.wav
```

The output is deterministic: the same history always produces the exact same
WAV. There are no dependencies — the synthesis and the WAV encoder are written
from scratch with Node's built-ins, and the only IO is `git log`, writing the
file, and optional playback.

## Requirements

- Node.js >= 20
- `git` on your PATH

## Install

Not published to npm yet — install from source:

```bash
git clone https://github.com/printemps-tokyo/gitgroove
cd gitgroove
npm install && npm run build
npm link   # optional: puts the `gitgroove` command on your PATH
```

## Usage

```bash
gitgroove                                  # sonify the current repo -> gitgroove.wav
gitgroove --limit 200 --bpm 240 --play     # recent history, faster, play it
gitgroove --scale blues -o song.wav        # a bluesier arrangement
gitgroove --repo ../other-project          # a different repository
gitgroove --path src --no-drums            # only src/, melody + bass only
```

| Option | Description |
| --- | --- |
| `--repo <path>` | Repository to read (default: current directory) |
| `-o, --output <path>` | Output WAV path (default: `gitgroove.wav`) |
| `--limit <n>` | Use only the most recent n commits |
| `--path <pathspec>` | Only commits touching this path |
| `--bpm <n>` | Tempo in beats per minute (default: 200) |
| `--scale <name>` | `pentatonic-minor` (default), `pentatonic-major`, `major`, `minor`, `dorian`, `blues` |
| `--root <midi>` | Root MIDI note (default: 57 = A3) |
| `--no-drums` | Drop the bass drum / hi-hat track |
| `--play` | Play the WAV after writing (uses `afplay` / `aplay` / PowerShell) |
| `--no-color` | Disable ANSI colors |

## How the music is made

- One commit, one beat, in chronological order.
- Melody pitch is the commit's size (insertions + deletions), log-scaled and
  snapped to the chosen scale so any history still sounds musical. Bigger
  commits ring higher.
- Each author is hashed to a stable waveform (square / triangle / sawtooth /
  sine), so you can hear who is committing. With only four melodic timbres,
  busy repos will reuse them.
- A triangle bass alternates root and fifth, and (unless `--no-drums`) a noise
  hi-hat plays every beat with a sine kick every fourth beat.

## Programmatic API

```ts
import { readCommits, compose, renderTimeline, encodeWav } from "@printemps-tokyo/gitgroove";
import { writeFile } from "node:fs/promises";

const commits = await readCommits({ limit: 200 });
const song = compose(commits, { bpm: 240, drums: true });
const samples = renderTimeline(song.notes, song.durationSec, 44100);
await writeFile("out.wav", encodeWav(samples, 44100));
```

`compose`, the synthesis (`renderTimeline`, `sampleWave`, `envelope`), the scale
math, `encodeWav`, and `parseGitLog` are all pure functions.

## License

[MIT](./LICENSE) (c) printemps.tokyo
