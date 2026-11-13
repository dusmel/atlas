import { expect, test } from "bun:test";
import { trigger, type HookInput } from "../src/timeline-hook.ts";

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
