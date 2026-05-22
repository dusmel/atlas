/**
 * Behavioral tests for git discovery and repo identity resolution.
 *
 * Creates real git repositories and verifies discovery logic.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { repoRootFrom, remoteUrlFromRoot, repoIdFromRoot, resolveRepo } from "../src/git.ts";
import { run } from "../src/util.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";

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

describe("repoRootFrom", () => {
  let tempDir: string;
  let repoDir: string;
  let subDir: string;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-git-test-")));
    repoDir = join(tempDir, "my-repo");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir);
    subDir = join(repoDir, "src", "components");
    mkdirSync(subDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("finds repo root from repo root", async () => {
    const root = await repoRootFrom(repoDir);
    expect(root).toBe(repoDir);
  });

  test("finds repo root from subdirectory", async () => {
    const root = await repoRootFrom(subDir);
    expect(root).toBe(repoDir);
  });

  test("returns null outside any repo", async () => {
    const outside = join(tempDir, "outside");
    mkdirSync(outside, { recursive: true });
    const root = await repoRootFrom(outside);
    expect(root).toBeNull();
  });

  test("finds nearest repo in nested structure", async () => {
    const innerRepo = join(repoDir, "nested-repo");
    mkdirSync(innerRepo, { recursive: true });
    await makeGitRepo(innerRepo);
    const deepInside = join(innerRepo, "deep", "path");
    mkdirSync(deepInside, { recursive: true });
    const root = await repoRootFrom(deepInside);
    expect(root).toBe(innerRepo);
  });
});

describe("remoteUrlFromRoot", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-remote-test-")));
    repoDir = join(tempDir, "repo");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir, "https://github.com/user/repo.git");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns origin remote URL", async () => {
    const url = await remoteUrlFromRoot(repoDir);
    expect(url).toBe("https://github.com/user/repo.git");
  });

  test("returns empty string when no origin", async () => {
    const noRemoteDir = join(tempDir, "no-remote");
    mkdirSync(noRemoteDir, { recursive: true });
    await makeGitRepo(noRemoteDir);
    const url = await remoteUrlFromRoot(noRemoteDir);
    expect(url).toBe("");
  });
});

describe("repoIdFromRoot", () => {
  test("uses normalized remote URL when available", () => {
    const id = repoIdFromRoot("/home/user/my-repo", "https://github.com/user/repo.git");
    expect(id).toBe("github.com-user-repo");
  });

  test("falls back to directory name + hash when no remote", () => {
    const id = repoIdFromRoot("/home/user/my-repo", "");
    expect(id).toMatch(/^my-repo-[a-f0-9]{8}$/);
  });

  test("stable hash for same path without remote", () => {
    const id1 = repoIdFromRoot("/home/user/my-repo", "");
    const id2 = repoIdFromRoot("/home/user/my-repo", "");
    expect(id1).toBe(id2);
  });
});

describe("resolveRepo", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-resolve-test-")));
    repoDir = join(tempDir, "my-project");
    mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("resolves repo with remote", async () => {
    await makeGitRepo(repoDir, "https://github.com/user/my-project.git");
    const repo = await resolveRepo(repoDir);
    expect(repo).not.toBeNull();
    expect(repo!.repoRoot).toBe(repoDir);
    expect(repo!.repoId).toBe("my-project");
    expect(repo!.remoteUrl).toBe("https://github.com/user/my-project.git");
    expect(repo!.id).toBe("github.com-user-my-project");
  });

  test("resolves repo without remote", async () => {
    await makeGitRepo(repoDir);
    const repo = await resolveRepo(repoDir);
    expect(repo).not.toBeNull();
    expect(repo!.repoRoot).toBe(repoDir);
    expect(repo!.repoId).toBe("my-project");
    expect(repo!.remoteUrl).toBe("");
    expect(repo!.id).toMatch(/^my-project-[a-f0-9]{8}$/);
  });

  test("normalizes repoId from directory name", async () => {
    const weirdDir = join(tempDir, "My Project!!!");
    mkdirSync(weirdDir, { recursive: true });
    await makeGitRepo(weirdDir);
    const repo = await resolveRepo(weirdDir);
    expect(repo!.repoId).toBe("my-project");
  });

  test("returns null outside git repo", async () => {
    const outside = join(tempDir, "not-a-repo");
    mkdirSync(outside, { recursive: true });
    const repo = await resolveRepo(outside);
    expect(repo).toBeNull();
  });
});
