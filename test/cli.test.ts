/**
 * End-to-end behavioral tests for CLI commands.
 *
 * Tests the full user-facing behavior of each subcommand.
 * Avoids process.chdir to prevent cross-test interference.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { cmdEnsure, cmdPromote, cmdObserve, cmdStatus, getArgValue } from "../src/cli.ts";
import { run } from "../src/util.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readlinkSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";

// Compute dynamic atlas paths for assertions
function expectedReposDir() {
  const root = process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`;
  return join(root, "repos");
}
function expectedStateDir() {
  const root = process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`;
  return join(root, "state", "candidates");
}

async function makeGitRepo(dir: string, remote?: string) {
  await run(["git", "init"], dir);
  await run(["git", "config", "user.email", "test@example.com"], dir);
  await run(["git", "config", "user.name", "Test User"], dir);
  if (remote) {
    await run(["git", "remote", "add", "origin", remote], dir);
  }
  const readme = join(dir, "README.md");
  writeFileSync(readme, "# test");
  await run(["git", "add", "README.md"], dir);
  await run(["git", "commit", "-m", "init"], dir);
}

// Capture console output
function captureConsole(fn: () => Promise<void>): Promise<{ stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origError = console.error;

  console.log = (...args: unknown[]) => stdout.push(args.join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.join(" "));

  return fn().then(() => {
    console.log = origLog;
    console.error = origError;
    return { stdout, stderr };
  });
}

describe("getArgValue", () => {
  test("finds flag value", () => {
    expect(getArgValue(["--cmd", "git status"], "--cmd")).toBe("git status");
  });

  test("returns null for missing flag", () => {
    expect(getArgValue(["--other", "value"], "--cmd")).toBeNull();
  });

  test("returns null when flag is last element", () => {
    expect(getArgValue(["--cmd"], "--cmd")).toBeNull();
  });
});

describe("cmdEnsure", () => {
  let tempDir: string;
  let repoDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-cli-test-")));
    repoDir = join(tempDir, "ensure-test");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir);
    oldAtlasRoot = process.env.ATLAS_ROOT;
    process.env.ATLAS_ROOT = join(tempDir, "atlas-root");
  });

  afterEach(() => {
    if (oldAtlasRoot !== undefined) {
      process.env.ATLAS_ROOT = oldAtlasRoot;
    } else {
      delete process.env.ATLAS_ROOT;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates atlas directory and symlink", async () => {
    await cmdEnsure(["--repo", repoDir]);

    const atlasDir = join(expectedReposDir(), "ensure-test");
    expect(existsSync(atlasDir)).toBe(true);
    expect(existsSync(join(atlasDir, "meta.json"))).toBe(true);
    expect(existsSync(join(repoDir, "atlas"))).toBe(true);
    expect(readlinkSync(join(repoDir, "atlas"))).toBe(atlasDir);
  });

  test("works with --repo flag", async () => {
    await cmdEnsure(["--repo", repoDir]);

    const atlasDir = join(expectedReposDir(), "ensure-test");
    expect(existsSync(atlasDir)).toBe(true);
  });

  test("errors outside git repo", async () => {
    const outside = join(tempDir, "outside");
    mkdirSync(outside, { recursive: true });

    const { stderr } = await captureConsole(() => cmdEnsure(["--repo", outside]));
    expect(stderr[0]).toContain("Not inside a git repository");
  });
});

describe("cmdPromote", () => {
  let tempDir: string;
  let repoDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-promote-test-")));
    repoDir = join(tempDir, "promote-test");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir);
    oldAtlasRoot = process.env.ATLAS_ROOT;
    process.env.ATLAS_ROOT = join(tempDir, "atlas-root");
  });

  afterEach(() => {
    if (oldAtlasRoot !== undefined) {
      process.env.ATLAS_ROOT = oldAtlasRoot;
    } else {
      delete process.env.ATLAS_ROOT;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("promotes repo and clears candidate state", async () => {
    // Create a candidate with a low-scoring command (does not auto-promote)
    await cmdObserve(["--cmd", "git status", "--exit", "0", "--repo", repoDir]);

    // Verify candidate exists
    const candPath = join(expectedStateDir(), "promote-test.json");
    expect(existsSync(candPath)).toBe(true);

    // Promote
    const { stdout } = await captureConsole(() => cmdPromote(["--repo", repoDir]));
    expect(stdout[0]).toContain("Atlas linked");

    // Candidate should be cleared
    expect(existsSync(candPath)).toBe(false);

    // Atlas directory should exist
    const atlasDir = join(expectedReposDir(), "promote-test");
    expect(existsSync(atlasDir)).toBe(true);
    expect(existsSync(join(repoDir, "atlas"))).toBe(true);
  });

  test("is idempotent on second promote", async () => {
    await cmdPromote(["--repo", repoDir]);
    const { stdout } = await captureConsole(() => cmdPromote(["--repo", repoDir]));
    expect(stdout[0]).toBe("Atlas already linked.");
  });

  test("copies plans/ and notes/ on promote", async () => {
    mkdirSync(join(repoDir, "plans"), { recursive: true });
    writeFileSync(join(repoDir, "plans", "01.md"), "# Plan");
    mkdirSync(join(repoDir, "notes"), { recursive: true });
    writeFileSync(join(repoDir, "notes", "daily.md"), "Notes");

    await cmdPromote(["--repo", repoDir]);

    const atlasDir = join(expectedReposDir(), "promote-test");
    expect(existsSync(join(atlasDir, "plans", "01.md"))).toBe(true);
    expect(existsSync(join(atlasDir, "notes", "daily.md"))).toBe(true);
  });

  test("headless collision resolution uses suggested name", async () => {
    // Create first repo
    const repo1 = join(tempDir, "shared-name");
    mkdirSync(repo1, { recursive: true });
    await makeGitRepo(repo1, "https://github.com/user1/shared-name.git");

    // Create second repo with same name
    const repo2 = join(tempDir, "other", "shared-name");
    mkdirSync(repo2, { recursive: true });
    await makeGitRepo(repo2, "https://github.com/user2/shared-name.git");

    // Promote first
    await cmdPromote(["--repo", repo1]);

    // Promote second (headless, should use suggested name)
    await cmdPromote(["--repo", repo2]);

    // Should have created a disambiguated directory
    const linkTarget = readlinkSync(join(repo2, "atlas"));
    expect(linkTarget).not.toBe(join(expectedReposDir(), "shared-name"));
    expect(existsSync(linkTarget)).toBe(true);
  });
});

describe("cmdObserve", () => {
  let tempDir: string;
  let repoDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-observe-test-")));
    repoDir = join(tempDir, "observe-test");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir);
    oldAtlasRoot = process.env.ATLAS_ROOT;
    process.env.ATLAS_ROOT = join(tempDir, "atlas-root");
  });

  afterEach(() => {
    if (oldAtlasRoot !== undefined) {
      process.env.ATLAS_ROOT = oldAtlasRoot;
    } else {
      delete process.env.ATLAS_ROOT;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("scores meaningful git commands", async () => {
    // Use git status (score 1) to avoid crossing the default threshold of 4
    await cmdObserve(["--cmd", "git status", "--exit", "0", "--repo", repoDir]);

    const cand = JSON.parse(await readFile(join(expectedStateDir(), "observe-test.json"), "utf8"));
    expect(cand.score).toBe(1);
  });

  test("ignores non-zero exit codes", async () => {
    await cmdObserve(["--cmd", "git commit", "--exit", "1", "--repo", repoDir]);

    const candPath = join(expectedStateDir(), "observe-test.json");
    expect(existsSync(candPath)).toBe(false);
  });

  test("ignores unscored commands", async () => {
    await cmdObserve(["--cmd", "ls -la", "--exit", "0", "--repo", repoDir]);

    const candPath = join(expectedStateDir(), "observe-test.json");
    expect(existsSync(candPath)).toBe(false);
  });

  test("accumulates score across multiple observations", async () => {
    // Use two low-scoring commands that stay below the threshold
    await cmdObserve(["--cmd", "git status", "--exit", "0", "--repo", repoDir]);
    await cmdObserve(["--cmd", "git log", "--exit", "0", "--repo", repoDir]);

    const cand = JSON.parse(await readFile(join(expectedStateDir(), "observe-test.json"), "utf8"));
    expect(cand.score).toBe(2); // 1 + 1
  });

  test("auto-promotes when threshold is crossed", async () => {
    // Lower threshold for testing
    const oldThreshold = process.env.ATLAS_THRESHOLD;
    process.env.ATLAS_THRESHOLD = "3";

    // git add = 4 points, which crosses threshold of 3
    await cmdObserve(["--cmd", "git add file.txt", "--exit", "0", "--repo", repoDir]);

    const atlasDir = join(expectedReposDir(), "observe-test");
    expect(existsSync(atlasDir)).toBe(true);
    expect(existsSync(join(repoDir, "atlas"))).toBe(true);

    // Candidate should be cleared after promotion
    expect(existsSync(join(expectedStateDir(), "observe-test.json"))).toBe(false);

    if (oldThreshold !== undefined) {
      process.env.ATLAS_THRESHOLD = oldThreshold;
    } else {
      delete process.env.ATLAS_THRESHOLD;
    }
  });
});

describe("cmdStatus", () => {
  let tempDir: string;
  let repoDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-status-test-")));
    repoDir = join(tempDir, "status-test");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir);
    oldAtlasRoot = process.env.ATLAS_ROOT;
    process.env.ATLAS_ROOT = join(tempDir, "atlas-root");
  });

  afterEach(() => {
    if (oldAtlasRoot !== undefined) {
      process.env.ATLAS_ROOT = oldAtlasRoot;
    } else {
      delete process.env.ATLAS_ROOT;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("shows untracked for new repo", async () => {
    const { stdout } = await captureConsole(() => cmdStatus(["--repo", repoDir]));
    expect(stdout.some(s => s.includes("State: untracked"))).toBe(true);
  });

  test("shows candidate with score", async () => {
    await cmdObserve(["--cmd", "git status", "--exit", "0", "--repo", repoDir]);

    const { stdout } = await captureConsole(() => cmdStatus(["--repo", repoDir]));
    expect(stdout.some(s => s.includes("State: candidate"))).toBe(true);
    expect(stdout.some(s => s.includes("Score: 1/"))).toBe(true);
  });

  test("shows promoted for linked repo", async () => {
    await cmdPromote(["--repo", repoDir]);

    const { stdout } = await captureConsole(() => cmdStatus(["--repo", repoDir]));
    expect(stdout.some(s => s.includes("State: promoted"))).toBe(true);
  });

  test("shows atlas dir path when promoted", async () => {
    await cmdPromote(["--repo", repoDir]);

    const { stdout } = await captureConsole(() => cmdStatus(["--repo", repoDir]));
    const atlasDirLine = stdout.find(s => s.startsWith("Atlas dir:"));
    expect(atlasDirLine).toContain(expectedReposDir());
  });

  test("errors outside git repo", async () => {
    const outside = join(tempDir, "outside");
    mkdirSync(outside, { recursive: true });

    const { stderr } = await captureConsole(() => cmdStatus(["--repo", outside]));
    expect(stderr[0]).toContain("Not inside a git repository");
  });
});
