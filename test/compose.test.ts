import { describe, expect, it } from "vitest";
import { compose, hashString, type Commit } from "../src/compose.js";
import { parseGitLog } from "../src/git.js";

function commit(email: string, insertions: number, i: number): Commit {
  return { hash: `h${i}`, author: email.split("@")[0]!, email, timestampSec: 1000 + i, filesChanged: 1, insertions, deletions: 0 };
}

const commits: Commit[] = [
  commit("alice@example.com", 5, 0),
  commit("bob@example.com", 120, 1),
  commit("alice@example.com", 1, 2),
  commit("carol@example.com", 40, 3),
];

describe("hashString", () => {
  it("is deterministic and unsigned", () => {
    expect(hashString("alice@example.com")).toBe(hashString("alice@example.com"));
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("x")).toBeGreaterThanOrEqual(0);
  });
});

describe("compose", () => {
  it("gives each author a stable waveform and counts commits", () => {
    const comp = compose(commits);
    const alice = comp.instruments.find((i) => i.email === "alice@example.com")!;
    expect(alice.commits).toBe(2);
    expect(comp.instruments).toHaveLength(3); // alice, bob, carol
    // Same author -> same timbre across the arrangement.
    const aliceWaves = new Set(
      comp.notes.filter((_, idx) => idx).map(() => alice.wave),
    );
    expect(aliceWaves.size).toBe(1);
  });

  it("is fully deterministic", () => {
    const a = compose(commits);
    const b = compose(commits);
    expect(a.notes).toEqual(b.notes);
    expect(a.durationSec).toBe(b.durationSec);
  });

  it("scales tempo: fewer BPM means a longer track", () => {
    const fast = compose(commits, { bpm: 240 });
    const slow = compose(commits, { bpm: 120 });
    expect(slow.durationSec).toBeGreaterThan(fast.durationSec);
    expect(slow.beatSec).toBeCloseTo(0.5, 6);
  });

  it("a larger commit gets a higher (or equal) melody note than a tiny one", () => {
    const comp = compose(commits, { drums: false });
    const melody = comp.notes.filter((n) => n.gain >= 0.5);
    // commit[1] (120 insertions) vs commit[2] (1 insertion)
    expect(melody[1]!.midi).toBeGreaterThanOrEqual(melody[2]!.midi);
  });

  it("omits the drum track when drums are off", () => {
    const withDrums = compose(commits, { drums: true }).notes.some((n) => n.wave === "noise");
    const without = compose(commits, { drums: false }).notes.some((n) => n.wave === "noise");
    expect(withDrums).toBe(true);
    expect(without).toBe(false);
  });
});

describe("parseGitLog", () => {
  const FIELD = "\x1f";
  const RECORD = "\x1e";
  const raw =
    RECORD +
    ["abc123", "Alice", "alice@example.com", "1700000000"].join(FIELD) +
    "\n10\t2\tsrc/a.ts\n5\t0\tsrc/b.ts\n" +
    RECORD +
    ["def456", "Bob", "bob@example.com", "1700000100"].join(FIELD) +
    "\n-\t-\timage.png\n";

  it("parses commits, sums numstat, and treats binary files as zero", () => {
    const parsed = parseGitLog(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ hash: "abc123", author: "Alice", insertions: 15, deletions: 2, filesChanged: 2 });
    expect(parsed[1]).toMatchObject({ hash: "def456", insertions: 0, deletions: 0, filesChanged: 1 });
  });
});
