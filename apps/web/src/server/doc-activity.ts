import type { Database } from "bun:sqlite"
import { folderOf, type DocMeta } from "@atlas/indexer"

export type DocChange = "added" | "changed" | "removed"
export type DocEvent = { id: number; at: string; change: DocChange; repo: string; path: string; kind: string; kinds: string[]; title: string }

/**
 * Compares the index with the files seen last time and logs the difference. Added and changed docs
 * are logged at their save time, removed ones at `now`. The first run only fills in the baseline.
 */
export function recordDocChanges(db: Database, files: DocMeta[], now = new Date()): number {
  const known = new Map(db.query<DocMeta, []>("SELECT repo, path, kind, title, mtime, size FROM doc_files").all().map((f) => [`${f.repo}/${f.path}`, f]))
  // An empty docs folder with a baseline is a missing mount, not every doc deleted.
  if (!files.length && known.size) return 0
  const first = known.size === 0
  const events: [string, DocChange, DocMeta][] = []
  const upsert = db.prepare("INSERT OR REPLACE INTO doc_files (repo, path, kind, title, mtime, size) VALUES (?, ?, ?, ?, ?, ?)")
  db.transaction(() => {
    for (const f of files) {
      const old = known.get(`${f.repo}/${f.path}`)
      known.delete(`${f.repo}/${f.path}`)
      if (old && old.mtime === f.mtime && old.size === f.size) continue
      upsert.run(f.repo, f.path, f.kind, f.title, f.mtime, f.size)
      events.push([new Date(f.mtime).toISOString(), old ? "changed" : "added", f])
    }
    for (const f of known.values()) {
      db.run("DELETE FROM doc_files WHERE repo = ? AND path = ?", [f.repo, f.path])
      events.push([now.toISOString(), "removed", f])
    }
    if (first) return
    const insert = db.prepare("INSERT INTO doc_events (at, change, repo, path, folder, kind, title) VALUES (?, ?, ?, ?, ?, ?, ?)")
    for (const [at, change, f] of events) insert.run(at, change, f.repo, f.path, folderOf(f.path), f.kind, f.title)
  })()
  return first ? 0 : events.length
}

const TWIN_GAP_MS = 10 * 60_000

/** Newest first. An md and html pair changed within 10 minutes of each other shows as one event. */
export function listDocEvents(db: Database, opts: { repo?: string[]; folder?: string[]; after?: string; limit?: number } = {}): DocEvent[] {
  const limit = opts.limit ?? 100
  const parts: string[] = []
  const params: string[] = []
  for (const key of ["repo", "folder"] as const) {
    const values = opts[key]
    if (!values?.length) continue
    parts.push(`AND ${key} IN (${values.map(() => "?").join(", ")})`)
    params.push(...values)
  }
  if (opts.after) {
    parts.push("AND at >= ?")
    params.push(opts.after)
  }
  const rows = db
    .query<Omit<DocEvent, "kinds">, (string | number)[]>(`SELECT id, at, change, repo, path, kind, title FROM doc_events WHERE 1 = 1 ${parts.join(" ")} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(...params, limit * 2)
  const out: DocEvent[] = []
  for (const r of rows) {
    const twin = `${r.repo}/${r.path.replace(/\.(md|html)$/, "")}`
    const kept = out.find((e) => e.change === r.change && `${e.repo}/${e.path.replace(/\.(md|html)$/, "")}` === twin && Math.abs(Date.parse(e.at) - Date.parse(r.at)) < TWIN_GAP_MS)
    if (kept) {
      if (!kept.kinds.includes(r.kind)) kept.kinds.push(r.kind)
      continue
    }
    out.push({ ...r, kinds: [r.kind] })
  }
  return out.slice(0, limit)
}
