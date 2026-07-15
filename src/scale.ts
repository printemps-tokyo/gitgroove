/** Musical scales and value-to-note quantization. Pure. */

/** Semitone offsets from the root for a few pleasant scales. */
export const SCALES: Record<string, number[]> = {
  "pentatonic-minor": [0, 3, 5, 7, 10],
  "pentatonic-major": [0, 2, 4, 7, 9],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export type ScaleName = keyof typeof SCALES | string;

/**
 * Map a scale degree (0-based, can exceed the scale length to wrap into higher
 * octaves) to a MIDI note relative to `rootMidi`.
 */
export function degreeToMidi(degree: number, rootMidi: number, scale: number[]): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const step = ((degree % n) + n) % n;
  return rootMidi + octave * 12 + scale[step]!;
}

/**
 * Quantize a normalized value in [0, 1] to a MIDI note within `octaves` octaves
 * of the scale starting at `rootMidi`. Values snap to in-scale degrees so any
 * input still sounds musical.
 */
export function quantize(value: number, rootMidi: number, scale: number[], octaves: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const totalDegrees = scale.length * octaves;
  const degree = Math.min(totalDegrees - 1, Math.floor(clamped * totalDegrees));
  return degreeToMidi(degree, rootMidi, scale);
}

/** Resolve a scale name to its offsets. Throws for unknown names. */
export function resolveScale(name: ScaleName): number[] {
  const scale = SCALES[name];
  if (!scale) {
    throw new Error(`unknown scale "${name}"; valid scales: ${Object.keys(SCALES).join(", ")}`);
  }
  return scale;
}
