import { describe, expect, test } from "bun:test"
import type { DocMeta } from "@atlas/indexer"
import { repoExtras } from "../src/server/doc-overview"

const DAY = 864e5
const now = Date.UTC(2026, 9, 13, 12)
const doc = (repo: string, path: string, daysAgo: number): DocMeta => ({ repo, path, kind: path.endsWith(".md") ? "md" : "html", title: path, mtime: now - daysAgo * DAY, size: 1 })

describe("repoExtras", () => {
  const files = [doc("web", "plan.md", 1), doc("web", "plan.html", 3), doc("web", "notes.md", 0), doc("web", "old.md", 90), doc("web", "spec.md", 45), doc("api", "run.md", 10)]
  const linked = new Map([
    ["web/plan", { open: 2, groups: [1] }],
    ["web/old", { open: 5, groups: [2] }],
  ])
  const out = repoExtras(files, linked, now)

  test("a twin counts once, as the html, dated by its newer file", () => {
    const web = out.get("web")!
    expect(web.changed.map((d) => d.path)).toEqual(["notes.md", "plan.html"])
    expect(web.changed[1]!.mtime).toBe(new Date(now - DAY).toISOString())
  })

  test("days hold the docs last changed on each of the last 30 days, today last", () => {
    const web = out.get("web")!
    expect(web.days).toHaveLength(30)
    expect(web.days[29]).toBe(1)
    expect(web.days[28]).toBe(1)
    expect(web.days.reduce((a, b) => a + b)).toBe(2)
    expect(out.get("api")!.days[19]).toBe(1)
  })

  test("docs with open todos, most todos first, and the ones untouched for 60 days as stale plans", () => {
    const web = out.get("web")!
    expect(web.todo_docs.map((d) => [d.path, d.open])).toEqual([["old.md", 5], ["plan.html", 2]])
    expect(web.stale_plans.map((d) => d.path)).toEqual(["old.md"])
    expect(out.get("api")!.todo_docs).toEqual([])
  })
})
