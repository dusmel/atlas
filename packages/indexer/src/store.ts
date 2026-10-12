import { Database } from "bun:sqlite"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { htmlText, mdText, type DocText } from "./extract.ts"
import { scanDocs, type DocFile } from "./scan.ts"

export type Counts = { docs: number; md: number; html: number }
export type SyncResult = Counts & { added: number; changed: number; removed: number; ms: number }
export type SearchHit = { repo: string; path: string; kind: DocFile["kind"]; title: string; snippet: string; mtime: string; tags: string }
/** `folder` is the first folder inside the repo, "." for a doc at its top. `after` is a time in ms: only docs changed since. */
export type DocFilters = { repo?: string[]; folder?: string[]; after?: number }
/** Matching docs per repo and per folder, each counted with the other filters applied. Twins count once. */
export type Facets = { total: number; repo: Record<string, number>; folder: Record<string, number> }

/** Snippets wrap each match in these, so a client can mark them up without trusting the doc's text as HTML. */
export const MATCH_START = "\u0002"
export const MATCH_END = "\u0003"

const SCHEMA = `
  CREATE TABLE docs (
    id INTEGER PRIMARY KEY, repo TEXT NOT NULL, path TEXT NOT NULL, folder TEXT NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, mtime INTEGER NOT NULL, size INTEGER NOT NULL, tags TEXT NOT NULL,
    UNIQUE (repo, path)
  );
  CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, tokenize = 'porter unicode61');
`

/**
 * Every term is quoted, so FTS syntax in the input is just text, and the last one matches as a
 * prefix. Terms with no letter or digit hold no token and are dropped. Null when nothing is left.
 */
export function ftsQuery(q: string): string | null {
  const terms = words(q)
  if (!terms.length) return null
  return terms.map((t, i) => `"${quote(t)}"${i === terms.length - 1 ? "*" : ""}`).join(" ")
}

/** The words as one phrase, last one a prefix. Null for a single word, where the plain query is the same. */
export function ftsPhrase(q: string): string | null {
  const terms = words(q)
  return terms.length > 1 ? `"${terms.map(quote).join(" ")}"*` : null
}

const words = (q: string) => q.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t))
const quote = (t: string) => t.replace(/"/g, '""')

type Row = { id: number; repo: string; path: string; mtime: number; size: number }
type Read = { file: DocFile; id?: number; mtime: number; size: number; text: DocText }

/**
 * The docs index. It lives in memory: it is rebuilt from the files at every start, and keeping it
 * in atlas.db would put megabytes of doc text into every backup.
 */
export class DocIndex {
  readonly db = new Database(":memory:")
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly root: string) {
    this.db.exec(SCHEMA)
  }

  /** Brings the index in line with the files. Calls run one at a time, so two never diff against the same state. */
  sync(): Promise<SyncResult> {
    const run = this.queue.then(() => this.diff())
    this.queue = run.catch(() => {})
    return run
  }

  /** Forgets everything and reads every file again, for when a copy kept mtimes and sizes but not contents. */
  rebuild(): Promise<SyncResult> {
    const run = this.queue.then(() => {
      this.db.run("DELETE FROM docs_fts")
      this.db.run("DELETE FROM docs")
      return this.diff()
    })
    this.queue = run.catch(() => {})
    return run
  }

  /** Doc counts per repo folder, for the search page's repo filter. */
  repos(): { name: string; docs: number }[] {
    return this.db.query<{ name: string; docs: number }, []>("SELECT repo AS name, count(*) AS docs FROM docs GROUP BY repo ORDER BY repo").all()
  }

  // A file is re-read when its mtime or size changed. A rename is a removal and an addition.
  private async diff(): Promise<SyncResult> {
    const started = performance.now()
    const files = await scanDocs(this.root)
    const known = new Map(this.db.query<Row, []>("SELECT id, repo, path, mtime, size FROM docs").all().map((r) => [`${r.repo}/${r.path}`, r]))
    const reads: Read[] = []
    for (const file of files) {
      const old = known.get(`${file.repo}/${file.path}`)
      known.delete(`${file.repo}/${file.path}`)
      const full = join(this.root, file.repo, file.path)
      try {
        const st = await stat(full)
        const mtime = Math.floor(st.mtimeMs)
        if (old && old.mtime === mtime && old.size === st.size) continue
        const raw = await Bun.file(full).text()
        const name = basename(file.path)
        reads.push({ file, id: old?.id, mtime, size: st.size, text: file.kind === "md" ? mdText(raw, name) : htmlText(raw, name) })
      } catch {
        // Gone between the scan and the read: the next sync drops it.
        if (old) known.set(`${file.repo}/${file.path}`, old)
      }
    }
    const removed = [...known.values()]
    this.db.transaction(() => {
      for (const { id } of removed) {
        this.db.run("DELETE FROM docs_fts WHERE rowid = ?", [id])
        this.db.run("DELETE FROM docs WHERE id = ?", [id])
      }
      for (const { file, id, mtime, size, text } of reads) {
        const values = [file.kind, text.title, mtime, size, text.tags]
        let rowid = id
        if (rowid === undefined) {
          rowid = this.db
            .query<{ id: number }, (string | number)[]>("INSERT INTO docs (repo, path, folder, kind, title, mtime, size, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .get(file.repo, file.path, folderOf(file.path), ...values)!.id
        } else {
          this.db.run("UPDATE docs SET kind = ?, title = ?, mtime = ?, size = ?, tags = ? WHERE id = ?", [...values, rowid])
          this.db.run("DELETE FROM docs_fts WHERE rowid = ?", [rowid])
        }
        this.db.run("INSERT INTO docs_fts (rowid, title, body) VALUES (?, ?, ?)", [rowid, text.title, text.body])
      }
    })()
    const changed = reads.filter((r) => r.id !== undefined).length
    return { ...this.counts(), added: reads.length - changed, changed, removed: removed.length, ms: Math.round(performance.now() - started) }
  }

  counts(): Counts {
    const rows = this.db.query<{ kind: string; n: number }, []>("SELECT kind, count(*) AS n FROM docs GROUP BY kind").all()
    const md = rows.find((r) => r.kind === "md")?.n ?? 0
    const html = rows.find((r) => r.kind === "html")?.n ?? 0
    return { docs: md + html, md, html }
  }

  /**
   * Docs holding the exact phrase come first, then docs holding every word, each ranked by bm25
   * with the title weighted 5x. A doc kept as both x.md and x.html shows once, as whichever ranks higher.
   */
  search(q: string, opts: DocFilters & { limit?: number } = {}): SearchHit[] {
    const match = ftsQuery(q)
    if (!match) return []
    const limit = opts.limit ?? 20
    const phrase = ftsPhrase(q)
    return hits([...(phrase ? this.query(phrase, opts, limit * 2) : []), ...this.query(match, opts, limit * 2)], limit)
  }

  /** The most recently changed docs, newest first, with no snippet. Twins show once, as in search. */
  recent(opts: DocFilters & { limit?: number } = {}): SearchHit[] {
    const limit = opts.limit ?? 20
    const w = where(opts)
    const rows = this.db
      .query<Omit<SearchHit, "mtime"> & { mtime: number }, (string | number)[]>(
        `SELECT d.repo, d.path, d.kind, d.title, d.mtime, d.tags, '' AS snippet FROM docs d
          WHERE 1 = 1 ${w.sql}
          ORDER BY d.mtime DESC, d.repo, d.path
          LIMIT ?`,
      )
      .all(...w.params, limit * 2)
    return hits(rows, limit)
  }

  /** Counts for the filters: every doc matching `q` (or every doc, when it is empty), not only the first page. */
  facets(q: string, opts: DocFilters = {}): Facets {
    const match = q.trim() ? ftsQuery(q) : null
    if (q.trim() && !match) return { total: 0, repo: {}, folder: {} }
    // Phrase hits are a subset of all-words hits, so counting the all-words query covers both.
    const from = match ? "FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid WHERE docs_fts MATCH ?" : "FROM docs d WHERE 1 = 1"
    const count = (by: string | null, skip?: keyof DocFilters) => {
      const w = where(opts, skip)
      return this.db
        .query<{ v: string; n: number }, (string | number)[]>(`SELECT ${by ?? "''"} AS v, ${TWINS} AS n ${from} ${w.sql} ${by ? `GROUP BY ${by}` : ""}`)
        .all(...(match ? [match] : []), ...w.params)
    }
    const map = (rows: { v: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.v, r.n]))
    return { total: count(null)[0]?.n ?? 0, repo: map(count("d.repo", "repo")), folder: map(count("d.folder", "folder")) }
  }

  private query(match: string, opts: DocFilters, limit: number) {
    const w = where(opts)
    return this.db
      .query<Omit<SearchHit, "mtime"> & { mtime: number }, (string | number)[]>(
        `SELECT d.repo, d.path, d.kind, d.title, d.mtime, d.tags,
                snippet(docs_fts, 1, char(2), char(3), '…', 16) AS snippet
           FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
          WHERE docs_fts MATCH ? ${w.sql}
          ORDER BY bm25(docs_fts, 5.0, 1.0)
          LIMIT ?`,
      )
      .all(match, ...w.params, limit)
  }
}

// Keeps the first of x.md and x.html, so a doc kept as both shows once.
function hits(rows: (Omit<SearchHit, "mtime"> & { mtime: number })[], limit: number): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const r of rows) {
    const twin = `${r.repo}/${r.path.replace(/\.(md|html)$/, "")}`
    if (seen.has(twin)) continue
    seen.add(twin)
    out.push({ ...r, mtime: new Date(r.mtime).toISOString() })
  }
  return out.slice(0, limit)
}

export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : ".")

// x.md and x.html are one doc for counting: the path without its extension, which is the kind.
const TWINS = "count(DISTINCT d.repo || '/' || substr(d.path, 1, length(d.path) - length(d.kind) - 1))"

function where(f: DocFilters, skip?: keyof DocFilters): { sql: string; params: (string | number)[] } {
  const parts: string[] = []
  const params: (string | number)[] = []
  for (const key of ["repo", "folder"] as const) {
    const values = f[key]
    if (key === skip || !values?.length) continue
    parts.push(`AND d.${key} IN (${values.map(() => "?").join(", ")})`)
    params.push(...values)
  }
  if (f.after !== undefined && skip !== "after") {
    parts.push("AND d.mtime >= ?")
    params.push(f.after)
  }
  return { sql: parts.join(" "), params }
}
