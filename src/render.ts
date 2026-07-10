/** Text summary and an ANSI melody sparkline for the composed track. Pure. */
import type { Composition } from "./compose.js";
import type { Note } from "./pcm.js";

const SPARK = "▁▂▃▄▅▆▇█";

const WAVE_GLYPH: Record<string, string> = {
  square: "square ⊓",
  triangle: "triangle △",
  sawtooth: "sawtooth ◺",
  sine: "sine ∿",
  noise: "noise ▓",
};

function paint(text: string, code: string, color: boolean): string {
  return color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** A single-line sparkline of the melody pitch contour. */
export function melodySparkline(notes: Note[], width = 60): string {
  const melody = notes.filter((n) => n.wave !== "noise" && n.gain >= 0.5).map((n) => n.midi);
  if (melody.length === 0) return "";
  const lo = Math.min(...melody);
  const hi = Math.max(...melody);
  const span = Math.max(1, hi - lo);
  const step = Math.max(1, Math.ceil(melody.length / width));
  let out = "";
  for (let i = 0; i < melody.length; i += step) {
    const level = Math.round(((melody[i]! - lo) / span) * (SPARK.length - 1));
    out += SPARK[level];
  }
  return out;
}

/** Render a human-readable summary of the composition. */
export function renderSummary(comp: Composition, commitCount: number, outPath: string, color: boolean): string {
  const lines: string[] = [];
  const bpm = Math.round(60 / comp.beatSec);
  lines.push(
    `${paint("gitgroove", "1", color)}  ${commitCount} commits -> ${comp.durationSec.toFixed(1)}s @ ${bpm} BPM`,
  );
  lines.push("");
  lines.push(paint("Instruments (by author)", "36", color));
  const ranked = [...comp.instruments].sort((a, b) => b.commits - a.commits);
  for (const inst of ranked) {
    const glyph = WAVE_GLYPH[inst.wave] ?? inst.wave;
    lines.push(`  ${paint(glyph.padEnd(12), "32", color)} ${inst.author}  (${inst.commits})`);
  }
  lines.push("");
  const spark = melodySparkline(comp.notes);
  if (spark) {
    lines.push(paint("Melody", "36", color));
    lines.push(`  ${spark}`);
    lines.push("");
  }
  lines.push(`${paint("Wrote", "36", color)} ${outPath}`);
  return `${lines.join("\n")}\n`;
}
