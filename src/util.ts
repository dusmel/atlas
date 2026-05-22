/**
 * Low-level utilities: string normalization, time helpers, process runner,
 * and atomic file writes.
 */

import { createHash } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import type { RunResult } from "./types.ts";

/** Print the CLI usage string to stdout. */
export function usage(): void {
console.log(`atlas — sync my notes and context to a centralized place.

Usage:
  atlas ensure [--repo PATH]        Ensure repo is tracked and .atlas symlink exists
  atlas promote [--repo PATH]       Force-promote repo (clear candidate state)
  atlas observe --cmd "..." --exit N [--repo PATH]
                                    Observe a command to score repo engagement
  atlas status [--repo PATH]        Show atlas state: promoted | candidate | untracked

Examples:
  atlas status
  atlas observe --cmd "git commit" --exit 0
  atlas promote --repo ~/projects/my-repo`);
}

/** Print an error message to stderr. */
export function err(msg: string): void {
  console.error(msg);
}

/** Current Unix timestamp in seconds. */
export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/** Current UTC timestamp as an ISO-8601 string (no milliseconds). */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Normalize an arbitrary string into a safe kebab-case name.
 * Strips non-alphanumeric characters (except dots, underscores, hyphens).
 */
export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalize a Git remote URL into a safe, filesystem-friendly identifier.
 * Strips protocol prefixes, `.git` suffix, and replaces separators with hyphens.
 */
export function normalizeRemote(remote: string): string {
  let s = remote.trim();
  s = s.replace(/^git@/, "");
  s = s.replace(/^ssh:\/\//, "");
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^git:\/\//, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/[:/@]/g, "-");
  return normalizeName(s);
}

/** Return the first 8 hex characters of a SHA-1 hash of the input. */
export function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 8);
}

/**
 * Spawn a child process, capture stdout/stderr, and return everything.
 *
 * @param cmd  Command + arguments array.
 * @param cwd  Optional working directory.
 */
export async function run(cmd: string[], cwd?: string): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Write a file atomically by first writing to a temp path then renaming.
 * Prevents readers from seeing partially-written content.
 */
export async function atomicWrite(path: string, contents: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
}
