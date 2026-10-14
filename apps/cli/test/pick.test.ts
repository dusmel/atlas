import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fuzzy, listDocs, rank, type Doc } from "../src/pick.ts";

const doc = (repo: string, path: string, current = false, mtime = 0): Doc => ({ repo, path, mtime, current });

describe("pick", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-pick-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("fuzzy takes the letters in order, tight, and scores word starts above the middle of a word", () => {
    expect(fuzzy("rbk", "runbook.md")).toMatchObject({ at: [0, 3, 6] });
    expect(fuzzy("kr", "runbook.md")).toBeNull();
    // The walk back keeps "spec" together instead of taking the first s and the first p.
    expect(fuzzy("spec", "sprint/web-spec.md")!.at).toEqual([11, 12, 13, 14]);
    expect(fuzzy("spec", "web-spec.md")!.score).toBeGreaterThan(fuzzy("spec", "webspec.md")!.score);
  });

  test("every term must match; the current repo wins a tie but not a clearly better match", () => {
    const docs = [doc("web", "runbook.md", true), doc("ops", "runbook.md"), doc("web", "notes/rain-bucket.md", true), doc("herdr", "cheatsheet.md")];
    expect(rank(docs, "runbook").map((h) => h.label)).toEqual(["runbook.md", "ops/runbook.md"]);
    expect(rank(docs, "herdr cheat").map((h) => h.label)).toEqual(["herdr/cheatsheet.md"]);
    expect(rank(docs, "rnbk")[0]!.label).toBe("runbook.md");
    expect(rank(docs, "rb nope")).toEqual([]);
  });

  test("with no query, the current repo comes first, newest first", () => {
    const docs = [doc("ops", "new.md", false, 9), doc("web", "old.md", true, 1), doc("web", "newer.md", true, 5)];
    expect(rank(docs, "").map((h) => h.label)).toEqual(["newer.md", "old.md", "ops/new.md"]);
  });

  test("lists md and html docs of every repo, and skips backups and dot folders", () => {
    for (const f of ["web/a.md", "web/sub/b.html", "web/c.png", "web/backups/d.md", "ops/e.md", ".hidden/f.md"]) {
      mkdirSync(join(root, f, ".."), { recursive: true });
      writeFileSync(join(root, f), "x");
    }
    const docs = listDocs(root, "web").map((d) => `${d.repo}/${d.path}${d.current ? " *" : ""}`);
    expect(docs.sort()).toEqual(["ops/e.md", "web/a.md *", "web/sub/b.html *"]);
  });
});
