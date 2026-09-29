/**
 * Git repository discovery and identity resolution.
 *
 * Detects the nearest enclosing git repo, extracts its origin remote,
 * and derives a stable repo identifier.
 */

import { basename, dirname, resolve } from "node:path";
import { access } from "node:fs/promises";
import { run, normalizeName, normalizeRemote, shortHash } from "./util.ts";
import type { RepoInfo } from "./types.ts";

/**
 * Walk upward from `base` to find the nearest git repository root.
 *
 * @returns Absolute path to the repo root, or `null` if not inside a git repo.
 */
export async function repoRootFrom(base = process.cwd()): Promise<string | null> {
  const r = await run(["git", "-C", base, "rev-parse", "--show-toplevel"]);
  if (r.exitCode !== 0 || !r.stdout) return null;
  return r.stdout;
}

/**
 * Fetch the origin remote URL for a given repo root.
 *
 * @returns The remote URL string, or an empty string if no origin remote exists.
 */
export async function remoteUrlFromRoot(root: string): Promise<string> {
  const r = await run(["git", "-C", root, "remote", "get-url", "origin"]);
  if (r.exitCode !== 0) return "";
  return r.stdout.trim();
}

/**
 * Derive a stable repo ID from the repo root and optional remote URL.
 * Prefers the normalized remote URL when available; falls back to a
 * directory-name + short-hash combination.
 */
export function repoIdFromRoot(root: string, remoteUrl: string): string {
  if (remoteUrl) return normalizeRemote(remoteUrl);
  return `${normalizeName(basename(root))}-${shortHash(root)}`;
}

/**
 * Convenience: resolve full repo info starting from any directory.
 *
 * `repoId` is the human-friendly name (used for directories).
 * `id` is the unique identifier (stored in meta.json for disambiguation).
 *
 * @returns `RepoInfo` object, or `null` if not inside a git repo.
 */
export async function resolveRepo(base = process.cwd()): Promise<RepoInfo | null> {
  const repoRoot = await repoRootFrom(base);
  if (!repoRoot) return null;
  const remoteUrl = await remoteUrlFromRoot(repoRoot);
  const localName = normalizeName(basename(repoRoot));
  const id = repoIdFromRoot(repoRoot, remoteUrl);
  return { repoRoot, repoId: localName, id, remoteUrl, kind: "git" };
}

/** Marker files that indicate a plain-directory project root. */
export const DIR_MARKERS = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Makefile",
  "pnpm-workspace.yaml",
  "uv.lock",
  "bun.lock",
  ".atlas-root",
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-guess root for a non-git directory: nearest ancestor (or self)
 * containing a marker file. Falls back to `base` itself.
 */
export async function bestGuessRoot(base = process.cwd()): Promise<string> {
  const start = resolve(base);
  let dir = start;
  for (;;) {
    for (const marker of DIR_MARKERS) {
      if (await pathExists(`${dir}/${marker}`)) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/**
 * Ancestor chain for the root picker: `base` itself, then parents up to
 * `$HOME` (exclusive of `/`), capped at `limit` entries.
 */
export function ancestorRoots(base = process.cwd(), limit = 6): string[] {
  const out: string[] = [];
  let dir = resolve(base);
  const home = process.env.HOME;
  for (;;) {
    out.push(dir);
    if (out.length >= limit) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    if (home && dir === home) break;
    dir = parent;
    // Stop before filesystem root noise; keep HOME as last option.
    if (dir === "/" || dir === "/private" || dir === "/tmp") break;
  }
  return out;
}

/** Build a `RepoInfo` for a plain directory root (no git). */
export function dirRepoInfo(root: string): RepoInfo {
  const abs = resolve(root);
  const localName = normalizeName(basename(abs));
  return { repoRoot: abs, repoId: localName, id: repoIdFromRoot(abs, ""), remoteUrl: "", kind: "dir" };
}

/**
 * Git-first discovery with plain-directory fallback.
 * Never returns `null` for an existing directory; returns `null` only
 * when `base` cannot be resolved at all.
 */
export async function resolveProject(base = process.cwd()): Promise<RepoInfo | null> {
  const gitRepo = await resolveRepo(base);
  if (gitRepo) return gitRepo;
  try {
    const guess = await bestGuessRoot(base);
    return dirRepoInfo(guess);
  } catch {
    return null;
  }
}

/** Roots where auto-promotion should never fire (manual promote still allowed). */
export function isUnsafeAutoRoot(root: string): boolean {
  const abs = resolve(root);
  const home = process.env.HOME ? resolve(process.env.HOME) : "";
  return abs === "/" || abs === "/tmp" || abs === "/private/tmp" || (home !== "" && abs === home);
}
