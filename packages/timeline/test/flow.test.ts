import { describe, expect, test } from "bun:test"
import { buildEntries, type Entry, type TodoItem } from "../src/build"
import { readCanvases, readDecisions, readRunFlow, type EffortDoc, type SessionDays } from "../src/flow"
import type { BranchWork } from "../src/git"

// One small effort with every kind of work around its build. Times are Kigali (+02:00).
const commit = (at: string, subject: string, short: string) => ({ hash: short, short, at, day: at.slice(0, 10), subject })
const work: BranchWork[] = [
  { branch: "t/1-store", commits: [commit("2026-11-12T21:00:00+02:00", "Add the store", "aaa1111"), commit("2026-11-13T10:00:00+02:00", "Fix the next section", "aaa2222")] },
  { branch: "t/2-sessions", commits: [commit("2026-11-13T08:00:00+02:00", "Read sessions", "bbb1111")] },
]
const todo = (id: number, title: string, status: TodoItem["status"], done_at: string | null = null): TodoItem => ({ id, title, status, parent_id: null, done_at, updated_at: "2026-11-13T09:00:00Z" })
const todos = [todo(1, "Phase 1: Store", "done", "2026-11-13T07:00:00Z"), todo(2, "Phase 2: Sessions", "done", "2026-11-13T07:20:00Z"), todo(7, "Pick the accent", "done", "2026-11-12T16:00:00Z")]
const plan = "## Phase 1: Store {#phase-1}\n## Phase 2: Sessions {#phase-2}\n"
const design = `# Design

You picked this look on [the looks canvas](https://claude.ai/artifact/abc) on 2026-11-12.

## Decision log {#decisions}

| # | decision | rejected |
|---|---|---|
| T1 | Entries live in a table | A file |
| T13 | The view is the rail. Picked by the owner on 2026-11-12 | Columns |
| T17 | Sign-off on 2026-11-12, with the open questions settled | none |
| T18 | Entries follow the flow of work. Asked for on 2026-11-13 | One per day |
| 5 | Port from the replica at a fixed commit | The replica changed on 2026-11-05 |
`
const runMd = `Status: running

Round 1 (2026-11-12):

| # | decision |
|---|---|
| Q1 | Both a file and a table |
| Q2 | The best trigger |

| step | state |
|---|---|
| 6. Sign-off | done 2026-11-12: owner wrote "go" |

| # | default | why |
|---|---|---|
| P1-repo | a group gains a branch pattern | it has a repo |
| P1-entries | one entry per branch | stacked |
| D-accent | the current accent | not switched |

## Phases 5 to 9 (added 2026-11-13)
`
const docs: EffortDoc[] = [
  { path: "design.html", title: "Atlas timeline", type: "design", created: "2026-11-12T19:55+02:00" },
  { path: "plan.html", title: "Atlas timeline plan", type: "plan", created: "2026-11-12T19:56+02:00" },
  { path: "report.html", title: "Atlas timeline report", type: "report", created: "2026-11-13T09:30+02:00" },
  { path: "finding-marks.html", title: "Finding marks", type: "design", created: "2026-11-12T17:22+02:00" },
]
const day = (entry: string, title: string, lines: Entry["lines"]): Entry => ({ entry, state: "done", title, merged: false, lines, started_at: `${entry}T09:00:00Z`, ended_at: `${entry}T18:00:00Z` })
const s = (d: string, text: string, kind: string) => ({ day: d, text, source: "session" as const, ref: "s1", kind })
const sessions: SessionDays[] = [
  {
    id: "s1",
    days: [
      day("2026-11-10", "Other work", [s("2026-11-10", "Fix a voice bug", "asked")]),
      day("2026-11-12", "Timeline options", [s("2026-11-12", "Show each effort over time", "asked"), { day: "2026-11-12", text: "Pick the accent", source: "todo", ref: "7", kind: null }]),
      day("2026-11-14", "Checking the report", [s("2026-11-14", "Deployed to production through Coolify", "done"), { day: "2026-11-14", text: "atlas/timeline/report.html", source: "doc", ref: "atlas/timeline/report.html", kind: null }]),
      day("2026-11-15", "Another effort", [s("2026-11-15", "Fix the voice socket", "asked")]),
    ],
  },
]
const prs = [{ number: 21, branch: "t/1-store", state: "MERGED", url: "https://x/pull/21", mergedAt: "2026-11-14T12:00:00Z" }]
const evidence = [
  { name: "phase-1", day: "2026-11-12" },
  { name: "cpu-probe", day: "2026-11-10" },
  { name: "follow-ups", day: "2026-11-13" },
]
const full = { plan, design, runMd, docs, evidence, timelineMd: "## deploy\ndone: 2026-11-14 Deployed to production\n", docPrefix: "atlas/timeline/" }
const byId = (entries: Entry[]) => new Map(entries.map((e) => [e.entry, e]))
const texts = (e: Entry | undefined) => e?.lines.map((l) => `${l.kind}: ${l.text}`)

describe("readers", () => {
  test("readDecisions keeps dated rows of the decision log", () => {
    expect(readDecisions(design).map((d) => [d.id, d.day])).toEqual([["T13", "2026-11-12"], ["T17", "2026-11-12"], ["T18", "2026-11-13"]])
  })
  test("readRunFlow reads rounds, the sign-off step, added phases and defaults by phase", () => {
    const f = readRunFlow(runMd)
    expect(f.rounds).toEqual([{ n: "1", day: "2026-11-12", answers: 2 }])
    expect(f.signoff).toBe("2026-11-12")
    expect(f.added).toEqual([{ text: "Phases 5 to 9 added", day: "2026-11-13" }])
    expect([...f.defaults]).toEqual([["phase-1", 2], ["sign-off", 1]])
  })
  test("readCanvases finds canvas links and the date on their line", () => {
    expect(readCanvases(design)).toEqual([{ text: "The looks canvas", url: "https://claude.ai/artifact/abc", day: "2026-11-12" }])
  })
})

describe("the flow of work", () => {
  test("with run.md: every kind, in the order the work happened", () => {
    const entries = buildEntries({ work, todos, prs, files: full, sessions, unpushed: ["bbb1111"] })
    expect(entries.map((e) => [e.entry, e.state])).toEqual([
      ["investigation-cpu-probe", "done"],
      ["brief", "done"],
      ["planning", "done"],
      ["exploration", "done"],
      ["sign-off", "done"],
      ["phase-1", "done"],
      ["phase-2", "done"],
      ["report", "done"],
      ["validation", "done"],
      ["scope-2026-11-13", "done"],
      ["deploy", "done"],
      ["merged", "done"],
    ])
    const e = byId(entries)
    // The session day before the effort began is left out; the brief is what the first day asked.
    expect(texts(e.get("brief"))).toEqual(["asked: Show each effort over time", "day: Timeline options"])
    expect(texts(e.get("planning"))).toEqual([
      "planning: Question round 1: 2 answers",
      "planning: Design written",
      "planning: Plan written",
      "decision: T13: The view is the rail",
      "null: Pick the accent",
      "day: Timeline options",
    ])
    expect(texts(e.get("exploration"))).toEqual(["exploration: The looks canvas", "exploration: Finding marks", "day: Timeline options"])
    expect(texts(e.get("sign-off"))).toEqual(["decision: T17: Sign-off on 2026-11-12, with the open questions settled", "day: Timeline options", "defaults: 1 default picked"])
    expect(texts(e.get("phase-1"))).toEqual(["null: Add the store", "day: Timeline options", "evidence: Evidence: phase-1", "pr-merged: PR 21", "defaults: 2 defaults picked"])
    // The commit made after the report is a fix, and an unpushed commit is marked.
    expect(texts(e.get("validation"))).toEqual(["null: Fix the next section"])
    expect(e.get("phase-1")!.ended_at).toBe("2026-11-12T21:00:00+02:00")
    expect(texts(e.get("phase-2"))).toEqual(["unpushed: Read sessions", "investigation: Evidence: follow-ups"])
    expect(texts(e.get("report"))).toEqual(["report: Atlas timeline report"])
    expect(texts(e.get("scope-2026-11-13"))).toEqual(["decision: T18: Entries follow the flow of work", "scope: Phases 5 to 9 added"])
    expect(texts(e.get("deploy"))).toEqual(["done: Deployed to production", "day: Checking the report"])
    expect(texts(e.get("merged"))).toEqual(["merged: PR 21 merged", "day: Checking the report"])
    // After sign-off, a session day that touched nothing of the effort stays off it.
    expect(entries.flatMap((x) => x.lines).some((l) => l.text === "Another effort" || l.text === "Fix the voice socket")).toBe(false)
  })

  test("without run.md: the same skeleton from docs, decisions, sessions, git and PRs", () => {
    const { runMd: _, timelineMd: __, ...files } = full
    const e = byId(buildEntries({ work, todos, prs, files, sessions }))
    expect([...e.keys()]).toEqual(expect.arrayContaining(["brief", "planning", "exploration", "sign-off", "phase-1", "phase-2", "report", "validation", "scope-2026-11-13", "deploy", "merged", "investigation-cpu-probe"]))
    expect(texts(e.get("planning"))).not.toContain("planning: Question round 1: 2 answers")
    expect(texts(e.get("sign-off"))![0]).toStartWith("decision: T17")
    // Deploy comes from the session day that deployed when timeline.md has no done: line.
    expect(texts(e.get("deploy"))).toEqual(["done: Deployed to production through Coolify", "day: Checking the report"])
    expect(e.get("phase-1")!.lines.some((l) => l.kind === "defaults")).toBe(false)
  })

  test("without run.md or a sign-off row: the plan's created time is the sign-off", () => {
    const e = byId(buildEntries({ work, todos, files: { plan, docs } }))
    expect(e.get("sign-off")).toMatchObject({ started_at: "2026-11-12T19:56+02:00" })
    expect(texts(e.get("sign-off"))).toEqual(["sign-off: Signed off with the plan"])
    expect(e.has("brief")).toBe(false)
    expect(e.has("scope-2026-11-13")).toBe(false)
  })

  test("a kind whose activity did not happen has no entry", () => {
    const entries = buildEntries({ work, todos: [], files: { plan } })
    expect(entries.map((e) => e.entry)).toEqual(["phase-1", "phase-2"])
  })

  test("a brief file is the brief", () => {
    const e = byId(buildEntries({ work, todos, files: { plan, docs: [...docs, { path: "brief.html", title: "What I asked for", type: "brief", created: "2026-11-12T10:00+02:00" }] }, sessions }))
    expect(texts(e.get("brief"))).toEqual(["brief: What I asked for", "day: Timeline options"])
  })

  test("a day with no digest gives no day title and no brief", () => {
    const bare: SessionDays[] = [{ id: "s2", days: [day("2026-11-12", "17 prompts, 10 commits", [{ day: "2026-11-12", text: "Pick the accent", source: "todo", ref: "7", kind: null }])] }]
    const entries = buildEntries({ work, todos, files: { plan, docs }, sessions: bare })
    expect(entries.some((e) => e.entry === "brief")).toBe(false)
    expect(entries.flatMap((e) => e.lines).some((l) => l.kind === "day")).toBe(false)
  })

  test("an entry sorts on the local day of its lines, not on a UTC start from the evening before", () => {
    const late: SessionDays[] = [{ id: "s3", days: [{ ...day("2026-11-13", "Scope talk", [s("2026-11-13", "Add phases", "asked")]), started_at: "2026-11-12T22:30:00Z" }] }]
    const ids = buildEntries({ work, todos, files: { plan, design, docs }, sessions: late }).map((e) => e.entry)
    expect(ids.indexOf("scope-2026-11-13")).toBeGreaterThan(ids.indexOf("report"))
  })

  test("a done phase with no branch and no boxes sits on the day it was marked done", () => {
    const entries = buildEntries({ work: [], todos: [todo(5, "Phase 5. Timing", "done", "2026-10-01T16:20:02Z")], files: { docs: [{ path: "plan.html", title: "Plan", type: "plan", created: "2026-09-30", role: "plan" }] } })
    expect(entries.map((e) => [e.entry, e.started_at])).toEqual([["planning", "2026-09-30"], ["sign-off", "2026-09-30"], ["phase-5", "2026-10-01T16:20:02Z"]])
  })
})
