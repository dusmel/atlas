import { describe, expect, test } from "bun:test"
import { buildEntries, entryIdFor, type TodoItem } from "../src/build"
import type { BranchWork } from "../src/git"

const c = (day: string, subject: string, short = subject.slice(0, 7)) => ({ hash: short, short, at: `${day}T10:00:00+02:00`, day, subject })
const work: BranchWork[] = [
  { branch: "v1/1-marks", commits: [c("2026-11-05", "Add marks"), c("2026-11-05", "Add flipping")] },
  { branch: "v1/2-ai", commits: [c("2026-11-05", "Add AI rows")] },
  { branch: "v1/3-polish", commits: [c("2026-11-08", "Keep records"), c("2026-11-12", "Virtual monitor")] },
]
const todo = (id: number, title: string, status: TodoItem["status"], extra: Partial<TodoItem> = {}): TodoItem => ({
  id,
  title,
  status,
  parent_id: null,
  done_at: status === "done" ? "2026-11-05T20:00:00Z" : null,
  updated_at: "2026-11-12T09:00:00Z",
  ...extra,
})
const plan = "## Phase 1: Marks {#phase-1}\n## Phase 2: AI {#phase-2}\n## Polish after first use {#polish}\n"

test("entryIdFor prefers phase-N, then the plan's anchor for the slug", () => {
  const anchors = new Set(["phase-1", "polish"])
  expect(entryIdFor("v1/1-marks", anchors)).toBe("phase-1")
  expect(entryIdFor("v1/3-polish", anchors)).toBe("polish")
  expect(entryIdFor("v1/4-extra", anchors)).toBe("phase-4")
  expect(entryIdFor("feature/search", anchors)).toBe("search")
})

describe("buildEntries", () => {
  test("one entry per branch, earlier ones done, the newest doing, titles from the plan", () => {
    const entries = buildEntries({ work, todos: [], files: { plan } })
    expect(entries.map((e) => [e.entry, e.state, e.title])).toEqual([
      ["phase-1", "done", "Phase 1: Marks"],
      ["phase-2", "done", "Phase 2: AI"],
      ["polish", "doing", "Polish after first use"],
    ])
    expect(entries[2]!.lines.map((l) => [l.day, l.text, l.source])).toEqual([
      ["2026-11-08", "Keep records", "git"],
      ["2026-11-12", "Virtual monitor", "git"],
    ])
    expect(entries[2]).toMatchObject({ started_at: "2026-11-08T10:00:00+02:00", ended_at: "2026-11-12T10:00:00+02:00" })
  })

  test("todos: phase todos set state, doing goes on the open entry, todo goes to Next", () => {
    const todos = [
      todo(555, "Phase 1: Keep and flip", "done"),
      todo(556, "Phase 2: AI that teaches", "done"),
      todo(557, "Bring the first row under 1.5 s", "doing"),
      todo(558, "Reject typo fixes that swap words", "todo"),
    ]
    const entries = buildEntries({ work, todos, files: { plan } })
    expect(entries.map((e) => [e.entry, e.state])).toEqual([["phase-1", "done"], ["phase-2", "done"], ["polish", "doing"], ["next", "todo"]])
    expect(entries[2]!.lines.at(-1)).toEqual({ day: "2026-11-12", text: "Bring the first row under 1.5 s", source: "todo", ref: "557", kind: "doing" })
    expect(entries[3]!.lines).toEqual([{ day: null, text: "Reject typo fixes that swap words", source: "todo", ref: "558", kind: "next" }])
  })

  test("a phase todo with no branch yet is a to-do entry, and its boxes are its lines", () => {
    const todos = [todo(10, "Phase 4: Panel", "todo"), todo(11, "Measure CPU", "todo", { parent_id: 10 }), todo(12, "Add the view", "done", { parent_id: 10 })]
    const entries = buildEntries({ work: [], todos })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entry: "phase-4", state: "todo", title: "Phase 4: Panel" })
    expect(entries[0]!.lines.map((l) => [l.text, l.kind])).toEqual([["Add the view", null], ["Measure CPU", "todo"]])
  })

  test("with no doing branch, doing todos open a now entry named from run.md", () => {
    const todos = [todo(1, "Phase 1: Marks", "done"), todo(2, "Write the report", "doing")]
    const entries = buildEntries({ work: work.slice(0, 1), todos, files: { runMd: "Now: closing the run\n" } })
    expect(entries.map((e) => [e.entry, e.state, e.title])).toEqual([["phase-1", "done", "Phase 1: Marks"], ["now", "doing", "closing the run"]])
  })

  test("run.md's open stretch and parked items go on the doing entry", () => {
    const entries = buildEntries({ work, todos: [], files: { runMd: "Now: closing PR 3\nParked:\n- Deploy - production pauses\n" } })
    expect(entries[2]!.lines.filter((l) => l.source === "run").map((l) => [l.text, l.kind])).toEqual([["closing PR 3", "now"], ["Deploy - production pauses", "parked"]])
  })

  test("timeline.md adds notes, waiting and next items, overrides state, and adds its own entries", () => {
    const timelineMd = `## polish {state: doing}
note: Records are never deleted now.
waiting: #557 pick a target
next: You install the polish

## phase-2
note: draft

## later {state: todo, title: "After v1"}
next: Use it for a week
`
    const entries = buildEntries({ work, todos: [todo(9, "Ship it", "todo")], files: { plan, timelineMd } })
    expect(entries.map((e) => e.entry)).toEqual(["phase-1", "phase-2", "polish", "later", "next"])
    const polish = entries[2]!
    expect(polish).toMatchObject({ note: "Records are never deleted now.", note_state: "written" })
    expect(polish.lines.filter((l) => l.source === "note").map((l) => [l.text, l.kind])).toEqual([["#557 pick a target", "waiting"], ["You install the polish", "next"]])
    expect(entries[1]).toMatchObject({ note: "", note_state: "draft" })
    expect(entries[0]!.note).toBeUndefined()
    expect(entries[3]).toMatchObject({ title: "After v1", state: "todo" })
  })

  test("PRs: a line at the end of the entry; merged marks the entry done and merged", () => {
    const prs = [
      { number: 1, branch: "v1/1-marks", state: "MERGED", url: "https://x/pull/1", mergedAt: "2026-11-06T08:00:00Z" },
      { number: 3, branch: "v1/3-polish", state: "OPEN", url: "https://x/pull/3", mergedAt: null },
    ]
    const entries = buildEntries({ work, todos: [], prs })
    expect(entries[0]).toMatchObject({ merged: true, state: "done" })
    expect(entries[0]!.lines.at(-1)).toEqual({ day: "2026-11-06", text: "PR 1", source: "git", ref: "https://x/pull/1", kind: "pr-merged" })
    expect(entries[2]).toMatchObject({ merged: false, state: "doing" })
    expect(entries[2]!.lines.at(-1)).toMatchObject({ text: "PR 3", kind: "pr" })
  })

  test("evidence goes on the entry with its name, the report on the entry it was written in", () => {
    const entries = buildEntries({
      work,
      todos: [],
      files: { plan, evidence: [{ name: "phase-2", day: "2026-11-05" }, { name: "unknown", day: "2026-11-05" }], report: { path: "report.html", day: "2026-11-05" } },
    })
    expect(entries[1]!.lines.find((l) => l.kind === "evidence")).toEqual({ day: "2026-11-05", text: "Evidence: phase-2", source: "doc", ref: "evidence/phase-2/", kind: "evidence" })
    expect(entries.flatMap((e) => e.lines).filter((l) => l.kind === "report").length).toBe(1)
    expect(entries.flatMap((e) => e.lines).some((l) => l.text.includes("unknown"))).toBe(false)
  })
})
