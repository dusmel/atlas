import { describe, expect, test } from "bun:test";
import { railView } from "../src/timeline-rail.ts";
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

describe("railView", () => {
  const line = (text: string, kind: string | null = null, day: string | null = "2026-11-08") => ({ day, text, source: kind === "waiting" ? "note" : "git", ref: kind === "waiting" ? null : "abc1234", kind });
  const entry = (id: string, state: string, lines = [line("Keep records")]) => ({ entry: id, state, title: `**${id}** title`, merged: state === "done", note: "", note_state: "none", lines, started_at: "2026-11-08", ended_at: "2026-11-08" });
  const entries = [entry("phase-1", "done"), entry("phase-2", "doing"), entry("next", "todo", [line("Decide the accent"), line("Review the PRs", "waiting", null)])];
  const rail = railView({ name: "Alts", sub: "alts · branches v1/*" }, entries as never, { width: 60, color: false }).split("\n");

  test("one dot per entry: done, now, next, in order", () => {
    expect(rail.filter((l) => /^[●◐○◌] /.test(l))).toEqual(["●  8 Nov · merged · id phase-1", "◐  now · id phase-2", "○  next · id next"]);
  });

  test("a solid line up to now, a dotted one after, none under the last entry", () => {
    expect(rail[rail.indexOf("●  8 Nov · merged · id phase-1") + 1]).toStartWith("│  ");
    expect(rail[rail.indexOf("◐  now · id phase-2") + 1]).toStartWith("┊  ");
    expect(rail[rail.indexOf("○  next · id next") + 1]).toStartWith("   ");
  });

  test("what waits on you comes first, at the top and in its entry", () => {
    expect(rail.slice(2, 5)).toEqual(["", "Waits on you", "  ▸ Review the PRs (next title)"]);
    const next = rail.slice(rail.indexOf("○  next · id next"));
    expect(next[2]).toBe("   • You: Review the PRs  note");
    expect(next[3]).toBe("   • Decide the accent  git abc1234");
  });

  test("titles keep their markdown and a line never turns into a list", () => {
    expect(rail).toContain("│  phase-1 title");
    const odd = railView({ name: "x", sub: "y" }, [entry("p", "done", [line("- 1. not a list")])] as never, { width: 60, color: false });
    expect(odd).toContain("• - 1. not a list  git abc1234");
  });

  test("colour only when asked, and every row fits the width", () => {
    expect(rail.join("\n")).not.toContain("\x1b[");
    const coloured = railView({ name: "Alts", sub: "alts" }, entries as never, { width: 60, color: true });
    expect(coloured).toContain("\x1b[32m●");
    expect(coloured.split("\n").every((l) => Bun.stringWidth(l) <= 60)).toBe(true);
  });
});
