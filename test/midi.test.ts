import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compose, readBranchCommits, toMidiTracks, vlq, writeMidi, type Commit } from "../src/index.js";

describe("vlq", () => {
  it("matches the examples in the MIDI 1.0 file specification", () => {
    const cases: [number, number[]][] = [
      [0x00, [0x00]],
      [0x40, [0x40]],
      [0x7f, [0x7f]],
      [0x80, [0x81, 0x00]],
      [0x2000, [0xc0, 0x00]],
      [0x3fff, [0xff, 0x7f]],
      [0x4000, [0x81, 0x80, 0x00]],
      [0x100000, [0xc0, 0x80, 0x00]],
      [0x1fffff, [0xff, 0xff, 0x7f]],
      [0x200000, [0x81, 0x80, 0x80, 0x00]],
      [0x8000000, [0xc0, 0x80, 0x80, 0x00]],
      [0xfffffff, [0xff, 0xff, 0xff, 0x7f]],
    ];
    for (const [n, bytes] of cases) expect(vlq(n), n.toString(16)).toEqual(bytes);
    expect(() => vlq(0x10000000)).toThrow();
  });
});

/** A small independent reader for the files writeMidi makes. */
function readMidi(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  expect(b.toString("latin1", 0, 4)).toBe("MThd");
  const format = b.readUInt16BE(8);
  const ntracks = b.readUInt16BE(10);
  const division = b.readUInt16BE(12);
  let at = 14;
  const tracks: { name: string; tempo?: number; program?: number; notes: { tick: number; ch: number; key: number; vel: number; off: number }[] }[] = [];
  for (let t = 0; t < ntracks; t++) {
    expect(b.toString("latin1", at, at + 4)).toBe("MTrk");
    const end = at + 8 + b.readUInt32BE(at + 4);
    let p = at + 8;
    let tick = 0;
    const open = new Map<string, { tick: number; ch: number; key: number; vel: number; off: number }>();
    const track: (typeof tracks)[number] = { name: "", notes: [] };
    const readVlq = (): number => {
      let v = 0;
      for (;;) {
        const c = b[p++] as number;
        v = (v << 7) | (c & 0x7f);
        if (!(c & 0x80)) return v;
      }
    };
    while (p < end) {
      tick += readVlq();
      const status = b[p++] as number;
      if (status === 0xff) {
        const type = b[p++] as number;
        const len = readVlq();
        if (type === 0x03) track.name = b.toString("utf8", p, p + len);
        if (type === 0x51) track.tempo = (b[p]! << 16) | (b[p + 1]! << 8) | b[p + 2]!;
        p += len;
      } else if ((status & 0xf0) === 0xc0) {
        track.program = b[p++];
      } else {
        const ch = status & 0x0f;
        const key = b[p++] as number;
        const vel = b[p++] as number;
        if ((status & 0xf0) === 0x90) open.set(`${ch}:${key}`, { tick, ch, key, vel, off: -1 });
        else {
          const n = open.get(`${ch}:${key}`)!;
          n.off = tick;
          track.notes.push(n);
          open.delete(`${ch}:${key}`);
        }
      }
    }
    expect(open.size).toBe(0);
    tracks.push(track);
    at = end;
  }
  return { format, division, tracks };
}

const commits: Commit[] = [
  { hash: "a", author: "Ann", email: "ann@x", timestampSec: 1, filesChanged: 1, insertions: 10, deletions: 0 },
  { hash: "b", author: "Bob", email: "bob@x", timestampSec: 2, filesChanged: 1, insertions: 1, deletions: 1 },
  { hash: "c", author: "Ann", email: "ann@x", timestampSec: 3, filesChanged: 2, insertions: 50, deletions: 5 },
];

describe("writeMidi + toMidiTracks", () => {
  it("writes one track per author, then bass and drums, at the tempo", () => {
    const comp = compose(commits, { bpm: 120 });
    const file = readMidi(writeMidi(toMidiTracks(comp), 120));
    expect(file.format).toBe(1);
    expect(file.division).toBe(480);
    expect(file.tracks.map((t) => t.name)).toEqual(["Ann <ann@x>", "Bob <bob@x>", "Bass", "Drums"]);
    expect(file.tracks[0]!.tempo).toBe(500_000);
    // Ann's commits are beats 0 and 2: ticks 0 and 960.
    expect(file.tracks[0]!.notes.map((n) => n.tick)).toEqual([0, 960]);
    expect(file.tracks[2]!.program).toBe(38);
    const drums = file.tracks[3]!;
    expect(new Set(drums.notes.map((n) => n.ch))).toEqual(new Set([9]));
    expect(drums.notes.filter((n) => n.key === 36).map((n) => n.tick)).toEqual([0]);
    expect(drums.notes.filter((n) => n.key === 42)).toHaveLength(3);
  });

  it("lets a repeated note end before it starts again", () => {
    const tracks = [
      { name: "t", channel: 0, notes: [{ startBeat: 0, durBeats: 1, midi: 60, velocity: 100 }, { startBeat: 1, durBeats: 1, midi: 60, velocity: 100 }] },
    ];
    const notes = readMidi(writeMidi(tracks, 100)).tracks[0]!.notes;
    expect(notes.map((n) => [n.tick, n.off])).toEqual([
      [0, 480],
      [480, 960],
    ]);
  });
});

describe("readBranchCommits", () => {
  it("gives each branch the commits it adds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gitgroove-branches-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" },
      });
    try {
      git("init", "-q", "-b", "main");
      let n = 0;
      const commit = (msg: string) => {
        writeFileSync(join(dir, "f.txt"), `${msg}\n`);
        git("add", ".");
        n++;
        git("commit", "-q", "-m", msg, "--date", `2026-01-0${n}T00:00:00Z`);
        git("commit", "-q", "--amend", "--no-edit", "--date", `2026-01-0${n}T00:00:00Z`);
      };
      commit("one");
      commit("two");
      git("checkout", "-q", "-b", "feature");
      commit("three");
      git("checkout", "-q", "main");
      commit("four");
      const list = await readBranchCommits({ cwd: dir });
      expect(list.map((c) => c.branch)).toEqual(["main", "main", "feature", "main"]);
      const other = await readBranchCommits({ cwd: dir, branches: ["feature", "main"] });
      expect(other.map((c) => c.branch)).toEqual(["feature", "feature", "feature", "main"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
