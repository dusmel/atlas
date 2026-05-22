/**
 * Candidate state persistence layer.
 *
 * Stores per-repo scoring data as small JSON files under `STATE_DIR`.
 * Each file is named `<repoId>.json`.
 */

import { join } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import type { Candidate } from "./types.ts";
import { STATE_DIR } from "./config.ts";
import { atomicWrite } from "./util.ts";

/** Full filesystem path for a given repo's candidate file. */
export function candidatePath(repoId: string): string {
  return join(STATE_DIR, `${repoId}.json`);
}

/**
 * Load a candidate record from disk.
 *
 * @returns The parsed `Candidate`, or `null` if the file is missing or unreadable.
 */
export async function loadCandidate(repoId: string): Promise<Candidate | null> {
  const file = candidatePath(repoId);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as Candidate;
  } catch {
    return null;
  }
}

/** Persist a candidate record to disk atomically. */
export async function saveCandidate(c: Candidate): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await atomicWrite(candidatePath(c.repoId), JSON.stringify(c, null, 2) + "\n");
}

/** Remove a candidate file if it exists. */
export async function clearCandidate(repoId: string): Promise<void> {
  try {
    await rm(candidatePath(repoId));
  } catch {}
}
