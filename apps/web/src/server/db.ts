import { Database } from "bun:sqlite"

export type Migration = { version: number; name: string; sql: string }

export const now = () => new Date().toISOString()

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA busy_timeout = 5000")
  return db
}

// files maps a path like "../migrations/001_init.sql" to its SQL.
export function parseMigrations(files: Record<string, string>): Migration[] {
  const list = Object.entries(files).map(([path, sql]) => {
    const name = path.split("/").at(-1)!
    const match = /^(\d+)_.+\.sql$/.exec(name)
    if (!match) throw new Error(`migration file ${name} must look like 001_name.sql`)
    return { version: Number(match[1]), name, sql }
  })
  list.sort((a, b) => a.version - b.version)
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migrations must be numbered 1, 2, 3... without gaps; found ${m.name}`)
  })
  return list
}

// Applies pending migrations in one transaction, so a failed one leaves the schema as it was.
export function migrate(db: Database, migrations: Migration[]): number[] {
  db.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
  const row = db.query<{ v: number | null }, []>("SELECT max(version) AS v FROM schema_version").get()
  const current = row?.v ?? 0
  const pending = migrations.filter((m) => m.version > current)
  db.transaction(() => {
    for (const m of pending) {
      db.run(m.sql)
      db.run("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)", [m.version, m.name, now()])
    }
  })()
  return pending.map((m) => m.version)
}
