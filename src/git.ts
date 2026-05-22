/**
 * Git repository discovery and identity resolution.
 *
 * Detects the nearest enclosing git repo, extracts its origin remote,
 * and derives a stable repo identifier.
 */

import { basename } from "node:path";
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
  const repoId = remoteUrl ? normalizeRemote(remoteUrl) : normalizeName(basename(repoRoot));
  const id = repoIdFromRoot(repoRoot, remoteUrl);
  return { repoRoot, repoId, id, remoteUrl };
}
