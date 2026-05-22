/**
 * Repo orchestration: linking, metadata, exclusion, and scoring.
 *
 * This is where the "ensure" and "promote" logic lives — creating the
 * per-repo atlas directory, writing metadata, and managing the `.atlas`
 * symlink inside the source repository.
 */

import { join, basename } from "node:path";
import { mkdir, readlink, rm, access, appendFile, readFile, symlink } from "node:fs/promises";
import type { RepoInfo, EnsureResult } from "./types.ts";
import { REPOS_DIR, ALIASES, SCORE_RULES } from "./config.ts";
import { err, nowIso, atomicWrite } from "./util.ts";
import { resolveRepo } from "./git.ts";
import { clearCandidate } from "./state.ts";

/**
 * Append the project directory name to `.git/info/exclude` so git ignores
 * the symlink. Safe to call repeatedly — it will not duplicate the entry.
 */
export async function ensureExclude(repoRoot: string): Promise<void> {
  const name = basename(repoRoot);
  const exclude = join(repoRoot, ".git", "info", "exclude");
  try {
    const current = await readFile(exclude, "utf8").catch(() => "");
    const needle = `\n${name}\n`;
    if (!current.includes(needle) && !current.endsWith(`${name}\n`)) {
      await appendFile(exclude, `${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${name}\n`);
    }
  } catch {
    // ignore
  }
}

/**
 * Write or overwrite `meta.json` inside the repo's atlas directory.
 */
export async function writeMeta(repo: RepoInfo): Promise<void> {
  const dir = join(REPOS_DIR, repo.repoId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "meta.json");
  const data = {
    repoId: repo.repoId,
    id: repo.id,
    repoRoot: repo.repoRoot,
    remoteUrl: repo.remoteUrl,
    updatedAt: nowIso(),
  };
  await atomicWrite(file, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Ensure a repo is "atlas-ready":
 *  1. Discovers the repo from `base`.
 *  2. Creates the per-repo atlas directory.
 *  3. Writes metadata.
 *  4. Adds the project directory name to `.git/info/exclude`.
 *  5. Creates or corrects the symlink named after the project in the repo root.
 *
 * @returns `{ repo, changed }` where `changed` indicates the symlink was created
 *          or corrected. Returns `null` if not inside a git repository.
 */
export async function ensureRepo(base = process.cwd()): Promise<EnsureResult | null> {
  const repo = await resolveRepo(base);
  if (!repo) {
    err("Not inside a git repository.");
    process.exitCode = 1;
    return null;
  }

  const targetDir = join(REPOS_DIR, repo.repoId);
  const projectName = basename(repo.repoRoot);
  const linkPath = join(repo.repoRoot, projectName);

  await mkdir(targetDir, { recursive: true });
  await writeMeta(repo);
  await ensureExclude(repo.repoRoot);

  try {
    const current = await readlink(linkPath);
    if (current !== targetDir) {
      await rm(linkPath);
      await symlink(targetDir, linkPath);
      return { repo, changed: true };
    }
    return { repo, changed: false };
  } catch {
    try {
      await access(linkPath);
      err(`${projectName} exists and is not a symlink: ${linkPath}`);
      process.exitCode = 1;
      return null;
    } catch {
      await symlink(targetDir, linkPath);
      return { repo, changed: true };
    }
  }
}

/**
 * Assign a score to a command string based on how "engaged" the user is.
 * Higher scores indicate more meaningful activity (commits > reads).
 *
 * Used by the `observe` command to decide when a repo should be promoted.
 */
export function scoreForCommand(cmd: string): number {
  const c = cmd.trim();

  // Resolve aliases to canonical forms.
  const firstWord = c.split(/\s+/)[0] ?? "";
  const normalized = ALIASES[firstWord] ?? c;
  const tokens = normalized.split(/\s+/);

  // Find the first rule whose token prefix matches.
  for (const rule of SCORE_RULES) {
    if (tokens.length < rule.tokens.length) continue;
    let match = true;
    for (let i = 0; i < rule.tokens.length; i++) {
      const t = tokens[i];
      if (t === undefined || t !== rule.tokens[i]) {
        match = false;
        break;
      }
    }
    if (match) return rule.score;
  }

  return 0;
}
