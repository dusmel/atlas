/**
 * Behavioral tests for candidate state persistence.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { candidatePath, loadCandidate, saveCandidate, clearCandidate } from "../src/state.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync } from "node:fs";

// Helper to compute expected atlas paths in assertions
function expectedStateDir() {
  const root = process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`;
  return join(root, "state", "candidates");
}

describe("candidate persistence", () => {
  let tempDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "atlas-state-test-"));
    oldAtlasRoot = process.env.ATLAS_ROOT;
    process.env.ATLAS_ROOT = tempDir;
  });

  afterEach(() => {
    if (oldAtlasRoot !== undefined) {
      process.env.ATLAS_ROOT = oldAtlasRoot;
    } else {
      delete process.env.ATLAS_ROOT;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("save then load roundtrip", async () => {
    const candidate = {
      repoId: "my-repo",
      repoRoot: "/home/user/my-repo",
      score: 3,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-02T00:00:00Z",
    };

    await saveCandidate(candidate);
    const loaded = await loadCandidate("my-repo");

    expect(loaded).toEqual(candidate);
  });

  test("load non-existent returns null", async () => {
    const loaded = await loadCandidate("does-not-exist");
    expect(loaded).toBeNull();
  });

  test("clear removes candidate file", async () => {
    const candidate = {
      repoId: "temp-repo",
      repoRoot: "/tmp/repo",
      score: 1,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
    };

    await saveCandidate(candidate);
    const path = candidatePath("temp-repo");
    expect(existsSync(path)).toBe(true);

    await clearCandidate("temp-repo");
    expect(existsSync(path)).toBe(false);
  });

  test("clear non-existent does not throw", async () => {
    await clearCandidate("never-saved");
    // Should not throw
  });

  test("candidatePath reflects ATLAS_ROOT", () => {
    const path = candidatePath("test-repo");
    expect(path).toBe(join(tempDir, "state", "candidates", "test-repo.json"));
  });

  test("multiple candidates coexist independently", async () => {
    const c1 = {
      repoId: "repo-a",
      repoRoot: "/home/a",
      score: 2,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-02T00:00:00Z",
    };
    const c2 = {
      repoId: "repo-b",
      repoRoot: "/home/b",
      score: 5,
      firstSeenAt: "2026-01-03T00:00:00Z",
      lastSeenAt: "2026-01-04T00:00:00Z",
    };

    await saveCandidate(c1);
    await saveCandidate(c2);

    const loaded1 = await loadCandidate("repo-a");
    const loaded2 = await loadCandidate("repo-b");

    expect(loaded1).toEqual(c1);
    expect(loaded2).toEqual(c2);
  });

  test("overwrite existing candidate", async () => {
    const original = {
      repoId: "updating-repo",
      repoRoot: "/home/user/repo",
      score: 1,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
    };

    await saveCandidate(original);

    const updated = {
      ...original,
      score: 4,
      lastSeenAt: "2026-01-02T00:00:00Z",
    };

    await saveCandidate(updated);
    const loaded = await loadCandidate("updating-repo");

    expect(loaded!.score).toBe(4);
    expect(loaded!.lastSeenAt).toBe("2026-01-02T00:00:00Z");
  });
});
