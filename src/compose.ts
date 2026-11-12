/**
 * Turn a commit history into a chiptune arrangement. Deterministic and pure:
 * the melody pitch tracks each commit's size, each author gets a stable timbre,
 * and an optional bass and drum track give the whole thing groove.
 */
import { type Note, type Waveform } from "./pcm.js";
import { degreeToMidi, quantize } from "./scale.js";
import type { MidiTrack } from "./midi.js";

/** One commit, reduced to what the music needs. */
export interface Commit {
  hash: string;
  author: string;
  email: string;
  timestampSec: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  /** The branch that added the commit, when reading several branches. */
  branch?: string;
}

export interface ComposeOptions {
  bpm?: number;
  scale?: number[];
  rootMidi?: number;
  octaves?: number;
  drums?: boolean;
  /** Give each author (default) or each branch its own melody voice. */
  voiceBy?: "author" | "branch";
}

export interface Instrument {
  /** The author's name, or the branch name when voicing by branch. */
  author: string;
  /** The author's e-mail, or the branch name when voicing by branch. */
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
  const byBranch = opts.voiceBy === "branch";
  const voiceOf = (c: Commit): string => (byBranch ? (c.branch ?? "(none)") : c.email.toLowerCase());

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
      wave: authorWave(voiceOf(commit)),
      gain: 0.5,
      part: "melody",
      voice: voiceOf(commit),
    });

    // Bass: alternate root and fifth for a walking feel.
    notes.push({
      startSec: start,
      durSec: beatSec * 0.95,
      midi: degreeToMidi(i % 2 === 0 ? 0 : Math.min(3, scale.length - 1), rootMidi - 12, scale),
      wave: "triangle",
      gain: 0.42,
      part: "bass",
    });

    if (drums) {
      // Hi-hat on every beat.
      notes.push({ startSec: start, durSec: 0.05, midi: 60, wave: "noise", gain: 0.14, part: "drums" });
      // Kick every fourth beat.
      if (i % 4 === 0) notes.push({ startSec: start, durSec: 0.09, midi: 36, wave: "sine", gain: 0.6, part: "drums" });
    }
  });

  // Group authors for the display, preserving first-seen order.
  const byAuthor = new Map<string, Instrument>();
  for (const c of commits) {
    const key = voiceOf(c);
    const existing = byAuthor.get(key);
    if (existing) existing.commits += 1;
    else if (byBranch) byAuthor.set(key, { author: key, email: key, wave: authorWave(key), commits: 1 });
    else byAuthor.set(key, { author: c.author, email: c.email, wave: authorWave(key), commits: 1 });
  }

  const durationSec = commits.length * beatSec + beatSec;
  return { notes, durationSec, instruments: [...byAuthor.values()], beatSec };
}

/** General MIDI programs (0-based) for the chiptune waveforms. */
const GM_PROGRAM: Record<string, number> = {
  square: 80, // Lead 1 (square)
  sawtooth: 81, // Lead 2 (sawtooth)
  triangle: 82, // Lead 3 (calliope)
  sine: 83, // Lead 4 (chiff)
};

/**
 * The arrangement as MIDI tracks: one per melody voice (author or branch),
 * then the bass (Synth Bass 1) and the drums on channel 10 (General MIDI
 * kick and closed hi-hat). Voices past the 15 melodic channels share them.
 */
export function toMidiTracks(comp: Composition): MidiTrack[] {
  const beat = (sec: number): number => sec / comp.beatSec;
  const velocity = (gain: number): number => Math.round(Math.min(1, gain * 1.6) * 127);
  const channels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  const tracks: MidiTrack[] = [];
  const melody = new Map<string, MidiTrack>();
  let next = 0;
  for (const n of comp.notes) {
    if (n.part !== "melody") continue;
    const voice = n.voice ?? "melody";
    let t = melody.get(voice);
    if (!t) {
      const inst = comp.instruments.find((i) => i.email.toLowerCase() === voice || i.email === voice);
      const name = inst ? (inst.author === inst.email ? inst.author : `${inst.author} <${inst.email}>`) : voice;
      t = { name, channel: channels[next % (channels.length - 1)] as number, program: GM_PROGRAM[n.wave] ?? 80, notes: [] };
      next++;
      melody.set(voice, t);
      tracks.push(t);
    }
    t.notes.push({ startBeat: beat(n.startSec), durBeats: beat(n.durSec), midi: n.midi, velocity: velocity(n.gain) });
  }
  const bassChannel = channels[channels.length - 1] as number;
  const bass: MidiTrack = { name: "Bass", channel: bassChannel, program: 38, notes: [] };
  const drums: MidiTrack = { name: "Drums", channel: 9, notes: [] };
  for (const n of comp.notes) {
    if (n.part === "bass") {
      bass.notes.push({ startBeat: beat(n.startSec), durBeats: beat(n.durSec), midi: n.midi, velocity: velocity(n.gain) });
    } else if (n.part === "drums") {
      const key = n.wave === "noise" ? 42 : 36; // closed hi-hat, bass drum 1
      drums.notes.push({ startBeat: beat(n.startSec), durBeats: beat(n.durSec), midi: key, velocity: velocity(n.gain) });
    }
  }
  if (bass.notes.length > 0) tracks.push(bass);
  if (drums.notes.length > 0) tracks.push(drums);
  return tracks;
}
