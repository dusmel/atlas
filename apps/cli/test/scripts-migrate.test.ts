/**
 * Behavioral tests for scripts/migrate-promoted-dirs.ts.
 *
 * Uses temp ATLAS_ROOT stores with hand-written meta.json fixtures plus real
 * git repos, and verifies filesystem outcomes (rename / meta / symlink).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { planMigrate, runMigrate } from "../scripts/migrate-promoted-dirs.ts";
import { normalizeRemote } from "../src/util.ts";
import { suggestUniqueName } from "../src/repo.ts";
import { run } from "../src/util.ts";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readlinkSync, realpathSync } from "node:fs";
import { readFile, symlink } from "node:fs/promises";

function reposDir() {
  const root = process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`;
  return join(root, "repos");
}

async function makeGitRepo(dir: string, remote?: string) {
  await run(["git", "init"], dir);
  await run(["git", "config", "user.email", "test@example.com"], dir);
  await run(["git", "config", "user.name", "Test User"], dir);
  if (remote) await run(["git", "remote", "add", "origin", remote], dir);
  writeFileSync(join(dir, "README.md"), "# test");
  await run(["git", "add", "README.md"], dir);
  await run(["git", "commit", "-m", "init"], dir);
}

function writePromoted(name: string, meta: Record<string, string>) {
  const dir = join(reposDir(), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  return dir;
}

describe("migrate-promoted-dirs", () => {
  let tempDir: string;
  let oldAtlasRoot: string | undefined;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-migrate-script-")));
    oldAtlasRoot = process.env.ATLAS_ROOT;
    process.env.ATLAS_ROOT = join(tempDir, "atlas-root");
  });

  afterEach(() => {
    if (oldAtlasRoot !== undefined) process.env.ATLAS_ROOT = oldAtlasRoot;
    else delete process.env.ATLAS_ROOT;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("migrates old remote-based name to local basename", async () => {
    const repoDir = join(tempDir, "my-project");
    mkdirSync(repoDir, { recursive: true });
    const remote = "https://github.com/user/my-project.git";
    await makeGitRepo(repoDir, remote);

    const oldName = normalizeRemote(remote);
    expect(oldName).not.toBe("my-project");
    writePromoted(oldName, {
      repoId: oldName,
      id: oldName,
      repoRoot: repoDir,
      remoteUrl: remote,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const dry = await planMigrate();
    expect(dry.find((e) => e.current === oldName)?.status).toBe("renamed");
    expect(dry.find((e) => e.current === oldName)?.target).toBe("my-project");
    expect(existsSync(join(reposDir(), oldName))).toBe(true);

    const applied = await runMigrate({ apply: true });
    expect(applied.find((e) => e.current === oldName)?.status).toBe("renamed");
    expect(existsSync(join(reposDir(), oldName))).toBe(false);
    expect(existsSync(join(reposDir(), "my-project", "meta.json"))).toBe(true);

    const meta = JSON.parse(await readFile(join(reposDir(), "my-project", "meta.json"), "utf8"));
    expect(meta.repoId).toBe("my-project");
    expect(readlinkSync(join(repoDir, "atlas"))).toBe(join(reposDir(), "my-project"));
  });

  test("leaves correct names alone", async () => {
    const repoDir = join(tempDir, "fine");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir);
    writePromoted("fine", {
      repoId: "fine",
      id: `fine-${"0".repeat(8)}`,
      repoRoot: repoDir,
      remoteUrl: "",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const plan = await planMigrate();
    expect(plan.find((e) => e.current === "fine")?.status).toBe("ok");

    const applied = await runMigrate({ apply: true });
    expect(existsSync(join(reposDir(), "fine"))).toBe(true);
    expect(applied.find((e) => e.current === "fine")?.status).toBe("ok");
  });

  test("uses suggested name when ideal is taken by another repo", async () => {
    const repo1 = join(tempDir, "dup");
    mkdirSync(repo1, { recursive: true });
    await makeGitRepo(repo1, "https://github.com/a/dup.git");
    writePromoted("dup", {
      repoId: "dup",
      id: "github.com-a-dup",
      repoRoot: repo1,
      remoteUrl: "https://github.com/a/dup.git",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const repo2 = join(tempDir, "elsewhere", "dup");
    mkdirSync(repo2, { recursive: true });
    const remote2 = "https://github.com/b/dup.git";
    await makeGitRepo(repo2, remote2);
    const oldName2 = normalizeRemote(remote2);
    writePromoted(oldName2, {
      repoId: oldName2,
      id: oldName2,
      repoRoot: repo2,
      remoteUrl: remote2,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const plan = await planMigrate();
    const entry = plan.find((e) => e.current === oldName2);
    expect(entry?.status).toBe("renamed");
    // Target is the suggested disambiguated name for repo2's fresh id.
    const { resolveRepo } = await import("../src/git.ts");
    const fresh = (await resolveRepo(repo2))!;
    expect(entry?.target).toBe(suggestUniqueName("dup", fresh.id));

    await runMigrate({ apply: true });
    expect(existsSync(join(reposDir(), entry!.target, "meta.json"))).toBe(true);
    expect(readlinkSync(join(repo2, "atlas"))).toBe(join(reposDir(), entry!.target));
  });

  test("reports missing roots as stale without touching them", async () => {
    writePromoted("gone", {
      repoId: "gone",
      id: "gone-12345678",
      repoRoot: join(tempDir, "no-such-dir"),
      remoteUrl: "",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const plan = await planMigrate();
    expect(plan.find((e) => e.current === "gone")?.status).toBe("stale");

    await runMigrate({ apply: true });
    expect(existsSync(join(reposDir(), "gone", "meta.json"))).toBe(true);
  });

  test("keeps user custom names", async () => {
    const repoDir = join(tempDir, "proj");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir, "https://github.com/user/proj.git");
    writePromoted("my-custom", {
      repoId: "my-custom",
      id: "github.com-user-proj",
      repoRoot: repoDir,
      remoteUrl: "https://github.com/user/proj.git",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const plan = await planMigrate();
    const entry = plan.find((e) => e.current === "my-custom");
    expect(entry?.status).toBe("ok");
    expect(entry?.target).toBe("my-custom");
  });

  test("repairs wrong symlink and meta drift on apply", async () => {
    const repoDir = join(tempDir, "linked");
    mkdirSync(repoDir, { recursive: true });
    await makeGitRepo(repoDir);
    const dir = writePromoted("linked", {
      repoId: "WRONG",
      id: "linked-12345678",
      repoRoot: repoDir,
      remoteUrl: "",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await symlink(join(tmpdir(), basename(tempDir)), join(repoDir, "atlas"));

    await runMigrate({ apply: true });
    const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
    expect(meta.repoId).toBe("linked");
    expect(readlinkSync(join(repoDir, "atlas"))).toBe(dir);
  });

  test("--repo filter limits to one root", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    await makeGitRepo(a);
    await makeGitRepo(b);
    for (const [name, root] of [["a", a], ["b", b]] as const) {
      writePromoted(name, { repoId: name, id: `${name}-12345678`, repoRoot: root, remoteUrl: "", updatedAt: "2026-01-01T00:00:00Z" });
    }
    const plan = await planMigrate(a);
    expect(plan.map((e) => e.current)).toEqual(["a"]);
  });

  test("collapses suggested name back to ideal when collision is gone", async () => {
    const repoDir = join(tempDir, "soloproject");
    mkdirSync(repoDir, { recursive: true });
    const remote = "https://github.com/user/soloproject.git";
    await makeGitRepo(repoDir, remote);
    const { resolveRepo } = await import("../src/git.ts");
    const fresh = (await resolveRepo(repoDir))!;
    const suggested = suggestUniqueName("soloproject", fresh.id);
    expect(suggested).not.toBe("soloproject");
    // Squatter deleted already: only the disambiguated dir remains.
    writePromoted(suggested, {
      repoId: suggested,
      id: fresh.id,
      repoRoot: repoDir,
      remoteUrl: remote,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const plan = await planMigrate();
    const entry = plan.find((e) => e.current === suggested);
    expect(entry?.status).toBe("renamed");
    expect(entry?.target).toBe("soloproject");

    await runMigrate({ apply: true });
    expect(existsSync(join(reposDir(), suggested))).toBe(false);
    expect(existsSync(join(reposDir(), "soloproject", "meta.json"))).toBe(true);
    expect(readlinkSync(join(repoDir, "atlas"))).toBe(join(reposDir(), "soloproject"));
  });

  test("keeps suggested name while ideal is still taken", async () => {
    const repo1 = join(tempDir, "taken");
    mkdirSync(repo1, { recursive: true });
    await makeGitRepo(repo1, "https://github.com/a/taken.git");
    writePromoted("taken", {
      repoId: "taken",
      id: "github.com-a-taken",
      repoRoot: repo1,
      remoteUrl: "https://github.com/a/taken.git",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const repo2 = join(tempDir, "elsewhere", "taken");
    mkdirSync(repo2, { recursive: true });
    await makeGitRepo(repo2, "https://github.com/b/taken.git");
    const { resolveRepo } = await import("../src/git.ts");
    const fresh2 = (await resolveRepo(repo2))!;
    const suggested2 = suggestUniqueName("taken", fresh2.id);
    writePromoted(suggested2, {
      repoId: suggested2,
      id: fresh2.id,
      repoRoot: repo2,
      remoteUrl: "https://github.com/b/taken.git",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    const plan = await planMigrate();
    const entry = plan.find((e) => e.current === suggested2);
    expect(entry?.status).toBe("ok");
    expect(entry?.target).toBe(suggested2);
  });

  test("two entries collapsing onto one ideal: first wins, second conflicts", async () => {
    const { resolveRepo } = await import("../src/git.ts");
    for (const [sub, remote] of [["w1", "https://github.com/a/race.git"], ["w2", "https://github.com/b/race.git"]] as const) {
      const dir = join(tempDir, sub, "race");
      mkdirSync(dir, { recursive: true });
      await makeGitRepo(dir, remote);
      const fresh = (await resolveRepo(dir))!;
      const suggested = suggestUniqueName("race", fresh.id);
      writePromoted(suggested, {
        repoId: suggested,
        id: fresh.id,
        repoRoot: dir,
        remoteUrl: remote,
        updatedAt: "2026-01-01T00:00:00Z",
      });
    }

    const applied = await runMigrate({ apply: true });
    const renamed = applied.filter((e) => e.status === "renamed");
    const conflicted = applied.filter((e) => e.status === "conflict");
    expect(renamed).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect(renamed[0]?.target).toBe("race");
    expect(existsSync(join(reposDir(), "race", "meta.json"))).toBe(true);
  });
});
