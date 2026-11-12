/** Read commits from a git repository via `git log` (the only IO besides file writes). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Commit } from "./compose.js";

const pexecFile = promisify(execFile);

// Separators unlikely to appear in author names or emails. The record
// separator LEADS each commit so a commit's numstat block stays attached to its
// own header (a trailing separator would group it with the next commit).
const FIELD = "\x1f";
const RECORD = "\x1e";
const FORMAT = RECORD + ["%H", "%an", "%ae", "%at"].join(FIELD);

export interface GitLogOptions {
  cwd?: string;
  /** Keep at most this many of the most recent commits (chronological order preserved). */
  limit?: number;
  /** Restrict to commits touching this pathspec. */
  path?: string;
}

/** Parse the raw `git log --numstat` output into structured commits (pure). */
export function parseGitLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of raw.split(RECORD)) {
    const trimmed = record.replace(/^\n+/, "");
    if (trimmed.trim() === "") continue;
    const nl = trimmed.indexOf("\n");
    const headerLine = nl === -1 ? trimmed : trimmed.slice(0, nl);
    const statBlock = nl === -1 ? "" : trimmed.slice(nl + 1);
    const [hash, author, email, at] = headerLine.split(FIELD);
    if (!hash) continue;

    let insertions = 0;
    let deletions = 0;
    let filesChanged = 0;
    for (const line of statBlock.split("\n")) {
      if (line.trim() === "") continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      filesChanged += 1;
      // Binary files show "-" for counts.
      insertions += parts[0] === "-" ? 0 : Number(parts[0]) || 0;
      deletions += parts[1] === "-" ? 0 : Number(parts[1]) || 0;
    }

    commits.push({
      hash,
      author: author ?? "unknown",
      email: email ?? "unknown",
      timestampSec: Number(at) || 0,
      filesChanged,
      insertions,
      deletions,
    });
  }
  return commits;
}

/** Run `git log` and return commits in chronological (oldest-first) order. */
export async function readCommits(opts: GitLogOptions = {}): Promise<Commit[]> {
  const args = ["log", `--pretty=format:${FORMAT}`, "--numstat", "--no-color"];
  if (opts.limit && opts.limit > 0) args.push(`-n${opts.limit}`);
  if (opts.path) args.push("--", opts.path);

  let stdout: string;
  try {
    const res = await pexecFile("git", args, { cwd: opts.cwd, maxBuffer: 256 * 1024 * 1024 });
    stdout = res.stdout;
  } catch (err) {
    const message = (err as { stderr?: string; message?: string }).stderr || (err as Error).message;
    if (/not a git repository/i.test(message)) {
      throw new Error("not a git repository (run gitgroove inside a repo, or pass --repo <path>)", { cause: err });
    }
    throw new Error(`git log failed: ${message.trim()}`, { cause: err });
  }

  // git log is newest-first; reverse to play history forwards.
  return parseGitLog(stdout).reverse();
}
