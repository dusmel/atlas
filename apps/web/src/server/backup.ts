import type { Database } from "bun:sqlite"
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

export const NIGHTLY = /^atlas-\d{4}-\d{2}-\d{2}\.db$/
// Milliseconds are optional so the second-precision files from before still get pruned.
export const PREDEPLOY = /^atlas-predeploy-\d{8}T\d{6}(\d{3})?Z\.db$/

export function nightlyName(at: Date): string {
  return `atlas-${at.toISOString().slice(0, 10)}.db`
}

export function predeployName(at: Date): string {
  // Down to the millisecond: VACUUM INTO fails if two starts in one second pick the same name.
  return `atlas-predeploy-${at.toISOString().replace(/[-:.]/g, "").slice(0, 18)}Z.db`
}

// VACUUM INTO writes a consistent copy while the app keeps running, and fails if the file exists.
export function backupTo(db: Database, dir: string, name: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  db.run("VACUUM INTO ?", [file])
  return file
}

// Names sort by date, so the newest `keep` files are the last ones.
export function prune(dir: string, pattern: RegExp, keep: number): string[] {
  const files = readdirSync(dir).filter((f) => pattern.test(f)).sort()
  const old = files.slice(0, Math.max(0, files.length - keep))
  for (const f of old) rmSync(join(dir, f))
  return old
}

export function nightlyIfDue(db: Database, dir: string, at = new Date()): string | null {
  if (at.getUTCHours() < 1) return null
  const name = nightlyName(at)
  if (existsSync(join(dir, name))) return null
  const file = backupTo(db, dir, name)
  prune(dir, NIGHTLY, 30)
  return file
}

// The web app must be stopped first. Mirrors the runbook's restore steps.
export function restore(backupFile: string, dbPath: string): void {
  if (existsSync(dbPath)) copyFileSync(dbPath, `${dbPath}.before-restore`)
  copyFileSync(backupFile, dbPath)
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
}
