import { expect, test } from "bun:test"
import type { DayFacts } from "../src/session"
import { bigEnough, sessionEntries } from "../src/session-entries"

const day = (d: string, extra: Partial<DayFacts> = {}): DayFacts => ({
  day: d,
  start: 0,
  end: 1,
  first: `${d}T08:00:00Z`,
  last: `${d}T18:00:00Z`,
  prompts: 4,
  commits: [],
  prs: [],
  todos: [],
  files: [],
  cwds: [],
  ...extra,
})

test("one entry per day with its digest and facts, then the todos left open", () => {
  const entries = sessionEntries({
    id: "s1",
    days: [
      day("2026-11-03", { commits: ["1a2b3c4"], prs: ["https://github.com/example/harbour/pull/7"], todos: [41], files: ["/docs/harbour/lamp/plan.md", "/w/harbour/src/lamp.ts"] }),
      day("2026-11-04", { prompts: 1, prs: ["https://github.com/example/harbour/pull/7"] }),
    ],
    digests: { "2026-11-03": { title: "Planned the lamp rota", session_title: "Lamp rota", asked: ["Asked for a rota"], decided: ["Kept dusk as the start"], done: ["Wrote the plan"] } },
    subjects: { "1a2b3c4": "Plan the rota" },
    todos: [
      { id: 41, title: "Write the rota", status: "done" },
      { id: 42, title: "Paint the rail", status: "todo" },
    ],
    docLabel: (p) => (p.startsWith("/docs/") ? p.slice("/docs/".length) : null),
    now: Date.parse("2026-11-10T00:00:00Z"),
  })
  expect(entries.map((e) => [e.entry, e.state, e.title])).toEqual([
    ["2026-11-03", "done", "Planned the lamp rota"],
    ["2026-11-04", "done", "1 prompt"],
    ["open", "todo", "Left open"],
  ])
  expect(entries[0]!.lines.map((l) => [l.source, l.kind, l.text])).toEqual([
    ["session", "asked", "Asked for a rota"],
    ["session", "decided", "Kept dusk as the start"],
    ["session", "done", "Wrote the plan"],
    ["git", null, "Plan the rota"],
    ["git", "pr", "PR 7"],
    ["todo", null, "Write the rota"],
    ["doc", null, "harbour/lamp/plan.md"],
  ])
  // PR 7 was linked again on the 4th: it shows on the 3rd only.
  expect(entries[1]!.lines).toEqual([])
  expect(entries[2]!.lines.map((l) => l.ref)).toEqual(["42"])
})

test("the last day is now while the session is still going", () => {
  const entries = sessionEntries({ id: "s1", days: [day("2026-11-03")], digests: {}, subjects: {}, todos: [], docLabel: () => null, now: Date.parse("2026-11-03T18:30:00Z") })
  expect(entries[0]!.state).toBe("doing")
  expect(entries[0]!.title).toBe("4 prompts")
})

test("bigEnough follows the size rule", () => {
  const small = { days: 1, prompts: 29, commits: 2, todos: 2 }
  expect(bigEnough(small)).toBe(false)
  expect(bigEnough({ ...small, days: 2 })).toBe(true)
  expect(bigEnough({ ...small, prompts: 30 })).toBe(true)
  expect(bigEnough({ ...small, commits: 3 })).toBe(true)
  expect(bigEnough({ ...small, todos: 3 })).toBe(true)
})
