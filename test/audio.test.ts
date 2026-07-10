import { describe, expect, it } from "vitest";
import { midiToFreq, sampleWave, envelope, renderTimeline } from "../src/pcm.js";
import { encodeWav } from "../src/wav.js";
import { degreeToMidi, quantize, resolveScale } from "../src/scale.js";

describe("pcm", () => {
  it("maps MIDI to frequency (A4 = 440)", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
  });

  it("samples waveforms within [-1, 1]", () => {
    expect(sampleWave("square", 0.25)).toBe(1);
    expect(sampleWave("square", 0.75)).toBe(-1);
    expect(sampleWave("sawtooth", 0)).toBe(-1);
    expect(sampleWave("sine", 0.25)).toBeCloseTo(1, 6);
    for (const w of ["square", "triangle", "sawtooth", "sine", "noise"] as const) {
      for (let p = 0; p < 1; p += 0.1) {
        const v = sampleWave(w, p, 3);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("noise is deterministic for a given seed", () => {
    expect(sampleWave("noise", 0, 42)).toBe(sampleWave("noise", 0, 42));
  });

  it("envelope rises from 0 and returns toward 0 at the end", () => {
    expect(envelope(0, 1)).toBe(0);
    expect(envelope(0.5, 1)).toBeGreaterThan(0);
    expect(envelope(1, 1)).toBeLessThan(0.05);
    expect(envelope(2, 1)).toBe(0);
  });

  it("normalizes an overloaded mix to <= 1", () => {
    const notes = Array.from({ length: 8 }, () => ({ startSec: 0, durSec: 0.2, midi: 60, wave: "square" as const, gain: 1 }));
    const buf = renderTimeline(notes, 0.3, 8000);
    let peak = 0;
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0);
  });
});

describe("encodeWav", () => {
  it("writes a valid canonical PCM WAV header", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 44100);
    const view = new DataView(wav.buffer);
    const str = (o: number, n: number): string =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => wav[o + i]!));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(str(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(str(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(5 * 2); // 5 samples * 2 bytes
    expect(wav.length).toBe(44 + 10);
    // Full-scale samples map to the 16-bit extremes.
    expect(view.getInt16(44 + 3 * 2, true)).toBe(32767);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-32768);
  });
});

describe("scale", () => {
  it("resolves named scales and defaults safely", () => {
    expect(resolveScale("blues")).toEqual([0, 3, 5, 6, 7, 10]);
    expect(resolveScale("nonexistent")).toEqual([0, 3, 5, 7, 10]);
  });

  it("wraps degrees into higher octaves", () => {
    const scale = [0, 3, 5, 7, 10];
    expect(degreeToMidi(0, 60, scale)).toBe(60);
    expect(degreeToMidi(5, 60, scale)).toBe(72); // one octave up
    expect(degreeToMidi(6, 60, scale)).toBe(75);
  });

  it("quantizes normalized values to in-scale notes", () => {
    const scale = [0, 3, 5, 7, 10];
    const lo = quantize(0, 60, scale, 3);
    const hi = quantize(1, 60, scale, 3);
    expect(lo).toBe(60);
    expect(hi).toBeGreaterThan(lo);
    // Every quantized note is an in-scale degree relative to the root.
    for (let v = 0; v <= 1; v += 0.05) {
      const midi = quantize(v, 60, scale, 3);
      expect(scale.includes(((midi - 60) % 12 + 12) % 12)).toBe(true);
    }
  });
});
