/**
 * `atlas todo` against the real web server, built and started on a random port
 * with a temp database and a temp store.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRepo } from "../src/git.ts";
import { run } from "../src/util.ts";

const ROOT = join(import.meta.dir, "../../..");
const CLI = join(ROOT, "apps/cli/index.ts");
const FIXTURE = join(ROOT, "packages/todos/test/fixtures/every-rule.md");

let server: ReturnType<typeof Bun.spawn>;
let url = "";
let token = "";
let tmp = "";
let store = "";
let repoDir = "";

beforeAll(async () => {
  const build = Bun.spawnSync(["bun", "run", "--cwd", "apps/web", "build"], { cwd: ROOT, stdout: "ignore", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(`web build failed: ${build.stderr}`);

  tmp = realpathSync(mkdtempSync(join(tmpdir(), "atlas-todo-test-")));
  store = join(tmp, "atlas-root");
  repoDir = join(tmp, "app");
  mkdirSync(repoDir);
  await run(["git", "init", "-q"], repoDir);
  await run(["git", "remote", "add", "origin", "https://github.com/me/app.git"], repoDir);
  const repo = (await resolveRepo(repoDir))!;
  mkdirSync(join(store, "repos", "app"), { recursive: true });
  writeFileSync(join(store, "repos", "app", "meta.json"), JSON.stringify({ repoId: "app", id: repo.id }));
  copyFileSync(FIXTURE, join(store, "repos", "app", "TODO.md"));

  const data = join(tmp, "data");
  server = Bun.spawn(["bun", "apps/web/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", ATLAS_DATA_DIR: data, ATLAS_PASSWORD_HASH_B64: "" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
  let out = "";
  while (!/listening on (\S+)/.test(out)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`server exited: ${out}`);
    out += new TextDecoder().decode(value);
  }
  url = /listening on (\S+)/.exec(out)![1]!.replace(/\/$/, "");
  await fetch(`${url}/api/health`); // opens and migrates the database

  token = `atl_test${crypto.randomUUID().replace(/-/g, "")}`;
  const db = new Database(join(data, "atlas.db"));
  db.run("INSERT INTO api_tokens (name, hash, created_at) VALUES (?, ?, ?)", ["test-mac", new Bun.CryptoHasher("sha256").update(token).digest("hex"), new Date().toISOString()]);
  db.close();
}, 60_000);

afterAll(() => {
  server?.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function cli(args: string[], opts: { cwd?: string; stdin?: string; env?: Record<string, string> } = {}) {
  const p = Bun.spawn(["bun", CLI, "todo", ...args], {
    cwd: opts.cwd ?? tmp,
    env: { ...process.env, ATLAS_URL: url, ATLAS_TOKEN: token, ATLAS_ROOT: store, ...opts.env },
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}

const json = async (args: string[], opts?: Parameters<typeof cli>[1]) => {
  const r = await cli([...args, "--json"], opts);
  if (r.code !== 0) throw new Error(`atlas todo ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return JSON.parse(r.out);
};

describe("atlas todo", () => {
  test("add lands in Inbox of the current directory's repo, and list prints aligned lines", async () => {
    const added = await json(["add", "Write", "the", "docs"], { cwd: repoDir });
    expect(added).toMatchObject({ title: "Write the docs", priority: null, status: "todo", repo_name: "app" });
    const r = await cli(["list"], { cwd: repoDir });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(`In  #${added.id}  todo   Write the docs`);
  });

  test("--body - reads stdin, and show prints the body and history", async () => {
    const added = await json(["add", "With body", "--repo", "app", "--priority", "P1", "--body", "-"], { stdin: "line one\nline two\n" });
    const r = await cli(["show", String(added.id)]);
    expect(r.out).toContain("P1 · todo · app");
    expect(r.out).toContain("  line one\n  line two");
    expect(r.out).toMatch(/cli:\S+|token:test-mac/);
  });

  test("groups, move, start, done and archive", async () => {
    await json(["group", "add", "Launch", "--repo", "app", "--doc", "plan.html"]);
    const a = await json(["add", "A", "--repo", "app", "--priority", "P0", "--group", "Launch"]);
    const b = await json(["add", "B", "--repo", "app", "--priority", "P0"]);
    await json(["move", String(b.id), "--before", String(a.id)]);
    const lane = async () => (await json(["list", "--repo", "app", "--priority", "P0"])).map((i: { title: string }) => i.title);
    expect(await lane()).toEqual(["B", "A"]);
    expect((await json(["start", String(a.id)])).status).toBe("doing");
    expect((await json(["done", String(a.id)])).done_at).not.toBeNull();
    expect(await lane()).toEqual(["B"]);
    await json(["archive", String(b.id)]);
    expect(await lane()).toEqual([]);
    const groups = await cli(["groups", "--repo", "app"]);
    expect(groups.out).toContain("Launch  → plan.html");
  });

  test("set clears with none and inbox", async () => {
    const a = await json(["add", "Clear me", "--repo", "app", "--priority", "P2"]);
    const set = await json(["set", String(a.id), "--priority", "inbox", "--title", "Cleared"]);
    expect(set).toMatchObject({ priority: null, title: "Cleared" });
  });

  test("--personal and --all", async () => {
    await json(["add", "Mine", "--personal"]);
    const all = await cli(["list", "--all"]);
    expect(all.out).toContain("personal");
    expect(all.out).toContain("app");
  });
});

describe("exit codes", () => {
  test("2 for usage, 1 for the server refusing, 3 for a bad token, 4 when unreachable", async () => {
    expect((await cli(["list", "--nope"])).code).toBe(2);
    expect((await cli(["list"])).code).toBe(2); // not in a promoted repo
    const refused = await cli(["add", "x", "--repo", "app", "--group", "Typo"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("atlas todo group add");
    const bad = await cli(["list", "--all"], { env: { ATLAS_TOKEN: "atl_wrong" } });
    expect(bad.code).toBe(3);
    expect(bad.err).toContain("Token rejected");
    expect((await cli(["list", "--all"], { env: { ATLAS_URL: "http://127.0.0.1:9" } })).code).toBe(4);
  });
});

describe("atlas todo import", () => {
  test("a dry run reports PASS and changes nothing", async () => {
    const r = await cli(["import"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("app/TODO.md  PASS");
    expect(r.out).toContain("Nothing was changed");
    expect(readFileSync(join(store, "repos", "app", "TODO.md"), "utf8")).toBe(readFileSync(FIXTURE, "utf8"));
  });

  test("--apply imports, check 4 passes against the server, and a second apply is refused", async () => {
    const [result] = await json(["import", "--apply"]);
    expect(result.applied.stored_check).toEqual([]);
    expect(result.report.items).toBe(11);
    const again = await cli(["import", "--apply"]);
    expect(again.code).toBe(1);
    expect(again.out).toContain("already imported");
  });
});
