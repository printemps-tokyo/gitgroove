import { describe, expect, it } from "vitest";
import { parseIntegerFlag, parseNumberFlag } from "../src/options.js";
import { resolveScale } from "../src/scale.js";
import { compose, type Commit } from "../src/compose.js";
import { renderTimeline } from "../src/pcm.js";
import { encodeWav } from "../src/wav.js";

// The exact specs the CLI uses for --limit, --bpm, and --root.
const limit = (raw: string): number => parseIntegerFlag("limit", raw, 1);
const bpm = (raw: string): number => parseNumberFlag("bpm", raw, 20, 400);
const root = (raw: string): number => parseIntegerFlag("root", raw, 0, 127);

describe("parseIntegerFlag (--limit)", () => {
  it("accepts positive integers", () => {
    expect(limit("1")).toBe(1);
    expect(limit("200")).toBe(200);
  });

  it("rejects garbage, blanks, zero, negatives, and fractions", () => {
    for (const raw of ["abc", "", "  ", "NaN", "0", "-3", "1.5"]) {
      expect(() => limit(raw)).toThrow(/--limit must be an integer >= 1/);
    }
    expect(() => limit("abc")).toThrow(/got "abc"/);
  });
});

describe("parseNumberFlag (--bpm)", () => {
  it("accepts numbers in range, including fractions", () => {
    expect(bpm("200")).toBe(200);
    expect(bpm("20")).toBe(20);
    expect(bpm("400")).toBe(400);
    expect(bpm("132.5")).toBeCloseTo(132.5, 6);
  });

  it("rejects garbage and out-of-range values", () => {
    for (const raw of ["abc", "", "NaN", "Infinity", "19", "401", "-200"]) {
      expect(() => bpm(raw)).toThrow(/--bpm must be a number between 20 and 400/);
    }
  });
});

describe("parseIntegerFlag (--root)", () => {
  it("accepts the full MIDI range 0-127", () => {
    expect(root("0")).toBe(0);
    expect(root("57")).toBe(57);
    expect(root("127")).toBe(127);
  });

  it("rejects garbage and out-of-range values", () => {
    for (const raw of ["abc", "", "-1", "128", "60.5"]) {
      expect(() => root(raw)).toThrow(/--root must be an integer between 0 and 127/);
    }
  });
});

describe("validated flags end-to-end", () => {
  it("drives the full compose -> render -> encode pipeline", () => {
    const commits: Commit[] = [
      { hash: "a1", author: "alice", email: "alice@example.com", timestampSec: 1, filesChanged: 1, insertions: 5, deletions: 0 },
      { hash: "b2", author: "bob", email: "bob@example.com", timestampSec: 2, filesChanged: 2, insertions: 40, deletions: 3 },
    ];
    const composition = compose(commits, {
      bpm: bpm("240"),
      scale: resolveScale("blues"),
      rootMidi: root("57"),
      drums: true,
    });
    const samples = renderTimeline(composition.notes, composition.durationSec, 8000);
    const wav = encodeWav(samples, 8000);
    const magic = String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!);
    expect(magic).toBe("RIFF");
    expect(composition.beatSec).toBeCloseTo(60 / 240, 6);
    expect(wav.length).toBeGreaterThan(44);
  });
});
