import { beforeEach, describe, expect, test } from "bun:test"
import type { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkFile, checkStored } from "@atlas/todos"
import { HttpError } from "../src/server/http"
import {
  applyImport,
  archiveTodo,
  createGroup,
  createTodo,
  getImport,
  getTodo,
  listAuthors,
  listEvents,
  listGroups,
  listRepos,
  listTodos,
  moveTodo,
  updateGroup,
  updateTodo,
  type Item,
} from "../src/server/todos"
import { freshDb } from "./helpers"

let db: Database
const who = { actor: "test", author: "me" }
const repo = { id: "github.com-me-app", name: "app" }
const add = (title: string, extra: Record<string, unknown> = {}) => createTodo(db, who, { repo, title, ...extra })
const list = (q: Partial<Parameters<typeof listTodos>[1]> = {}) => listTodos(db, { repo: [], status: [], priority: [], ...q })
const titles = (items: Item[]) => items.map((i) => i.title)
const fails = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof HttpError) return `${e.status} ${e.code}`
    return (e as { code?: string }).code ?? String(e)
  }
  return "ok"
}

beforeEach(() => {
  db = freshDb()
})

describe("create and list", () => {
  test("defaults to Inbox and todo, records an event, and upserts the repo", () => {
    const item = add("First")
    expect(item).toMatchObject({ priority: null, status: "todo", repo_name: "app", done_at: null })
    expect(getTodo(db, item.id).events.map((e) => e.action)).toEqual(["create"])
    createTodo(db, who, { repo: { ...repo, name: "renamed" }, title: "Second" })
    expect(list()[0]!.repo_name).toBe("renamed")
  })

  test("a plain repo string must exist", () => {
    expect(fails(() => createTodo(db, who, { repo: "nope", title: "x" }))).toBe("400 unknown_repo")
    expect(createTodo(db, who, { repo: "_personal", title: "x" }).repo_name).toBe("personal")
  })

  test("sorted Inbox first, then P0 to P3, then todo, doing, done, then rank", () => {
    add("p1 doing", { priority: "P1", status: "doing" })
    add("p1 todo", { priority: "P1" })
    add("inbox")
    add("p0", { priority: "P0" })
    add("p1 done", { priority: "P1", status: "done" })
    expect(titles(list({ status: ["todo", "doing", "done"] }))).toEqual(["inbox", "p0", "p1 todo", "p1 doing", "p1 done"])
    expect(titles(list())).not.toContain("p1 done")
  })

  test("filters by repo name or id, priority including inbox, group, parent and text", () => {
    const g = createGroup(db, { repo, name: "Launch" })
    const parent = add("Parent", { priority: "P2", group: "Launch" })
    add("Child", { parent: parent.id, body: "needle in the body" })
    createTodo(db, who, { repo: "_personal", title: "Mine" })
    expect(titles(list({ repo: ["app"] }))).toEqual(["Child", "Parent"])
    expect(titles(list({ repo: [repo.id] }))).toHaveLength(2)
    expect(titles(list({ priority: ["inbox"] }))).toEqual(["Child", "Mine"])
    expect(titles(list({ priority: ["P2", "inbox"], repo: ["app"] }))).toEqual(["Child", "Parent"])
    expect(titles(list({ group: "Launch" }))).toEqual(["Parent"])
    expect(titles(list({ parent: String(parent.id) }))).toEqual(["Child"])
    expect(titles(list({ q: "NEEDLE" }))).toEqual(["Child"])
    expect(g.name).toBe("Launch")
  })

  test("an unknown group is an error with a hint, not a new group", () => {
    expect(fails(() => add("x", { group: "Typo" }))).toBe("400 unknown_group")
  })

  test("one level of parent, in the same repo", () => {
    const a = add("A")
    const b = add("B", { parent: a.id })
    expect(fails(() => add("C", { parent: b.id }))).toBe("bad_parent")
    const other = createTodo(db, who, { repo: "_personal", title: "Other" })
    expect(fails(() => add("D", { parent: other.id }))).toBe("bad_parent")
    expect(fails(() => updateTodo(db, who, a.id, { parent: other.id }))).toBe("bad_parent")
    expect(getTodo(db, a.id).children.map((c) => c.title)).toEqual(["B"])
  })
})

describe("update", () => {
  test("changing the lane moves to its bottom and keeps done_at right", () => {
    const a = add("A", { priority: "P1" })
    const b = add("B", { priority: "P2" })
    const moved = updateTodo(db, who, a.id, { priority: "P2", status: "done" })
    expect(moved.rank > b.rank || moved.status !== b.status).toBe(true)
    expect(moved.done_at).not.toBeNull()
    expect(updateTodo(db, who, a.id, { status: "doing" }).done_at).toBeNull()
  })

  test("records only changed fields, and a stale if_updated_at gets 409 with the current item", () => {
    const a = add("A")
    const changed = updateTodo(db, who, a.id, { title: "A2", body: "" })
    const [latest] = getTodo(db, a.id).events
    expect(latest!.data).toEqual({ title: ["A", "A2"] })
    try {
      updateTodo(db, who, a.id, { title: "A3", if_updated_at: a.updated_at === changed.updated_at ? "stale" : a.updated_at })
      throw new Error("expected a conflict")
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      expect((e as HttpError).status).toBe(409)
      expect(((e as HttpError).extra.item as Item).title).toBe("A2")
    }
  })

  test("group can be cleared with null, and must belong to the repo", () => {
    createGroup(db, { repo, name: "G" })
    const other = createGroup(db, { repo: "_personal", name: "Elsewhere" })
    const a = add("A", { group: "G" })
    expect(updateTodo(db, who, a.id, { group: null }).group_id).toBeNull()
    expect(fails(() => updateTodo(db, who, a.id, { group: other.id }))).toBe("bad_group")
  })
})

describe("move", () => {
  const lane = () => titles(list({ priority: ["P1"] }))

  test("before, after, top and bottom within a lane", () => {
    const [a, b, c] = ["A", "B", "C"].map((t) => add(t, { priority: "P1" }))
    moveTodo(db, who, c!.id, { before: a!.id })
    expect(lane()).toEqual(["C", "A", "B"])
    moveTodo(db, who, c!.id, { after: a!.id })
    expect(lane()).toEqual(["A", "C", "B"])
    moveTodo(db, who, b!.id, { top: true })
    expect(lane()).toEqual(["B", "A", "C"])
    moveTodo(db, who, b!.id, { bottom: true })
    expect(lane()).toEqual(["A", "C", "B"])
  })

  test("into another lane next to a neighbour there, which must be in that lane", () => {
    const a = add("A", { priority: "P1" })
    const d = add("D", { priority: "P2", status: "doing" })
    expect(fails(() => moveTodo(db, who, a.id, { before: d.id }))).toBe("400 bad_neighbour")
    const moved = moveTodo(db, who, a.id, { priority: "P2", status: "doing", before: d.id })
    expect(titles(list({ priority: ["P2"] }))).toEqual(["A", "D"])
    expect(getTodo(db, a.id).events[0]!.data).toMatchObject({ priority: ["P1", "P2"], status: ["todo", "doing"] })
    expect(moved.done_at).toBeNull()
  })

  test("only one position at a time", () => {
    const a = add("A")
    expect(fails(() => moveTodo(db, who, a.id, { top: true, bottom: true }))).toBe("400 bad_move")
  })
})

describe("archive", () => {
  test("hides the item, and unarchive puts it back at the bottom of its lane", () => {
    const a = add("A")
    add("B")
    archiveTodo(db, who, a.id, true)
    expect(titles(list())).toEqual(["B"])
    expect(titles(list({ include_archived: true }))).toEqual(["A", "B"])
    archiveTodo(db, who, a.id, false)
    expect(titles(list())).toEqual(["B", "A"])
    expect(getTodo(db, a.id).events.map((e) => e.action)).toEqual(["unarchive", "archive", "create"])
  })
})

describe("groups and repos", () => {
  test("names are unique per repo, and a rename checks too", () => {
    const g = createGroup(db, { repo, name: "One", doc_path: "plan.html" })
    createGroup(db, { repo, name: "Two" })
    expect(fails(() => createGroup(db, { repo, name: "One" }))).toBe("409 name_taken")
    expect(fails(() => updateGroup(db, g.id, { name: "Two" }))).toBe("409 name_taken")
    expect(updateGroup(db, g.id, { note: "hello" })).toMatchObject({ name: "One", doc_path: "plan.html", note: "hello" })
  })

  test("repos list open counts", () => {
    add("A")
    add("B", { status: "done" })
    expect(listRepos(db)).toContainEqual(expect.objectContaining({ name: "app", open: 1 }))
  })
})

describe("imports", () => {
  const original = readFileSync(join(import.meta.dir, "../../../packages/todos/test/fixtures/every-rule.md"), "utf8")
  const input = { repo, path: "TODO.md", original }

  test("a dry run reports and writes nothing", () => {
    const { report } = applyImport(db, input, true)
    expect(report.ok).toBe(true)
    expect(list({ status: ["todo", "doing", "done"] })).toEqual([])
  })

  test("apply stores every item, and check 4 passes against what the server stored", () => {
    const { import_id, report } = applyImport(db, input, false) as { import_id: number; report: { items: number } }
    expect(report.items).toBe(11)
    const stored = getImport(db, import_id)
    expect(stored.import.original).toBe(original)
    const { parsed } = checkFile(original)
    expect(checkStored(parsed, stored as never)).toEqual([])
    expect(stored.groups.map((g) => (g as { name: string }).name)).toEqual(["Launch", "Cleanup", "Low priority stuff", "Recently Done"])
  })

  test("ranks follow file order within each lane", () => {
    applyImport(db, input, false)
    expect(titles(list({ priority: ["P0"], status: ["todo"] }))).toEqual(["Write the announcement", "Count guests", "Ask the caterer", "Rehearse"])
  })

  test("the same file twice is refused, and a failing file changes nothing", () => {
    applyImport(db, input, false)
    expect(fails(() => applyImport(db, input, false))).toBe("409 already_imported")
    const broken = { repo, path: "plans/TODO.md", original: "## P1 — X\n\n- [~] bad mark\n" }
    expect(fails(() => applyImport(db, broken, false))).toBe("422 validation_failed")
    expect(db.query("SELECT count(*) AS n FROM imports").get()).toEqual({ n: 1 })
  })
})

describe("authors", () => {
  const as = (author: string) => ({ actor: "cli:mac", author })
  const by = (...b: string[]) => titles(list({ by: b }))

  test("an item keeps who made it, and every event says who changed it", () => {
    const a = createTodo(db, as("claude-code"), { repo, title: "From Claude" })
    expect(a.created_by).toBe("claude-code")
    updateTodo(db, as("me"), a.id, { title: "Edited by me" })
    expect(getTodo(db, a.id).events.map((e) => e.author)).toEqual(["me", "claude-code"])
    expect(getTodo(db, a.id).item.created_by).toBe("claude-code")
  })

  test("by filters on one author, on any agent, or on unknown", () => {
    createTodo(db, as("me"), { repo, title: "Mine" })
    createTodo(db, as("claude-code"), { repo, title: "Claude" })
    createTodo(db, as("opencode"), { repo, title: "Opencode" })
    createTodo(db, as("script"), { repo, title: "Cron" })
    db.run("UPDATE items SET created_by = NULL WHERE title = 'Cron'")
    expect(by("me")).toEqual(["Mine"])
    expect(by("agent")).toEqual(["Claude", "Opencode"])
    expect(by("claude-code", "me")).toEqual(["Mine", "Claude"])
    expect(by("unknown")).toEqual(["Cron"])
  })

  test("groups count only that author's open items, and drop groups with none", () => {
    createGroup(db, { repo, name: "Launch" })
    createGroup(db, { repo, name: "Empty" })
    createTodo(db, as("claude-code"), { repo, title: "A", group: "Launch" })
    createTodo(db, as("me"), { repo, title: "B", group: "Launch" })
    const groups = (b?: string[]) => (listGroups(db, "app", b) as { name: string; open: number }[]).map((g) => [g.name, g.open])
    expect(groups()).toEqual([["Launch", 2], ["Empty", 0]])
    expect(groups(["agent"])).toEqual([["Launch", 1]])
  })

  test("authors lists who made items, with unknown for the ones from before", () => {
    createTodo(db, as("me"), { repo, title: "A" })
    createTodo(db, as("me"), { repo, title: "B" })
    createTodo(db, as("claude-code"), { repo, title: "C" })
    expect(listAuthors(db)).toEqual([{ author: "me", items: 2 }, { author: "claude-code", items: 1 }])
  })

  test("imported items are made by the importer", () => {
    applyImport(db, { repo, path: "TODO.md", original: "## P1 — X\n\n- [ ] One\n" }, false)
    expect(titles(list({ by: ["import"] }))).toEqual(["One"])
  })
})

describe("events", () => {
  const as = (author: string) => ({ actor: "cli:mac", author })
  const events = (q: Partial<Parameters<typeof listEvents>[1]> = {}) => listEvents(db, { repo: [], by: [], ...q })

  test("newest first across items, with the item's title and repo", () => {
    const a = createTodo(db, as("me"), { repo, title: "First" })
    createTodo(db, as("claude-code"), { repo: { id: "github.com-me-web", name: "web" }, title: "Second" })
    updateTodo(db, as("opencode"), a.id, { priority: "P1" })
    expect(events().map((e) => [e.action, e.title, e.repo_name, e.author])).toEqual([
      ["update", "First", "app", "opencode"],
      ["create", "Second", "web", "claude-code"],
      ["create", "First", "app", "me"],
    ])
    expect(events()[0]!.data).toMatchObject({ priority: [null, "P1"] })
  })

  test("filters by repo and by who made the change, and pages with before", () => {
    const a = createTodo(db, as("me"), { repo, title: "Mine" })
    createTodo(db, as("claude-code"), { repo: { id: "github.com-me-web", name: "web" }, title: "Web" })
    updateTodo(db, as("claude-code"), a.id, { title: "Mine, edited" })
    expect(events({ repo: ["web"] }).map((e) => e.title)).toEqual(["Web"])
    expect(events({ by: ["agent"] }).map((e) => e.action)).toEqual(["update", "create"])
    expect(events({ by: ["me"] }).map((e) => e.action)).toEqual(["create"])
    const [newest, ...rest] = events()
    expect(events({ before: String(newest!.id) })).toEqual(rest)
    expect(events({ limit: "1" })).toHaveLength(1)
  })

  test("limit is 1 to 500", () => {
    expect(fails(() => events({ limit: "0" }))).toBe("400 bad_limit")
    expect(fails(() => events({ limit: "501" }))).toBe("400 bad_limit")
    expect(fails(() => events({ before: "x" }))).toBe("400 bad_id")
  })
})
