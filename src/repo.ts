/**
 * Repo orchestration: linking, metadata, exclusion, and scoring.
 *
 * This is where the "ensure" and "promote" logic lives — creating the
 * per-repo atlas directory, writing metadata, and managing the `.atlas`
 * symlink inside the source repository.
 */

import { join, basename } from "node:path";
import { mkdir, readlink, rm, access, appendFile, readFile, readdir, symlink, cp, stat } from "node:fs/promises";
import * as readline from "node:readline";
import * as tty from "node:tty";
import type { RepoInfo, EnsureResult } from "./types.ts";
import { REPOS_DIR, ALIASES, SCORE_RULES } from "./config.ts";
import { err, nowIso, atomicWrite, shortHash, normalizeName } from "./util.ts";
import { resolveRepo } from "./git.ts";
import { clearCandidate } from "./state.ts";

/**
 * Append `atlas` to `.git/info/exclude` so git ignores the symlink.
 * Safe to call repeatedly — it will not duplicate the entry.
 */
export async function ensureExclude(repoRoot: string): Promise<void> {
  const name = "atlas";
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
export async function ensureRepo(base = process.cwd(), resolvedRepo?: RepoInfo): Promise<EnsureResult | null> {
  const repo = resolvedRepo ?? await resolveRepo(base);
  if (!repo) {
    err("Not inside a git repository.");
    process.exitCode = 1;
    return null;
  }

  const targetDir = join(REPOS_DIR, repo.repoId);
  const projectName = "atlas";
  const linkPath = join(repo.repoRoot, projectName);

  await mkdir(targetDir, { recursive: true });
  await writeMeta(repo);
  await copyRepoContent(repo.repoRoot, targetDir);
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
      const statResult = await stat(linkPath);
      if (statResult.isDirectory()) {
        await migrateExistingAtlasContent(linkPath, targetDir);
        await rm(linkPath, { recursive: true, force: true });
        await symlink(targetDir, linkPath);
        return { repo, changed: true };
      }
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
 * Check whether an atlas directory under `repoId` already belongs to a
 * different repository by comparing the stored `id` in `meta.json`.
 */
export async function checkCollision(repoId: string, expectedId: string): Promise<boolean> {
  const metaPath = join(REPOS_DIR, repoId, "meta.json");
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    return meta.id !== expectedId;
  } catch {
    return false;
  }
}

/**
 * Scan every subdirectory in `REPOS_DIR` looking for a `meta.json` whose
 * `id` matches this repo's unique `id`.  This is necessary because a repo
 * may have been promoted under a custom or disambiguated name (e.g. `sem-1`).
 */
export async function findExistingPromotedDir(repo: RepoInfo): Promise<string | null> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(REPOS_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(REPOS_DIR, entry.name);
    try {
      const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
      if (meta.id === repo.id) return dir;
    } catch {
      // unreadable or missing meta.json — skip
    }
  }

  return null;
}

/**
 * Generate a unique directory name when the preferred local basename collides
 * with another promoted repo.  The suffix is derived from the repo's unique
 * `id` so it is stable for the same repository.
 */
export function suggestUniqueName(repoId: string, id: string): string {
  return `${repoId}-${shortHash(id).slice(0, 4)}`;
}

/** Prompt the user on stdin and return the trimmed answer. */
function askUser(questionText: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(questionText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Determine the final `repoId` to use for atlas storage.
 *
 * - If the repo is already promoted under any name, reuse that directory.
 * - If the preferred local name is free, use it.
 * - If it collides with a *different* repo:
 *   – `interactive = true`  → prompt to confirm the suggested name or type a custom one.
 *   – `interactive = false` → use the suggested name headlessly.
 *
 * Returns `null` only when the interactive prompt is cancelled (e.g. stdin closed).
 */
export async function resolveRepoId(repo: RepoInfo, interactive: boolean): Promise<string | null> {
  const existingDir = await findExistingPromotedDir(repo);
  if (existingDir) return basename(existingDir);

  const collides = await checkCollision(repo.repoId, repo.id);
  if (!collides) return repo.repoId;

  const suggested = suggestUniqueName(repo.repoId, repo.id);

  if (!interactive || !tty.isatty(0)) {
    return suggested;
  }

  const answer = await askUser(
    `Name "${repo.repoId}" is already used by another repo.\n` +
      `Suggested: "${suggested}". Press Enter to accept or type a custom name: `,
  );
  const chosen = normalizeName(answer === "" ? suggested : answer);

  if (chosen !== suggested) {
    const stillCollides = await checkCollision(chosen, repo.id);
    if (stillCollides) {
      console.error(`Name "${chosen}" is also taken. Using suggested: "${suggested}"`);
      return suggested;
    }
  }

  return chosen;
}

/**
 * If the repo already contains a real directory where the symlink should
 * live (e.g. `myproject/atlas/`), copy any `plans/` and `notes/` subdirectories
 * into the promoted atlas directory before replacing it with the symlink.
 *
 * @param existingDirPath  The real directory inside the repo root (e.g. `…/atlas/`)
 * @param promotedDirPath  The target atlas directory under `~/MEGA/Documents/atlas/repos/`
 */
async function migrateExistingAtlasContent(existingDirPath: string, promotedDirPath: string): Promise<void> {
  const plansSource = join(existingDirPath, "plans");
  const notesSource = join(existingDirPath, "notes");

  try {
    await access(plansSource);
    await cp(plansSource, join(promotedDirPath, "plans"), { recursive: true, force: true });
  } catch {
    // No plans directory to migrate.
  }

  try {
    await access(notesSource);
    await cp(notesSource, join(promotedDirPath, "notes"), { recursive: true, force: true });
  } catch {
    // No notes directory to migrate.
  }
}


/**
 * Copy `plans/` and `notes/` directories from the repository root into the
 * promoted atlas directory.  This runs during every `ensureRepo` call so that
 * content is migrated even when there is no pre-existing `atlas/` directory
 * inside the repo.
 */
async function copyRepoContent(repoRoot: string, targetDir: string): Promise<void> {
  const plansSource = join(repoRoot, "plans");
  const notesSource = join(repoRoot, "notes");

  try {
    await access(plansSource);
    await cp(plansSource, join(targetDir, "plans"), { recursive: true, force: true });
  } catch {
    // No plans directory at repo root.
  }

  try {
    await access(notesSource);
    await cp(notesSource, join(targetDir, "notes"), { recursive: true, force: true });
  } catch {
    // No notes directory at repo root.
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
