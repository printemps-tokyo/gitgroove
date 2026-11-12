/**
 * Standard MIDI File writer (SMF format 1), so a groove can be opened in a
 * DAW or a notation program and played with real instruments. Pure: the
 * caller writes the bytes. Times are in beats; the file uses 480 ticks per
 * quarter note and sets the tempo in its first track.
 */

export interface MidiNote {
  /** Start, in beats from the beginning. */
  startBeat: number;
  /** Length, in beats. */
  durBeats: number;
  /** MIDI note number, 0-127. */
  midi: number;
  /** Velocity, 1-127. */
  velocity: number;
}

export interface MidiTrack {
  name: string;
  /** MIDI channel, 0-15 (9 is General MIDI percussion). */
  channel: number;
  /** General MIDI program, 0-127 (ignored on channel 9). */
  program?: number;
  notes: MidiNote[];
}

export const TICKS_PER_QUARTER = 480;

/** A MIDI variable-length quantity: 7 bits per byte, high bit = more follows. */
export function vlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new Error(`a MIDI variable-length quantity must be 0..0x0FFFFFFF (got ${value})`);
  }
  const bytes = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function chunk(type: string, body: number[]): number[] {
  return [...Array.from(type, (c) => c.charCodeAt(0)), ...u32(body.length), ...body];
}

function clamp7(n: number): number {
  return Math.max(0, Math.min(127, Math.round(n)));
}

/** One track's events, as MTrk body bytes. */
function trackBody(track: MidiTrack, tempoMicros?: number): number[] {
  const name = Array.from(Buffer.from(track.name, "utf8"));
  const out: number[] = [0x00, 0xff, 0x03, ...vlq(name.length), ...name];
  if (tempoMicros !== undefined) {
    out.push(0x00, 0xff, 0x51, 0x03, (tempoMicros >>> 16) & 0xff, (tempoMicros >>> 8) & 0xff, tempoMicros & 0xff);
  }
  const ch = track.channel & 0x0f;
  if (track.program !== undefined && ch !== 9) {
    out.push(0x00, 0xc0 | ch, clamp7(track.program));
  }
  // Note-offs sort before note-ons at the same tick, so a repeated note is
  // released before it sounds again.
  const events: { tick: number; on: boolean; midi: number; velocity: number }[] = [];
  for (const n of track.notes) {
    const start = Math.round(n.startBeat * TICKS_PER_QUARTER);
    const end = Math.max(start + 1, Math.round((n.startBeat + n.durBeats) * TICKS_PER_QUARTER));
    events.push({ tick: start, on: true, midi: clamp7(n.midi), velocity: Math.max(1, clamp7(n.velocity)) });
    events.push({ tick: end, on: false, midi: clamp7(n.midi), velocity: 0 });
  }
  events.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - last));
    last = e.tick;
    out.push(e.on ? 0x90 | ch : 0x80 | ch, e.midi, e.on ? e.velocity : 0x40);
  }
  out.push(0x00, 0xff, 0x2f, 0x00);
  return out;
}

/** A format-1 Standard MIDI File with `tracks`, at `bpm` quarter notes per minute. */
export function writeMidi(tracks: MidiTrack[], bpm: number): Uint8Array {
  if (tracks.length === 0) throw new Error("a MIDI file needs at least one track");
  if (!(bpm > 0)) throw new Error(`bpm must be positive (got ${bpm})`);
  const tempoMicros = Math.round(60_000_000 / bpm);
  const bytes = chunk("MThd", [...u16(1), ...u16(tracks.length), ...u16(TICKS_PER_QUARTER)]);
  tracks.forEach((t, i) => bytes.push(...chunk("MTrk", trackBody(t, i === 0 ? tempoMicros : undefined))));
  return Uint8Array.from(bytes);
}
