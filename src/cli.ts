/**
 * CLI command handlers and argument parsing.
 *
 * Parses raw `process.argv` slices and dispatches to the appropriate
 * subcommand handler (`ensure`, `promote`, `observe`, `status`).
 */

import { join, basename } from "node:path";
import { readlink } from "node:fs/promises";
import { THRESHOLD, STALE_SECONDS, REPOS_DIR } from "./config.ts";
import type { Candidate } from "./types.ts";
import { err, nowEpoch, nowIso, usage } from "./util.ts";
import { resolveRepo } from "./git.ts";
import { loadCandidate, saveCandidate, clearCandidate } from "./state.ts";
import { ensureRepo, scoreForCommand } from "./repo.ts";

/** `atlas ensure [--repo PATH]` — ensure the repo is atlas-ready. */
export async function cmdEnsure(args: string[]): Promise<void> {
  const base = getRepoArg(args) ?? process.cwd();
  await ensureRepo(base);
}

/** `atlas promote [--repo PATH]` — force-promote a repo and clear its candidate state. */
export async function cmdPromote(args: string[]): Promise<void> {
  const base = getRepoArg(args) ?? process.cwd();
  const result = await ensureRepo(base);
  if (!result) return;
  await clearCandidate(result.repo.repoId);
  const projectName = basename(result.repo.repoRoot);
  console.log(result.changed ? `Atlas linked: ${result.repo.repoRoot}/${projectName}` : "Atlas already linked.");
}

/**
 * `atlas observe --cmd "..." --exit 0 [--repo PATH]`
 *
 * Called from shell hooks (e.g. preexec). If the command exited 0 and
 * scores above 0, we increment (or reset) the repo's candidate score.
 * When the score crosses `THRESHOLD`, the repo is auto-promoted.
 */
export async function cmdObserve(args: string[]): Promise<void> {
  const cmd = getArgValue(args, "--cmd");
  const exitCode = getArgValue(args, "--exit");
  const base = getArgValue(args, "--repo") ?? process.cwd();

  if (!cmd) return;
  if (exitCode !== "0") return;

  const repo = await resolveRepo(base);
  if (!repo) return;

  const points = scoreForCommand(cmd);
  if (points <= 0) return;

  const existing: Candidate = (await loadCandidate(repo.repoId)) ?? {
    repoId: repo.repoId,
    repoRoot: repo.repoRoot,
    score: 0,
    firstSeenAt: nowIso(),
    lastSeenAt: nowIso(),
  };

  const now = nowEpoch();
  const lastSeenEpoch = Date.parse(existing.lastSeenAt) / 1000;
  const isStale: boolean = Number.isFinite(lastSeenEpoch) && now - lastSeenEpoch > STALE_SECONDS;

  const next: Candidate = {
    repoId: repo.repoId,
    repoRoot: repo.repoRoot,
    score: isStale ? points : existing.score + points,
    firstSeenAt: isStale ? nowIso() : existing.firstSeenAt,
    lastSeenAt: nowIso(),
  };

  await saveCandidate(next);

  if (next.score >= THRESHOLD) {
    await ensureRepo(repo.repoRoot).catch(() => {});
    await clearCandidate(repo.repoId);
  }
}

/** `atlas status [--repo PATH]` — show the repo's atlas state (promoted / candidate / untracked). */
export async function cmdStatus(args: string[]): Promise<void> {
  const base = getRepoArg(args) ?? process.cwd();
  const repo = await resolveRepo(base);

  if (!repo) {
    err("Not inside a git repository.");
    process.exitCode = 1;
    return;
  }

  const projectName = basename(repo.repoRoot);
  const linkPath = join(repo.repoRoot, projectName);
  const targetDir = join(REPOS_DIR, repo.repoId);
  const cand = await loadCandidate(repo.repoId);

  console.log(`Repo: ${repo.repoId}`);
  console.log(`Root: ${repo.repoRoot}`);

  try {
    const current = await readlink(linkPath);
    const isPromoted = current === targetDir;
    console.log(`Atlas dir: ${isPromoted ? targetDir : ''}`);
    if (isPromoted) {
      console.log("State: promoted");
      return;
    }
  } catch {}

  if (cand) {
    console.log("State: candidate");
    console.log(`Score: ${cand.score}/${THRESHOLD}`);
    console.log(`Last seen: ${cand.lastSeenAt}`);
  } else {
    console.log("State: untracked");
  }
}

/**
 * Parse a flag value from a raw argument list.
 *
 * @example
 *   getArgValue(["--cmd", "git status"], "--cmd") // => "git status"
 */
export function getArgValue(args: string[], key: string): string | null {
  const i = args.indexOf(key);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

/** Shorthand for `--repo` flag resolution. */
export function getRepoArg(args: string[]): string | null {
  return getArgValue(args, "--repo");
}

/** Main entry point: read `process.argv` and dispatch to the matching subcommand. */
export async function main(): Promise<void> {
  const [sub, ...args] = process.argv.slice(2);

  switch (sub) {
    case "ensure":
      await cmdEnsure(args);
      break;
    case "promote":
      await cmdPromote(args);
      break;
    case "observe":
      await cmdObserve(args);
      break;
    case "status":
      await cmdStatus(args);
      break;
    case "-h":
    case "--help":
    case undefined:
      usage();
      break;
    default:
      err(`Unknown command: ${sub}`);
      usage();
      process.exitCode = 1;
  }
}
