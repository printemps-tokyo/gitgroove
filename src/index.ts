/**
 * Public API for gitgroove.
 *
 * gitgroove turns a git repository's commit history into a chiptune WAV: the
 * melody pitch tracks each commit's size, each author gets a stable timbre, and
 * a bass and drum track add groove. Synthesis (waveforms, envelope, WAV
 * encoding), the scale math, and the composer are pure functions; only reading
 * `git log`, writing the file, and optional playback touch the outside world.
 */

export { midiToFreq, sampleWave, envelope, renderNote, renderTimeline, WAVEFORMS, DEFAULT_ADSR } from "./pcm.js";
export type { Waveform, Note, Adsr } from "./pcm.js";

export { encodeWav } from "./wav.js";
export { SCALES, degreeToMidi, quantize, resolveScale } from "./scale.js";
export type { ScaleName } from "./scale.js";

export { compose, hashString } from "./compose.js";
export type { Commit, Composition, ComposeOptions, Instrument } from "./compose.js";

export { parseGitLog, readCommits } from "./git.js";
export type { GitLogOptions } from "./git.js";

export { renderSummary, melodySparkline } from "./render.js";
export { playWav, playerCommand } from "./play.js";
export { writeMidi, vlq, TICKS_PER_QUARTER, type MidiNote, type MidiTrack } from "./midi.js";
export { toMidiTracks } from "./compose.js";
export { readBranchCommits } from "./git.js";
