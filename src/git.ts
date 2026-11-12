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

/**
 * Commits of several branches, oldest first, each tagged with the branch
 * that adds it: the first branch gets its whole history, every later one
 * only the commits the branches before it do not have (`git log b ^a ...`). Without `branches`, the current branch comes first, then the
 * other local branches by name.
 */
export async function readBranchCommits(opts: GitLogOptions & { branches?: string[] } = {}): Promise<Commit[]> {
  const git = async (args: string[]): Promise<string> => {
    try {
      return (await pexecFile("git", args, { cwd: opts.cwd, maxBuffer: 256 * 1024 * 1024 })).stdout;
    } catch (err) {
      const message = (err as { stderr?: string; message?: string }).stderr || (err as Error).message;
      if (/not a git repository/i.test(message)) {
        throw new Error("not a git repository (run gitgroove inside a repo, or pass --repo <path>)", { cause: err });
      }
      throw new Error(`git failed: ${message.trim()}`, { cause: err });
    }
  };
  let branches = opts.branches;
  if (!branches || branches.length === 0) {
    const all = (await git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]))
      .split("\n")
      .filter((b) => b !== "")
      .sort();
    const current = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    branches = all.includes(current) ? [current, ...all.filter((b) => b !== current)] : all;
  }
  if (branches.length === 0) throw new Error("the repository has no branches");
  const out: Commit[] = [];
  for (const [i, branch] of branches.entries()) {
    // After --end-of-options every argument is a revision; ^b excludes b.
    const args = ["log", `--pretty=format:${FORMAT}`, "--numstat", "--no-color", "--end-of-options", branch];
    args.push(...branches.slice(0, i).map((b) => `^${b}`));
    if (opts.path) args.push("--", opts.path);
    for (const c of parseGitLog(await git(args))) out.push({ ...c, branch });
  }
  // Oldest first; a stable sort keeps each branch's own order on ties.
  out.reverse();
  out.sort((a, b) => a.timestampSec - b.timestampSec);
  return opts.limit && opts.limit > 0 ? out.slice(-opts.limit) : out;
}
