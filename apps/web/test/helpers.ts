import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrate, openDb, parseMigrations } from "../src/server/db"

export const tempDir = () => mkdtempSync(join(tmpdir(), "atlas-web-"))

// Tests read migrations from disk; the app bundles them through Vite's import.meta.glob.
export function realMigrations() {
  const dir = join(import.meta.dir, "../migrations")
  return parseMigrations(Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")])))
}

export function freshDb(path = ":memory:") {
  const db = openDb(path)
  migrate(db, realMigrations())
  return db
}
