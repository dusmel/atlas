import { describe, expect, test } from "bun:test"
import { checkGroup, checkParent, doneAt, parsePriority, parseStatus, parseTitle, RuleError } from "../src/rules.ts"

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof RuleError ? e.code : "other"
  }
  return null
}

describe("fields", () => {
  test("titles are trimmed and 1 to 500 characters", () => {
    expect(parseTitle("  Build it ")).toBe("Build it")
    expect(code(() => parseTitle("   "))).toBe("bad_title")
    expect(code(() => parseTitle("x".repeat(501)))).toBe("bad_title")
    expect(parseTitle("x".repeat(500))).toHaveLength(500)
    expect(code(() => parseTitle(42))).toBe("bad_title")
  })

  test("status and priority accept only known values, inbox is null", () => {
    expect(parseStatus("doing")).toBe("doing")
    expect(code(() => parseStatus("blocked"))).toBe("bad_status")
    expect(parsePriority("P3")).toBe("P3")
    expect(parsePriority("inbox")).toBeNull()
    expect(parsePriority(null)).toBeNull()
    expect(code(() => parsePriority("P4"))).toBe("bad_priority")
  })
})

describe("parents and groups", () => {
  const parent = { id: 1, repo_id: "r", parent_id: null }

  test("one level, same repo", () => {
    expect(code(() => checkParent({ id: 2, repo_id: "r", has_children: false }, parent))).toBeNull()
    expect(code(() => checkParent({ id: 2, repo_id: "other", has_children: false }, parent))).toBe("bad_parent")
    expect(code(() => checkParent({ id: 3, repo_id: "r", has_children: false }, { id: 2, repo_id: "r", parent_id: 1 }))).toBe("bad_parent")
    expect(code(() => checkParent({ id: 2, repo_id: "r", has_children: true }, parent))).toBe("bad_parent")
    expect(code(() => checkParent({ id: 1, repo_id: "r", has_children: false }, parent))).toBe("bad_parent")
  })

  test("a group must belong to the item's repo", () => {
    expect(code(() => checkGroup({ repo_id: "r" }, { id: 1, repo_id: "r" }))).toBeNull()
    expect(code(() => checkGroup({ repo_id: "r" }, { id: 1, repo_id: "x" }))).toBe("bad_group")
  })
})

describe("done_at", () => {
  test("set when moving to done, kept while done, cleared when leaving", () => {
    expect(doneAt("todo", "done", null, "t1")).toBe("t1")
    expect(doneAt("done", "done", "t0", "t1")).toBe("t0")
    expect(doneAt("done", "doing", "t0", "t1")).toBeNull()
    expect(doneAt("todo", "doing", null, "t1")).toBeNull()
  })
})
