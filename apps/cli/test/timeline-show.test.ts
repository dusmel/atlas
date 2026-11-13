import { expect, test } from "bun:test";
import { showMarkdown } from "../src/timeline.ts";

test("each entry heading names the entry id that `atlas timeline note` takes", () => {
  const entry = { entry: "phase-1", state: "done", title: "Phase 1: Log ships", merged: true, note: "", note_state: "none", lines: [], started_at: "2026-11-03", ended_at: "2026-11-04" };
  const md = showMarkdown({ name: "Harbour", repo_name: "web", branches: "v1/*" }, [entry] as never);
  expect(md.split("\n")).toContain("## Phase 1: Log ships · done · merged · 3 Nov to 4 Nov · id `phase-1`");
});

test("a day line titles its day and is not listed itself", () => {
  const line = (day: string, text: string, kind: string | null, source = "git", ref: string | null = "abc1234") => ({ day, text, source, ref, kind });
  const entry = {
    entry: "polish", state: "doing", title: "Polish", merged: false, note: "", note_state: "none", started_at: "2026-11-08", ended_at: "2026-11-09",
    lines: [line("2026-11-08", "Keep records", null), line("2026-11-08", "First days in your vault", "day", "session", "s1"), line("2026-11-09", "Virtual monitor", "unpushed")],
  };
  const md = showMarkdown({ name: "Alts", repo_name: "alts", branches: "v1/*" }, [entry] as never).split("\n");
  expect(md).toContain("8 Nov: First days in your vault:");
  expect(md).toContain("9 Nov:");
  expect(md).toContain("- Virtual monitor (unpushed)  `git abc1234`");
  expect(md.filter((l) => l.includes("First days")).length).toBe(1);
});
