#!/usr/bin/env node
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { readCommits } from "./git.js";
import { compose } from "./compose.js";
import { renderTimeline } from "./pcm.js";
import { encodeWav } from "./wav.js";
import { resolveScale, SCALES } from "./scale.js";
import { renderSummary } from "./render.js";
import { playWav } from "./play.js";

const SAMPLE_RATE = 44100;

const HELP = `gitgroove - turn a git repository's history into a chiptune WAV

Usage:
  gitgroove [options]                Sonify the current repo -> gitgroove.wav
  gitgroove --repo <path> -o out.wav

Each commit becomes a beat: the melody pitch follows how much the commit
changed, every author gets their own waveform, and a bass and drum track keep
time. The result is deterministic - the same history always sounds the same.

Options:
  --repo <path>       Repository to read (default: current directory)
  -o, --output <path> Output WAV path (default: gitgroove.wav)
  --limit <n>         Use only the most recent n commits
  --path <pathspec>   Only commits touching this path
  --bpm <n>           Tempo in beats per minute (default: 200)
  --scale <name>      ${Object.keys(SCALES).join(", ")} (default: pentatonic-minor)
  --root <midi>       Root MIDI note (default: 57 = A3)
  --no-drums          Drop the bass drum / hi-hat track
  --play              Play the WAV after writing it
  --no-color          Disable ANSI colors
  -h, --help          Show this help
  -v, --version       Show version

Examples:
  gitgroove
  gitgroove --limit 200 --bpm 240 --scale blues --play
  gitgroove --repo ../other-project -o song.wav
`;

async function readVersion(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = await readFile(join(here, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write((await readVersion()) + "\n");
    return 0;
  }

  let values;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        repo: { type: "string" },
        output: { type: "string", short: "o" },
        limit: { type: "string" },
        path: { type: "string" },
        bpm: { type: "string" },
        scale: { type: "string" },
        root: { type: "string" },
        "no-drums": { type: "boolean", default: false },
        play: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
      },
    }).values;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  const output = values.output ?? "gitgroove.wav";

  let commits;
  try {
    commits = await readCommits({
      cwd: values.repo,
      limit: values.limit ? Number(values.limit) : undefined,
      path: values.path,
    });
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  if (commits.length === 0) {
    process.stderr.write("error: no commits found to sonify\n");
    return 1;
  }

  const composition = compose(commits, {
    bpm: values.bpm ? Number(values.bpm) : undefined,
    scale: values.scale ? resolveScale(values.scale) : undefined,
    rootMidi: values.root ? Number(values.root) : undefined,
    drums: !values["no-drums"],
  });

  const samples = renderTimeline(composition.notes, composition.durationSec, SAMPLE_RATE);
  const wav = encodeWav(samples, SAMPLE_RATE);
  try {
    await writeFile(output, wav);
  } catch (err) {
    process.stderr.write(`error: could not write ${output}: ${(err as Error).message}\n`);
    return 1;
  }

  const color = !values["no-color"] && !process.env.NO_COLOR && process.stdout.isTTY === true;
  process.stdout.write(renderSummary(composition, commits.length, output, color));

  if (values.play) {
    try {
      await playWav(output);
    } catch (err) {
      process.stderr.write(`note: ${(err as Error).message}\n`);
    }
  }

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
