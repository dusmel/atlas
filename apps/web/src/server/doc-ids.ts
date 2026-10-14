import type { Database } from "bun:sqlite"
import { posix } from "node:path"

/** A doc's place: its docs folder and its path inside it. */
export type Place = { repo: string; path: string }
/** What these helpers need from the docs index. */
type Ids = { byId(id: string): Place | null; ids(): (Place & { id: string })[] }

/** A group doc's path as stored, relative to its repo's docs folder. */
export const groupDocPath = (path: string) => posix.normalize(path.replace(/^\.\//, ""))

/**
 * Records the path every doc with an id has now, then gives each share and group doc that has no id yet
 * the id its path held. After a rename, the old path still holds the id, so nothing is lost if the
 * rename is the first sync to see it. `folders` maps a todo repo id to its docs folder.
 */
export function recordDocIds(db: Database, index: Ids, folders: Map<string, string>) {
  const at = new Date().toISOString()
  const idAt = db.query<{ doc_id: string }, [string, string]>("SELECT doc_id FROM doc_paths WHERE repo = ? AND path = ?")
  db.transaction(() => {
    const upsert = db.query("INSERT INTO doc_paths (repo, path, doc_id, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT (repo, path) DO UPDATE SET doc_id = excluded.doc_id, last_seen = excluded.last_seen")
    for (const d of index.ids()) upsert.run(d.repo, d.path, d.id, at)
    db.run("UPDATE shares SET doc_id = (SELECT doc_id FROM doc_paths p WHERE p.repo = shares.repo_id AND p.path = shares.path) WHERE doc_id IS NULL")
    const docs = db
      .query<{ group_id: number; label: string; path: string; repo_id: string }, []>("SELECT d.group_id, d.label, d.path, g.repo_id FROM group_docs d JOIN groups g ON g.id = d.group_id WHERE d.doc_id IS NULL")
      .all()
    for (const d of docs) {
      const folder = folders.get(d.repo_id)
      const id = folder && idAt.get(folder, groupDocPath(d.path))?.doc_id
      if (id) db.run("UPDATE group_docs SET doc_id = ? WHERE group_id = ? AND label = ?", [id, d.group_id, d.label])
    }
  })()
}

/** Where a doc with this id is now, else the path it was stored with. */
export function placeOf(index: Ids, docId: string | null, at: Place): Place {
  const now = docId ? index.byId(docId) : null
  return now ? { repo: now.repo, path: now.path } : at
}

/** Where the doc that once lived at this path is now, or null when it never had an id or has none now. */
export function movedFrom(db: Database, index: Ids, at: Place): Place | null {
  const row = db.query<{ doc_id: string }, [string, string]>("SELECT doc_id FROM doc_paths WHERE repo = ? AND path = ?").get(at.repo, at.path)
  const now = row && index.byId(row.doc_id)
  return now && (now.repo !== at.repo || now.path !== at.path) ? { repo: now.repo, path: now.path } : null
}
