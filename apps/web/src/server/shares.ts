import type { Database } from "bun:sqlite"
import { HttpError } from "./http"

/** `repo_id` holds the docs folder name, the `<repo>` in `/r/<repo>/<path>`, since docs are named by folder. */
export type Share = { token: string; repo_id: string; path: string; created_at: string; revoked_at: string | null }

const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")

/** One live share per doc: making the same doc public twice returns the first link. */
export function createShare(db: Database, repo: string, path: string): Share {
  const live = db.query<Share, [string, string]>("SELECT * FROM shares WHERE repo_id = ? AND path = ? AND revoked_at IS NULL").get(repo, path)
  if (live) return live
  return db
    .query<Share, [string, string, string, string]>("INSERT INTO shares (token, repo_id, path, created_at) VALUES (?, ?, ?, ?) RETURNING *")
    .get(token(), repo, path, new Date().toISOString())!
}

export const listShares = (db: Database) => db.query<Share, []>("SELECT * FROM shares WHERE revoked_at IS NULL ORDER BY created_at DESC").all()

export const liveShare = (db: Database, t: string) => db.query<Share, [string]>("SELECT * FROM shares WHERE token = ? AND revoked_at IS NULL").get(t)

export function revokeShare(db: Database, t: string) {
  const done = db.query("UPDATE shares SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL").run(new Date().toISOString(), t)
  if (!done.changes) throw new HttpError(404, "not_found", "No live share with that token")
}
