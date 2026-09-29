import type { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { backupTo, nightlyIfDue, predeployName, prune, PREDEPLOY } from "./backup"
import { migrate, openDb, parseMigrations } from "./db"

const files = import.meta.glob<string>("../../migrations/*.sql", { query: "?raw", import: "default", eager: true })

export const dataDir = () => process.env.ATLAS_DATA_DIR ?? "/data"

let db: Database | undefined

// Opened on the first request. Every start backs up the existing file before migrating it.
export function getDb(): Database {
  if (db) return db
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "atlas.db")
  const backups = join(dir, "backups")
  const existed = existsSync(path)
  const opened = openDb(path)
  if (existed) {
    backupTo(opened, backups, predeployName(new Date()))
    prune(backups, PREDEPLOY, 10)
  }
  const applied = migrate(opened, parseMigrations(files))
  if (applied.length) console.log(`atlas: applied migrations ${applied.join(", ")}`)
  const nightly = () => {
    try {
      const file = nightlyIfDue(opened, backups)
      if (file) console.log(`atlas: nightly backup ${file}`)
    } catch (err) {
      console.error("atlas: nightly backup failed", err)
    }
  }
  nightly()
  setInterval(nightly, 60_000).unref()
  db = opened
  return db
}
