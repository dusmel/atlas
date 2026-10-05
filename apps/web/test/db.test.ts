import { describe, expect, test } from "bun:test"
import { migrate, openDb, parseMigrations } from "../src/server/db"
import { freshDb, realMigrations } from "./helpers"

describe("migrations", () => {
  test("001 creates every table and the _personal repo", () => {
    const db = freshDb()
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["api_tokens", "events", "groups", "imports", "items", "repos", "schema_version", "sessions", "shares"]),
    )
    expect(db.query("SELECT id FROM repos").all()).toEqual([{ id: "_personal" }])
  })

  test("002 fills in the author where the old actor tells it, and leaves the rest unknown", () => {
    const db = openDb(":memory:")
    migrate(db, realMigrations().slice(0, 1))
    db.run("INSERT INTO repos (id, name, updated_at) VALUES ('r', 'r', 'now')")
    for (const [id, actor] of [[1, "import"], [2, "web"], [3, "cli:irembo-mac"]] as const) {
      db.run("INSERT INTO items (id, repo_id, title, rank, created_at, updated_at) VALUES (?, 'r', 't', 'a0', 'now', 'now')", [id])
      db.run("INSERT INTO events (item_id, actor, action, data, at) VALUES (?, ?, 'create', '{}', 'now')", [id, actor])
    }
    migrate(db, realMigrations())
    expect(db.query("SELECT id, created_by FROM items ORDER BY id").all()).toEqual([
      { id: 1, created_by: "import" },
      { id: 2, created_by: "me" },
      { id: 3, created_by: null },
    ])
  })

  test("running again applies nothing", () => {
    const db = freshDb()
    expect(migrate(db, realMigrations())).toEqual([])
  })

  test("a failing migration leaves the schema untouched", () => {
    const db = openDb(":memory:")
    const bad = [
      { version: 1, name: "001_ok.sql", sql: "CREATE TABLE a (x INTEGER)" },
      { version: 2, name: "002_bad.sql", sql: "CREATE TABLE b (x INTEGER); NOT SQL" },
    ]
    expect(() => migrate(db, bad)).toThrow()
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('a', 'b')").all()).toEqual([])
    expect(db.query("SELECT count(*) AS n FROM schema_version").get()).toEqual({ n: 0 })
  })

  test("rejects gaps and badly named files", () => {
    expect(() => parseMigrations({ "001_a.sql": "", "003_c.sql": "" })).toThrow(/without gaps/)
    expect(() => parseMigrations({ "init.sql": "" })).toThrow(/001_name/)
  })

  test("item ids keep counting across repos and are never reused", () => {
    const db = freshDb()
    db.run("INSERT INTO repos (id, name, updated_at) VALUES ('r2', 'r2', 'now')")
    const add = (repo: string) =>
      db.query<{ id: number }, [string]>(
        "INSERT INTO items (repo_id, title, rank, created_at, updated_at) VALUES (?, 't', 'a0', 'now', 'now') RETURNING id",
      ).get(repo)!.id
    expect([add("_personal"), add("r2")]).toEqual([1, 2])
    db.run("DELETE FROM items WHERE id = 2")
    expect(add("r2")).toBe(3)
  })

  test("the schema rejects a bad status and an empty title", () => {
    const db = freshDb()
    const insert = (title: string, status: string) =>
      db.run("INSERT INTO items (repo_id, title, status, rank, created_at, updated_at) VALUES ('_personal', ?, ?, 'a0', 'now', 'now')", [title, status])
    expect(() => insert("ok", "blocked")).toThrow()
    expect(() => insert("", "todo")).toThrow()
  })
})
