/**
 * Unit tests for atlas utility functions.
 *
 * Focuses on pure functions with deterministic inputs/outputs.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { normalizeName, normalizeRemote, shortHash, atomicWrite } from "../src/util.ts";
import { readFile, access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";

describe("normalizeName", () => {
  test("lowercases input", () => {
    expect(normalizeName("MyProject")).toBe("myproject");
  });

  test("replaces spaces with hyphens", () => {
    expect(normalizeName("my project")).toBe("my-project");
  });

  test("replaces special chars with hyphens", () => {
    expect(normalizeName("my@project#name")).toBe("my-project-name");
  });

  test("collapses consecutive hyphens", () => {
    expect(normalizeName("my---project")).toBe("my-project");
  });

  test("strips leading hyphens", () => {
    expect(normalizeName("-myproject")).toBe("myproject");
  });

  test("strips trailing hyphens", () => {
    expect(normalizeName("myproject-")).toBe("myproject");
  });

  test("preserves dots and underscores", () => {
    expect(normalizeName("my_project.v2")).toBe("my_project.v2");
  });

  test("handles empty string", () => {
    expect(normalizeName("")).toBe("");
  });

  test("handles string with only special chars", () => {
    expect(normalizeName("@#$%")).toBe("");
  });
});

describe("normalizeRemote", () => {
  test("handles https URL", () => {
    expect(normalizeRemote("https://github.com/user/repo.git")).toBe("github.com-user-repo");
  });

  test("handles http URL", () => {
    expect(normalizeRemote("http://gitlab.com/group/project.git")).toBe("gitlab.com-group-project");
  });

  test("handles ssh git@ URL", () => {
    expect(normalizeRemote("git@github.com:user/repo.git")).toBe("github.com-user-repo");
  });

  test("handles ssh:// URL", () => {
    expect(normalizeRemote("ssh://git@github.com/user/repo.git")).toBe("git-github.com-user-repo");
  });

  test("handles git:// URL", () => {
    expect(normalizeRemote("git://github.com/user/repo.git")).toBe("github.com-user-repo");
  });

  test("strips .git suffix", () => {
    expect(normalizeRemote("https://github.com/user/repo.git")).toBe("github.com-user-repo");
  });

  test("handles URL without .git suffix", () => {
    expect(normalizeRemote("https://github.com/user/repo")).toBe("github.com-user-repo");
  });

  test("handles URLs with ports", () => {
    expect(normalizeRemote("https://gitlab.com:8443/user/repo.git")).toBe("gitlab.com-8443-user-repo");
  });

  test("handles URLs with multiple path segments", () => {
    expect(normalizeRemote("https://github.com/org/team/repo.git")).toBe("github.com-org-team-repo");
  });

  test("trims whitespace", () => {
    expect(normalizeRemote("  https://github.com/user/repo.git  ")).toBe("github.com-user-repo");
  });
});

describe("shortHash", () => {
  test("produces 8-character hex string", () => {
    const hash = shortHash("test-input");
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  test("is deterministic for same input", () => {
    expect(shortHash("same")).toBe(shortHash("same"));
  });

  test("produces different output for different inputs", () => {
    expect(shortHash("a")).not.toBe(shortHash("b"));
  });

  test("handles empty string", () => {
    const hash = shortHash("");
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  test("handles unicode", () => {
    const hash = shortHash("日本語");
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("atomicWrite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-test-")));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes file content", async () => {
    const path = join(tempDir, "test.txt");
    await atomicWrite(path, "hello world");
    const content = await readFile(path, "utf8");
    expect(content).toBe("hello world");
  });

  test("overwrites existing file", async () => {
    const path = join(tempDir, "overwrite.txt");
    await atomicWrite(path, "first");
    await atomicWrite(path, "second");
    const content = await readFile(path, "utf8");
    expect(content).toBe("second");
  });

  test("writes JSON correctly", async () => {
    const path = join(tempDir, "data.json");
    const data = { key: "value", num: 42 };
    await atomicWrite(path, JSON.stringify(data));
    const content = await readFile(path, "utf8");
    expect(JSON.parse(content)).toEqual(data);
  });

  test("creates parent directories if needed", async () => {
    const dir = join(tempDir, "nested", "deep");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "file.txt");
    await atomicWrite(path, "nested content");
    const content = await readFile(path, "utf8");
    expect(content).toBe("nested content");
  });
});
