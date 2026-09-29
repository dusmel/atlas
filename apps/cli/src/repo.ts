/**
 * Repo orchestration: linking, metadata, exclusion, and scoring.
 *
 * This is where the "ensure" and "promote" logic lives — creating the
 * per-repo atlas directory, writing metadata, and managing the `.atlas`
 * symlink inside the source repository.
 */

import { join, basename, resolve } from "node:path";
import { mkdir, readlink, rm, access, appendFile, readFile, readdir, symlink, cp, stat, rename } from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as tty from "node:tty";
import { select, text, isCancel } from "@clack/prompts";
import type { RepoInfo, EnsureResult } from "./types.ts";
import { reposDir, ALIASES, SCORE_RULES } from "./config.ts";
import { err, nowIso, atomicWrite, shortHash, normalizeName } from "./util.ts";
import { resolveRepo, ancestorRoots } from "./git.ts";
import { clearCandidate } from "./state.ts";

/**
 * Append `atlas` to `.git/info/exclude` so git ignores the symlink.
 * Safe to call repeatedly — it will not duplicate the entry.
 * No-op for plain directory projects (no `.git` to update).
 */
export async function ensureExclude(repoRoot: string): Promise<void> {
  try {
    await access(join(repoRoot, ".git"));
  } catch {
    return;
  }
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
  const dir = join(reposDir(), repo.repoId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "meta.json");
  const data = {
    repoId: repo.repoId,
    id: repo.id,
    repoRoot: repo.repoRoot,
    remoteUrl: repo.remoteUrl,
    kind: repo.kind,
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

  const targetDir = join(reposDir(), repo.repoId);
  const projectName = "atlas";
  const linkPath = join(repo.repoRoot, projectName);

  await mkdir(targetDir, { recursive: true });
  await writeMeta(repo);
  await moveRepoContent(repo.repoRoot, targetDir);
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
  const metaPath = join(reposDir(), repoId, "meta.json");
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    return meta.id !== expectedId;
  } catch {
    return false;
  }
}

/**
 * Scan every subdirectory in `reposDir()` looking for a `meta.json` whose
 * `id` matches this repo's unique `id`.  This is necessary because a repo
 * may have been promoted under a custom or disambiguated name (e.g. `sem-1`).
 */
export async function findExistingPromotedDir(repo: RepoInfo): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(reposDir(), { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(reposDir(), entry.name);
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

/**
 * Ordered root options for a non-git directory: best guess first,
 * then surrounding ancestors (deduped).
 */
export function buildRootOptions(cwd: string, bestGuess: string): string[] {
  const chain = ancestorRoots(resolve(cwd));
  const guess = resolve(bestGuess);
  return [...new Set([guess, ...chain])];
}

/** Sentinel value for the "type a custom path" entry in the root picker. */
const CUSTOM_ROOT = "__custom__";

/** Sentinel value for the "type a custom name" entry in the collision picker. */
const CUSTOM_NAME = "__custom__";

/**
 * Non-git root picker. Prints a notice, then offers an arrow-key select
 * with the best guess first, followed by surrounding ancestors, plus a
 * "custom path" entry. Headless (non-tty) prints a plain list and
 * returns the best guess. Cancel falls back to the best guess.
 */
export async function chooseProjectRoot(cwd: string, bestGuess: string): Promise<string> {
  const options = buildRootOptions(cwd, bestGuess);
  console.log("This is not a git repository (plain directory project).");
  if (!tty.isatty(0)) {
    console.log("Select project root:");
    options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${opt}${i === 0 ? " (best guess)" : ""}`);
    });
    return options[0]!;
  }
  const choice = await select({
    message: "Select project root",
    options: [
      ...options.map((opt, i) => ({ value: opt, label: opt, hint: i === 0 ? "best guess" : undefined })),
      { value: CUSTOM_ROOT, label: "Type a custom path…" },
    ],
  });
  if (isCancel(choice) || choice === options[0]) return options[0]!;
  if (choice !== CUSTOM_ROOT) return choice as string;
  const custom = await text({ message: "Project root path" });
  if (isCancel(custom) || String(custom).trim() === "") return options[0]!;
  return resolve(String(custom).trim());
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
 * Cancel falls back to the suggested name.
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

  const choice = await select({
    message: `Name "${repo.repoId}" is already used by another repo.`,
    options: [
      { value: suggested, label: suggested, hint: "suggested" },
      { value: CUSTOM_NAME, label: "Type a custom name…" },
    ],
  });
  if (isCancel(choice) || choice !== CUSTOM_NAME) return suggested;
  const custom = await text({ message: "Custom name", initialValue: suggested });
  if (isCancel(custom)) return suggested;
  const raw = String(custom).trim();
  const chosen = normalizeName(raw === "" ? suggested : raw);

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
 * Move `plans/` and `notes/` directories from the repository root into the
 * promoted atlas directory.  If the target already exists, merge into it and
 * remove the source so the result still behaves like a move.
 */
async function moveRepoContent(repoRoot: string, targetDir: string): Promise<void> {
  const plansSource = join(repoRoot, "plans");
  const notesSource = join(repoRoot, "notes");

  await moveDirIfExists(plansSource, join(targetDir, "plans"));
  await moveDirIfExists(notesSource, join(targetDir, "notes"));
}

async function moveDirIfExists(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await access(sourcePath);
  } catch {
    return;
  }

  try {
    await access(targetPath);
    await cp(sourcePath, targetPath, { recursive: true, force: true });
    await rm(sourcePath, { recursive: true, force: true });
  } catch {
    await rename(sourcePath, targetPath);
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
