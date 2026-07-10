/**
 * Turn a commit history into a chiptune arrangement. Deterministic and pure:
 * the melody pitch tracks each commit's size, each author gets a stable timbre,
 * and an optional bass and drum track give the whole thing groove.
 */
import { type Note, type Waveform } from "./pcm.js";
import { degreeToMidi, quantize } from "./scale.js";

/** One commit, reduced to what the music needs. */
export interface Commit {
  hash: string;
  author: string;
  email: string;
  timestampSec: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ComposeOptions {
  bpm?: number;
  scale?: number[];
  rootMidi?: number;
  octaves?: number;
  drums?: boolean;
}

export interface Instrument {
  author: string;
  email: string;
  wave: Waveform;
  commits: number;
}

export interface Composition {
  notes: Note[];
  durationSec: number;
  instruments: Instrument[];
  beatSec: number;
}

// Melody waveforms, one per author (noise is reserved for percussion).
const MELODY_WAVES: Waveform[] = ["square", "triangle", "sawtooth", "sine"];

/** FNV-1a 32-bit hash, so an author always maps to the same instrument. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function authorWave(email: string): Waveform {
  return MELODY_WAVES[hashString(email.toLowerCase()) % MELODY_WAVES.length]!;
}

/** Compose the full arrangement from a chronological list of commits. */
export function compose(commits: Commit[], opts: ComposeOptions = {}): Composition {
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : 200;
  const beatSec = 60 / bpm;
  const scale = opts.scale ?? [0, 3, 5, 7, 10];
  const rootMidi = opts.rootMidi ?? 57; // A3
  const octaves = opts.octaves ?? 3;
  const drums = opts.drums ?? true;

  const maxChanges = Math.max(1, ...commits.map((c) => c.insertions + c.deletions));
  const logMax = Math.log(1 + maxChanges);

  const notes: Note[] = [];
  commits.forEach((commit, i) => {
    const start = i * beatSec;
    const changes = commit.insertions + commit.deletions;
    const pitchValue = logMax > 0 ? Math.log(1 + changes) / logMax : 0;

    // Melody: pitch from commit size, timbre from the author.
    notes.push({
      startSec: start,
      durSec: beatSec * 0.9,
      midi: quantize(pitchValue, rootMidi + 12, scale, octaves),
      wave: authorWave(commit.email),
      gain: 0.5,
    });

    // Bass: alternate root and fifth for a walking feel.
    notes.push({
      startSec: start,
      durSec: beatSec * 0.95,
      midi: degreeToMidi(i % 2 === 0 ? 0 : Math.min(3, scale.length - 1), rootMidi - 12, scale),
      wave: "triangle",
      gain: 0.42,
    });

    if (drums) {
      // Hi-hat on every beat.
      notes.push({ startSec: start, durSec: 0.05, midi: 60, wave: "noise", gain: 0.14 });
      // Kick every fourth beat.
      if (i % 4 === 0) notes.push({ startSec: start, durSec: 0.09, midi: 36, wave: "sine", gain: 0.6 });
    }
  });

  // Group authors for the display, preserving first-seen order.
  const byAuthor = new Map<string, Instrument>();
  for (const c of commits) {
    const key = c.email.toLowerCase();
    const existing = byAuthor.get(key);
    if (existing) existing.commits += 1;
    else byAuthor.set(key, { author: c.author, email: c.email, wave: authorWave(c.email), commits: 1 });
  }

  const durationSec = commits.length * beatSec + beatSec;
  return { notes, durationSec, instruments: [...byAuthor.values()], beatSec };
}
