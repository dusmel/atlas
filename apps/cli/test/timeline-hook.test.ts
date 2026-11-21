import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook, trigger, type HookInput, type Job, type Launch } from "../src/timeline-hook.ts";

const bash = (command: string): HookInput => ({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/w", tool_name: "Bash", tool_input: { command } });
const write = (tool_name: string, file_path: string): HookInput => ({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/w", tool_name, tool_input: { file_path } });

test("a commit, a todo start, done or add, and a write to run.md or timeline.md start a sync", () => {
  expect(trigger(bash('git commit -q -m "Log ships"'))).toEqual({ kind: "commit" });
  expect(trigger(bash("git -C /w/harbour commit --amend --no-edit"))).toEqual({ kind: "commit" });
  expect(trigger(bash("atlas todo done 41"))).toEqual({ kind: "todo" });
  expect(trigger(bash('ATLAS_AUTHOR=me atlas todo add "Paint the rail"'))).toEqual({ kind: "todo" });
  expect(trigger(bash("bun apps/cli/index.ts todo start 42"))).toEqual({ kind: "todo" });
  expect(trigger(write("Write", "/w/atlas/lamp/timeline.md"))).toEqual({ kind: "file", path: "/w/atlas/lamp/timeline.md" });
  expect(trigger(write("Edit", "/w/atlas/lamp/run.md"))).toEqual({ kind: "file", path: "/w/atlas/lamp/run.md" });
});

test("everything else does nothing", () => {
  expect(trigger(bash("git status"))).toBeNull();
  expect(trigger(bash("git log --grep commit"))).toBeNull();
  expect(trigger(bash("atlas todo list"))).toBeNull();
  expect(trigger(bash("echo todo done"))).toBeNull();
  expect(trigger(write("Write", "/w/atlas/lamp/plan.md"))).toBeNull();
  expect(trigger(write("Read", "/w/atlas/lamp/notrun.md"))).toBeNull();
  expect(trigger({ hook_event_name: "PostToolUse", session_id: "s", cwd: "/w", tool_name: "Bash", tool_input: {} })).toBeNull();
});

// runHook only reads and writes the state file and launches the background sync; HOME points at a
// scratch folder and the launch is recorded instead of run.
describe("runHook", () => {
  const home = process.env.HOME;
  let launches: { args: string[]; job: Job }[] = [];
  const launch: Launch = (args, stdin) => void launches.push({ args, job: JSON.parse(stdin!).job });
  const state = () => JSON.parse(readFileSync(join(process.env.HOME!, ".cache/atlas/timeline-hook.json"), "utf8"));
  const seed = (s: object) => { mkdirSync(join(process.env.HOME!, ".cache/atlas"), { recursive: true }); writeFileSync(join(process.env.HOME!, ".cache/atlas/timeline-hook.json"), JSON.stringify({ s: { synced: 0, asked: [], ...s } })); };
  const T0 = 1_800_000_000_000;
  const MIN = 60_000;

  beforeEach(() => { process.env.HOME = mkdtempSync(join(tmpdir(), "atlas-hook-")); launches = []; });
  afterEach(() => { process.env.HOME = home; });

  test("a tool call with no trigger, under 10 minutes after a sync, does nothing and starts nothing", async () => {
    seed({ synced: T0 });
    expect(await runHook(bash("git status"), T0 + 9 * MIN, launch)).toEqual({ out: null, did: null });
    expect(launches).toEqual([]);
  });

  test("a commit starts one background sync and returns without waiting for it", async () => {
    seed({ synced: T0 });
    const r = await runHook(bash('git commit -m "x"'), T0 + MIN, launch);
    expect(r.did).toBe("commit: sync started");
    expect(launches).toEqual([{ args: ["timeline", "hook"], job: { cwd: "/w", triggers: [{ kind: "commit" }], commands: [] } }]);
    expect(state().s).toMatchObject({ synced: T0 + MIN, running: T0 + MIN });
  });

  test("triggers that come while a sync runs are queued for it, once each", async () => {
    seed({ synced: T0, running: T0 });
    await runHook(bash("atlas todo done 41"), T0 + MIN, launch);
    await runHook(write("Edit", "/w/atlas/lamp/run.md"), T0 + 2 * MIN, launch);
    const r = await runHook(bash("atlas todo done 42"), T0 + 3 * MIN, launch);
    expect(r.did).toBe("todo: sync queued");
    expect(launches).toEqual([]);
    expect(state().s.queued).toEqual({ cwd: "/w", triggers: [{ kind: "todo" }, { kind: "file", path: "/w/atlas/lamp/run.md" }], commands: ["atlas todo done 41", "atlas todo done 42"] });
  });

  test("a long reply with no Stop syncs on any tool call 10 minutes after the last sync", async () => {
    seed({ synced: T0 });
    const r = await runHook(bash("ls"), T0 + 10 * MIN, launch);
    expect(r.did).toBe("10 minutes: sync started");
    expect(launches[0]!.job.triggers).toEqual([null]);
  });

  test("Stop syncs only 10 minutes after the last sync, in the background", async () => {
    seed({ synced: T0 });
    const stop = { hook_event_name: "Stop", session_id: "s", cwd: "/w" };
    expect(await runHook(stop, T0 + 5 * MIN, launch)).toEqual({ out: null, did: null });
    expect((await runHook(stop, T0 + 11 * MIN, launch)).did).toBe("sync started");
    expect(launches.length).toBe(1);
  });

  test("a sync that died without clearing its mark does not block the next one", async () => {
    seed({ synced: T0, running: T0 });
    expect((await runHook(bash('git commit -m "x"'), T0 + 6 * MIN, launch)).did).toBe("commit: sync started");
  });

  test("a note the sync asked for reaches the agent on its next tool call, once", async () => {
    seed({ synced: T0, asks: ["Entry `x` is a draft: write one sentence."] });
    const r = await runHook(bash("ls"), T0 + MIN, launch);
    expect(JSON.parse(r.out!).hookSpecificOutput).toEqual({ hookEventName: "PostToolUse", additionalContext: "Entry `x` is a draft: write one sentence." });
    expect(state().s.asks).toBeUndefined();
    expect((await runHook(bash("ls"), T0 + 2 * MIN, launch)).out).toBeNull();
  });
});
