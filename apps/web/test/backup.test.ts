import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { backupTo, nightlyIfDue, nightlyName, predeployName, prune, PREDEPLOY, restore } from "../src/server/backup"
import { openDb } from "../src/server/db"
import { freshDb, tempDir } from "./helpers"

const counts = (path: string) => {
  const db = openDb(path)
  const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  const out = Object.fromEntries(tables.map(({ name }) => [name, (db.query(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n]))
  db.close()
  return out
}

describe("backups", () => {
  test("names sort by time", () => {
    expect(nightlyName(new Date("2026-10-01T01:00:00Z"))).toBe("atlas-2026-10-01.db")
    expect(predeployName(new Date("2026-10-01T09:08:07.123Z"))).toBe("atlas-predeploy-20261001T090807Z.db")
  })

  test("backup then restore gives the same row counts per table", () => {
    const dir = tempDir()
    const live = join(dir, "atlas.db")
    const db = freshDb(live)
    for (let i = 0; i < 25; i++) {
      db.run("INSERT INTO items (repo_id, title, rank, created_at, updated_at) VALUES ('_personal', ?, ?, 'now', 'now')", [`item ${i}`, `a${i}`])
    }
    db.run("INSERT INTO events (item_id, actor, action, data, at) VALUES (1, 'test', 'create', '{}', 'now')")
    const file = backupTo(db, join(dir, "backups"), predeployName(new Date()))
    const before = counts(live)
    db.run("DELETE FROM items")
    db.close()

    restore(file, live)
    expect(counts(live)).toEqual(before)
    expect(before.items).toBe(25)
    expect(existsSync(`${live}.before-restore`)).toBe(true)
  })

  test("prune keeps the newest files of one kind only", () => {
    const dir = tempDir()
    const names = ["atlas-predeploy-20261001T000000Z.db", "atlas-predeploy-20261002T000000Z.db", "atlas-predeploy-20261003T000000Z.db", "atlas-2026-10-01.db"]
    for (const n of names) writeFileSync(join(dir, n), "")
    expect(prune(dir, PREDEPLOY, 2)).toEqual(["atlas-predeploy-20261001T000000Z.db"])
    expect(readdirSync(dir).sort()).toEqual(names.slice(1).sort())
  })

  test("nightly runs once per UTC day, from 01:00", () => {
    const dir = tempDir()
    const db = freshDb()
    expect(nightlyIfDue(db, dir, new Date("2026-10-01T00:30:00Z"))).toBeNull()
    expect(nightlyIfDue(db, dir, new Date("2026-10-01T01:00:00Z"))).toEndWith("atlas-2026-10-01.db")
    expect(nightlyIfDue(db, dir, new Date("2026-10-01T13:00:00Z"))).toBeNull()
  })
})
