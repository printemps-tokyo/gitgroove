/**
 * Pure PCM synthesis: chiptune waveforms, an ADSR envelope, and a renderer that
 * mixes timed notes into a mono float buffer. Everything is deterministic, so
 * the same history always produces the same audio.
 */

export type Waveform = "square" | "triangle" | "sawtooth" | "sine" | "noise";

export const WAVEFORMS: Waveform[] = ["square", "triangle", "sawtooth", "sine", "noise"];

/** Convert a MIDI note number to its frequency in Hz (A4 = 69 = 440Hz). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Sample a waveform at a phase in [0, 1). `noise` is a cheap deterministic
 * pseudo-random value derived from the sample index passed as the phase seed.
 */
export function sampleWave(wave: Waveform, phase: number, seed = 0): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case "square":
      return p < 0.5 ? 1 : -1;
    case "sawtooth":
      return 2 * p - 1;
    case "triangle":
      return 1 - 4 * Math.abs(Math.round(p) - p);
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "noise": {
      // Deterministic hash noise (no Math.random, so runs are reproducible).
      const n = Math.sin((seed + 1) * 12.9898) * 43758.5453;
      return 2 * (n - Math.floor(n)) - 1;
    }
  }
}

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number; // level in [0, 1]
  release: number;
}

export const DEFAULT_ADSR: Adsr = { attack: 0.005, decay: 0.04, sustain: 0.7, release: 0.06 };

/** Envelope gain at time `t` seconds into a note of length `dur` seconds. */
export function envelope(t: number, dur: number, env: Adsr = DEFAULT_ADSR): number {
  if (t < 0 || t > dur) return 0;
  const releaseStart = Math.max(0, dur - env.release);
  if (t < env.attack) return env.attack === 0 ? 1 : t / env.attack;
  if (t < env.attack + env.decay) {
    const d = (t - env.attack) / env.decay;
    return 1 - d * (1 - env.sustain);
  }
  if (t < releaseStart) return env.sustain;
  const r = (t - releaseStart) / Math.max(1e-6, dur - releaseStart);
  return env.sustain * (1 - r);
}

/** A single note to be rendered onto the timeline. */
export interface Note {
  startSec: number;
  durSec: number;
  midi: number;
  wave: Waveform;
  gain: number;
  /** Which part of the arrangement plays it (for MIDI tracks). */
  part?: "melody" | "bass" | "drums";
  /** The melody voice: an author's e-mail or a branch name. */
  voice?: string;
}

/** Render one note additively onto a float buffer (mutates `buffer`). */
export function renderNote(buffer: Float32Array, note: Note, sampleRate: number, env: Adsr = DEFAULT_ADSR): void {
  const freq = midiToFreq(note.midi);
  const start = Math.floor(note.startSec * sampleRate);
  const length = Math.floor(note.durSec * sampleRate);
  for (let i = 0; i < length; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= buffer.length) continue;
    const t = i / sampleRate;
    const phase = (freq * t) % 1;
    const g = envelope(t, note.durSec, env) * note.gain;
    buffer[idx]! += sampleWave(note.wave, phase, idx) * g;
  }
}

/**
 * Render all notes into a mono float buffer of `totalSec`, then peak-normalize
 * to avoid clipping when many notes overlap.
 */
export function renderTimeline(notes: Note[], totalSec: number, sampleRate: number, env: Adsr = DEFAULT_ADSR): Float32Array {
  const buffer = new Float32Array(Math.max(1, Math.ceil(totalSec * sampleRate)));
  for (const note of notes) renderNote(buffer, note, sampleRate, env);

  let peak = 0;
  for (const s of buffer) peak = Math.max(peak, Math.abs(s));
  if (peak > 1) {
    const scale = 0.98 / peak;
    for (let i = 0; i < buffer.length; i++) buffer[i]! *= scale;
  }
  return buffer;
}
