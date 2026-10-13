import type { Database } from "bun:sqlite"
import { HttpError } from "./http"

/**
 * `repo_id` holds the docs folder name, the `<repo>` in `/r/<repo>/<path>`, since docs are named by folder.
 * `doc_id` is the doc's contract id, which finds it after a move; `repo_id` and `path` are where it was shared.
 */
export type Share = { token: string; repo_id: string; path: string; doc_id: string | null; created_at: string; revoked_at: string | null }

const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")

/** One live share per doc, by id when it has one: making the same doc public twice returns the first link. */
export function createShare(db: Database, repo: string, path: string, docId: string | null = null): Share {
  const live = docId
    ? db.query<Share, [string]>("SELECT * FROM shares WHERE doc_id = ? AND revoked_at IS NULL").get(docId)
    : db.query<Share, [string, string]>("SELECT * FROM shares WHERE repo_id = ? AND path = ? AND revoked_at IS NULL").get(repo, path)
  if (live) return live
  return db
    .query<Share, [string, string, string, string | null, string]>("INSERT INTO shares (token, repo_id, path, doc_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(token(), repo, path, docId, new Date().toISOString())!
}

export const listShares = (db: Database) => db.query<Share, []>("SELECT * FROM shares WHERE revoked_at IS NULL ORDER BY created_at DESC").all()

export const liveShare = (db: Database, t: string) => db.query<Share, [string]>("SELECT * FROM shares WHERE token = ? AND revoked_at IS NULL").get(t)

export function revokeShare(db: Database, t: string) {
  const done = db.query("UPDATE shares SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL").run(new Date().toISOString(), t)
  if (!done.changes) throw new HttpError(404, "not_found", "No live share with that token")
}
