/**
 * Behavioral tests for repo promotion, collision resolution, and scoring.
 *
 * Uses real git repos in temp directories and verifies filesystem outcomes.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  ensureRepo,
  checkCollision,
  findExistingPromotedDir,
  suggestUniqueName,
  scoreForCommand,
  writeMeta,
  ensureExclude,
} from "../src/repo.ts";
import { run } from "../src/util.ts";
import { resolveRepo } from "../src/git.ts";
import type { RepoInfo } from "../src/types.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readlinkSync, realpathSync } from "node:fs";
import { readFile, access, lstat } from "node:fs/promises";

// Helper to compute expected atlas paths in assertions
function expectedReposDir() {
  const root = process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`;
  return join(root, "repos");
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

describe("scoreForCommand", () => {
  test("git commit scores 4", () => {
    expect(scoreForCommand("git commit -m 'msg'")).toBe(4);
  });

  test("git add scores 4", () => {
    expect(scoreForCommand("git add file.txt")).toBe(4);
  });

  test("git status scores 1", () => {
    expect(scoreForCommand("git status")).toBe(1);
  });

  test("git diff scores 2", () => {
    expect(scoreForCommand("git diff")).toBe(2);
  });

  test("git log scores 1", () => {
    expect(scoreForCommand("git log --oneline")).toBe(1);
  });

  test("git help scores 0", () => {
    expect(scoreForCommand("git help status")).toBe(0);
  });

  test("git --version scores 0", () => {
    expect(scoreForCommand("git --version")).toBe(0);
  });

  test("nvim scores 1", () => {
    expect(scoreForCommand("nvim file.ts")).toBe(1);
  });

  test("code scores 1", () => {
    expect(scoreForCommand("code .")).toBe(1);
  });

  test("claude-code scores 1", () => {
    expect(scoreForCommand("claude-code")).toBe(1);
  });

  test("ls scores 0", () => {
    expect(scoreForCommand("ls -la")).toBe(0);
  });

  test("cd scores 0", () => {
    expect(scoreForCommand("cd /tmp")).toBe(0);
  });

  test("alias gst resolves to git status (score 1)", () => {
    expect(scoreForCommand("gst")).toBe(1);
  });

  test("alias ga resolves to git add (score 4)", () => {
    expect(scoreForCommand("ga file.txt")).toBe(4);
  });

  test("alias gaa resolves to git add --all (score 4)", () => {
    expect(scoreForCommand("gaa")).toBe(4);
  });

  test("alias c resolves to code (score 1)", () => {
    expect(scoreForCommand("c .")).toBe(1);
  });

  test("alias vi resolves to nvim (score 1)", () => {
    expect(scoreForCommand("vi file.ts")).toBe(1);
  });

  test("leading/trailing whitespace ignored", () => {
    expect(scoreForCommand("  git commit  ")).toBe(4);
  });

  test("empty string scores 0", () => {
    expect(scoreForCommand("")).toBe(0);
  });
});

describe("suggestUniqueName", () => {
  test("generates stable name for same inputs", () => {
    const name1 = suggestUniqueName("sem", "github.com-user-sem");
    const name2 = suggestUniqueName("sem", "github.com-user-sem");
    expect(name1).toBe(name2);
    expect(name1).toMatch(/^sem-[a-f0-9]{4}$/);
  });

  test("generates different name for different ids", () => {
    const name1 = suggestUniqueName("sem", "id-a");
    const name2 = suggestUniqueName("sem", "id-b");
    expect(name1).not.toBe(name2);
  });
});

describe("ensureRepo basic promotion", () => {
  let tempDir: string;
  let repoDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-repo-test-")));
    repoDir = join(tempDir, "my-project");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir, "https://github.com/user/my-project.git");
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
    const result = await ensureRepo(repoDir);
    expect(result).not.toBeNull();
    expect(result!.changed).toBe(true);

    const atlasDir = join(expectedReposDir(), "my-project");
    expect(existsSync(atlasDir)).toBe(true);
    expect(existsSync(join(atlasDir, "meta.json"))).toBe(true);

    const linkPath = join(repoDir, "atlas");
    expect(existsSync(linkPath)).toBe(true);
    expect(readlinkSync(linkPath)).toBe(atlasDir);
  });

  test("is idempotent on second run", async () => {
    await ensureRepo(repoDir);
    const result = await ensureRepo(repoDir);
    expect(result!.changed).toBe(false);
  });

  test("writes correct meta.json", async () => {
    await ensureRepo(repoDir);
    const metaPath = join(expectedReposDir(), "my-project", "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    expect(meta.repoId).toBe("my-project");
    expect(meta.id).toBe("github.com-user-my-project");
    expect(meta.repoRoot).toBe(repoDir);
    expect(meta.remoteUrl).toBe("https://github.com/user/my-project.git");
    expect(meta.updatedAt).toBeTruthy();
  });

  test("adds atlas to .git/info/exclude", async () => {
    await ensureRepo(repoDir);
    const excludePath = join(repoDir, ".git", "info", "exclude");
    const content = await readFile(excludePath, "utf8");
    expect(content).toContain("\natlas\n");
  });

  test("does not duplicate exclude entry", async () => {
    await ensureRepo(repoDir);
    await ensureRepo(repoDir);
    const excludePath = join(repoDir, ".git", "info", "exclude");
    const content = await readFile(excludePath, "utf8");
    const matches = content.split("atlas").length - 1;
    expect(matches).toBe(1);
  });

  test("returns null outside git repo", async () => {
    const outside = join(tempDir, "not-a-repo");
    mkdirSync(outside, { recursive: true });
    const result = await ensureRepo(outside);
    expect(result).toBeNull();
  });
});

describe("ensureRepo content migration", () => {
  let tempDir: string;
  let repoDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-migrate-test-")));
    repoDir = join(tempDir, "project-with-content");
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

  test("copies plans/ and notes/ from repo root", async () => {
    mkdirSync(join(repoDir, "plans"), { recursive: true });
    writeFileSync(join(repoDir, "plans", "01.md"), "# Plan 1");
    mkdirSync(join(repoDir, "notes"), { recursive: true });
    writeFileSync(join(repoDir, "notes", "today.md"), "Daily notes");

    await ensureRepo(repoDir);

    const atlasDir = join(expectedReposDir(), "project-with-content");
    expect(existsSync(join(atlasDir, "plans", "01.md"))).toBe(true);
    expect(existsSync(join(atlasDir, "notes", "today.md"))).toBe(true);
  });

  test("copies only existing directories", async () => {
    mkdirSync(join(repoDir, "plans"), { recursive: true });
    writeFileSync(join(repoDir, "plans", "plan.md"), "Plan");

    await ensureRepo(repoDir);

    const atlasDir = join(expectedReposDir(), "project-with-content");
    expect(existsSync(join(atlasDir, "plans", "plan.md"))).toBe(true);
    expect(existsSync(join(atlasDir, "notes"))).toBe(false);
  });

  test("migrates existing atlas/ directory with content", async () => {
    // Create an existing atlas directory in the repo
    const existingAtlas = join(repoDir, "atlas");
    mkdirSync(join(existingAtlas, "plans"), { recursive: true });
    writeFileSync(join(existingAtlas, "plans", "legacy.md"), "Legacy plan");
    mkdirSync(join(existingAtlas, "notes"), { recursive: true });
    writeFileSync(join(existingAtlas, "notes", "old.md"), "Old note");
    // Also add root-level content
    mkdirSync(join(repoDir, "plans"), { recursive: true });
    writeFileSync(join(repoDir, "plans", "new.md"), "New plan");

    await ensureRepo(repoDir);

    const atlasDir = join(expectedReposDir(), "project-with-content");
    // Both existing atlas content and root content should be present
    expect(existsSync(join(atlasDir, "plans", "legacy.md"))).toBe(true);
    expect(existsSync(join(atlasDir, "plans", "new.md"))).toBe(true);
    expect(existsSync(join(atlasDir, "notes", "old.md"))).toBe(true);
    // The old atlas directory should be replaced by a symlink
    const linkPath = join(repoDir, "atlas");
    const stat = await lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });
});

describe("collision detection", () => {
  let tempDir: string;
  let repoDir1: string;
  let repoDir2: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-collision-test-")));
    repoDir1 = join(tempDir, "sem");
    repoDir2 = join(tempDir, "other", "sem");
    mkdirSync(repoDir1, { recursive: true });
    mkdirSync(repoDir2, { recursive: true });
    await makeGitRepo(repoDir1, "https://github.com/user1/sem.git");
    await makeGitRepo(repoDir2, "https://github.com/user2/sem.git");
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

  test("detects collision when different repo uses same name", async () => {
    // Promote first repo
    const repo1 = await resolveRepo(repoDir1);
    await ensureRepo(repoDir1, repo1!);

    // Second repo should detect collision
    const repo2 = await resolveRepo(repoDir2);
    const collides = await checkCollision(repo2!.repoId, repo2!.id);
    expect(collides).toBe(true);
  });

  test("no collision for same repo", async () => {
    const repo1 = await resolveRepo(repoDir1);
    await ensureRepo(repoDir1, repo1!);

    const collides = await checkCollision(repo1!.repoId, repo1!.id);
    expect(collides).toBe(false);
  });

  test("findExistingPromotedDir finds already-promoted repo", async () => {
    const repo1 = await resolveRepo(repoDir1);
    await ensureRepo(repoDir1, repo1!);

    const found = await findExistingPromotedDir(repo1!);
    expect(found).not.toBeNull();
    expect(found).toContain("sem");
  });

  test("findExistingPromotedDir returns null for un-promoted repo", async () => {
    const repo2 = await resolveRepo(repoDir2);
    const found = await findExistingPromotedDir(repo2!);
    expect(found).toBeNull();
  });
});
