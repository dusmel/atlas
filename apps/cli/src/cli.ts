/**
 * CLI command handlers and argument parsing.
 *
 * Parses raw `process.argv` slices and dispatches to the appropriate
 * subcommand handler (`ensure`, `promote`, `observe`, `status`).
 */

import { join } from "node:path";
import { readdir, readlink } from "node:fs/promises";
import * as tty from "node:tty";
import { autocomplete, isCancel } from "@clack/prompts";
import { threshold, staleSeconds } from "./config.ts";
import type { Candidate, RepoInfo } from "./types.ts";
import { err, nowEpoch, nowIso, out, run, usage } from "./util.ts";
import { resolveRepo, resolveProject, bestGuessRoot, dirRepoInfo, isUnsafeAutoRoot } from "./git.ts";
import { loadCandidate, saveCandidate, clearCandidate } from "./state.ts";
import { ensureRepo, scoreForCommand, findExistingPromotedDir, resolveRepoId, chooseProjectRoot } from "./repo.ts";
import { cmdTodo } from "./todo/commands.ts";
import { complete, ZSH_SCRIPT } from "./complete.ts";

/**
 * Git-first resolution with plain-directory fallback.
 *
 * - Inside git: returns the git repo, no output.
 * - Outside git with `pickRoot`: prints the non-git notice and offers
 *   the root select (best guess first, then surrounding ancestors).
 * - Outside git without `pickRoot`: silent best guess (for `observe`).
 */
async function resolveForCommand(base: string, pickRoot: boolean): Promise<RepoInfo | null> {
  const gitRepo = await resolveRepo(base);
  if (gitRepo) return gitRepo;
  const guess = await bestGuessRoot(base);
  const root = pickRoot ? await chooseProjectRoot(base, guess) : guess;
  return dirRepoInfo(root);
}

/** `atlas ensure [--repo PATH]` — ensure the repo is atlas-ready. */
export async function cmdEnsure(args: string[]): Promise<void> {
  const base = getRepoArg(args) ?? process.cwd();
  const repo = await resolveForCommand(base, true);
  if (!repo) {
    err("Could not determine project root.");
    process.exitCode = 1;
    return;
  }
  const finalRepoId = await resolveRepoId(repo, false);
  if (!finalRepoId) return;
  repo.repoId = finalRepoId;
  await ensureRepo(base, repo);
}

/** `atlas promote [--repo PATH]` — force-promote a repo and clear its candidate state. */
export async function cmdPromote(args: string[]): Promise<void> {
  const base = getRepoArg(args) ?? process.cwd();
  const repo = await resolveForCommand(base, true);
  if (!repo) {
    err("Could not determine project root.");
    process.exitCode = 1;
    return;
  }

  const localRepoId = repo.repoId;
  const finalRepoId = await resolveRepoId(repo, true);
  if (!finalRepoId) return;

  repo.repoId = finalRepoId;
  const result = await ensureRepo(base, repo);
  if (!result) return;
  await clearCandidate(localRepoId);
  console.log(result.changed ? `Atlas linked: ${result.repo.repoRoot}/atlas` : "Atlas already linked.");
}

/**
 * `atlas observe --cmd "..." --exit 0 [--repo PATH]`
 *
 * Called from shell hooks (e.g. preexec). If the command exited 0 and
 * scores above 0, we increment (or reset) the repo's candidate score.
 * When the score crosses the threshold, the repo is auto-promoted.
 */
export async function cmdObserve(args: string[]): Promise<void> {
  const cmd = getArgValue(args, "--cmd");
  const exitCode = getArgValue(args, "--exit");
  const base = getArgValue(args, "--repo") ?? process.cwd();

  if (!cmd) return;
  if (exitCode !== "0") return;

  // Silent headless fallback for plain directories; never prompt here.
  // Skip unsafe auto roots ($HOME, /, /tmp) to avoid promoting noise.
  const repo = await resolveProject(base);
  if (!repo) return;
  if (repo.kind === "dir" && isUnsafeAutoRoot(repo.repoRoot)) return;

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
  const isStale: boolean = Number.isFinite(lastSeenEpoch) && now - lastSeenEpoch > staleSeconds();

  const next: Candidate = {
    repoId: repo.repoId,
    repoRoot: repo.repoRoot,
    score: isStale ? points : existing.score + points,
    firstSeenAt: isStale ? nowIso() : existing.firstSeenAt,
    lastSeenAt: nowIso(),
  };

  await saveCandidate(next);

  if (next.score >= threshold()) {
    const localRepoId = repo.repoId;
    const finalRepoId = await resolveRepoId(repo, false);
    if (finalRepoId) {
      repo.repoId = finalRepoId;
      await ensureRepo(repo.repoRoot, repo).catch(() => {});
    }
    await clearCandidate(localRepoId);
  }
}

/** `atlas status [--repo PATH]` — show the repo's atlas state (promoted / candidate / untracked). */
export async function cmdStatus(args: string[]): Promise<void> {
  const base = getRepoArg(args) ?? process.cwd();
  const gitRepo = await resolveRepo(base);
  let repo: RepoInfo | null;
  if (gitRepo) {
    repo = gitRepo;
  } else {
    // Read-only notice: no root select here, just the best guess.
    console.log("Note: this is not a git repository (plain directory project).");
    repo = dirRepoInfo(await bestGuessRoot(base));
  }

  if (!repo) {
    err("Could not determine project root.");
    process.exitCode = 1;
    return;
  }

  const linkPath = join(repo.repoRoot, "atlas");
  const existingDir = await findExistingPromotedDir(repo);
  const cand = await loadCandidate(repo.repoId);

  console.log(`Repo: ${repo.repoId}`);
  console.log(`Root: ${repo.repoRoot}`);
  console.log(`Type: ${repo.kind === "git" ? "git" : "plain directory"}`);
  console.log(`Atlas dir: ${existingDir ?? ""}`);

  try {
    const current = await readlink(linkPath);
    if (current === existingDir) {
      console.log("State: promoted");
      return;
    }
  } catch {}

  if (cand) {
    console.log("State: candidate");
    console.log(`Score: ${cand.score}/${threshold()}`);
    console.log(`Last seen: ${cand.lastSeenAt}`);
  } else {
    console.log("State: untracked");
  }
}

/**
 * `atlas open [--repo PATH]` — open an HTML file from the repo's atlas dir
 * in the default browser. Defaults to `index.html`; when several HTML files
 * exist, offers a searchable picker with `index.html` first. Headless
 * (non-tty) and single-file cases open the default directly.
 */
export async function cmdOpen(
  args: string[],
  openPath: (path: string) => Promise<unknown> = (path) => run(["open", path]),
): Promise<void> {
  const base = getRepoArg(args) ?? process.cwd();
  const repo = await resolveForCommand(base, true);
  if (!repo) {
    err("Could not determine project root.");
    process.exitCode = 1;
    return;
  }

  const atlasDir = (await findExistingPromotedDir(repo)) ?? join(repo.repoRoot, "atlas");
  let files: string[];
  try {
    files = (await readdir(atlasDir)).filter((f) => f.endsWith(".html")).sort();
  } catch {
    files = [];
  }
  if (files.length === 0) {
    err("No HTML files found in atlas dir.");
    process.exitCode = 1;
    return;
  }

  const preferred = "index.html";
  const ordered = [...files].sort((a, b) =>
    a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b),
  );
  let choice = ordered[0]!;
  if (ordered.length > 1 && tty.isatty(0)) {
    const picked = await autocomplete({
      message: "⌕ Search atlas files",
      placeholder: "Type to filter…",
      maxItems: 10,
      initialValue: ordered[0],
      options: ordered.map((f) => ({
        value: f,
        label: f,
        hint: f === preferred ? "default" : undefined,
      })),
    });
    if (!isCancel(picked)) choice = picked as string;
  }

  await openPath(join(atlasDir, choice));
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
    case "open":
      await cmdOpen(args);
      break;
    case "todo":
      await cmdTodo(args);
      break;
    case "completion":
      await out(ZSH_SCRIPT);
      break;
    case "__complete":
      await out((await complete(args)).join("\n"));
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
