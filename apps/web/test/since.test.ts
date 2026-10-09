import { describe, expect, test } from "bun:test"
import { matches, sinceLabel, sinceMs, type Item } from "../src/lib/todos"

describe("the Changed window", () => {
  test("reads minutes, hours, days and weeks, and nothing else", () => {
    expect(sinceMs("30m")).toBe(30 * 60_000)
    expect(sinceMs("1h")).toBe(3_600_000)
    expect(sinceMs(" 2D ")).toBe(2 * 86_400_000)
    expect(sinceMs("1w")).toBe(7 * 86_400_000)
    for (const bad of [undefined, "", "0d", "2", "d", "1y", "1.5h", "-1h", "2 days"]) expect(sinceMs(bad)).toBeNull()
  })

  test("labels read as words", () => {
    expect(sinceLabel("1h")).toBe("hour")
    expect(sinceLabel("2d")).toBe("2 days")
    expect(sinceLabel("30m")).toBe("30 minutes")
  })

  test("keeps items changed inside the window", () => {
    const now = Date.parse("2026-10-09T12:00:00Z")
    const item = (updated_at: string) => ({ id: 1, title: "", body: "", status: "todo", priority: null, repo_name: "app", group_id: null, created_by: "me", done_at: null, updated_at }) as unknown as Item
    expect(matches(item("2026-10-09T11:00:00Z"), { since: "2h" }, undefined, now)).toBe(true)
    expect(matches(item("2026-10-09T09:00:00Z"), { since: "2h" }, undefined, now)).toBe(false)
    expect(matches(item("2026-10-01T00:00:00Z"), { since: "nonsense" }, undefined, now)).toBe(true)
  })
})
