import { Database } from "bun:sqlite"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { htmlText, mdText, type DocText } from "./extract.ts"
import { scanDocs, type DocFile } from "./scan.ts"

export type Counts = { docs: number; md: number; html: number }
export type SyncResult = Counts & { added: number; changed: number; removed: number; ms: number }
export type SearchHit = { repo: string; path: string; kind: DocFile["kind"]; title: string; snippet: string; mtime: string; tags: string }

/** Snippets wrap each match in these, so a client can mark them up without trusting the doc's text as HTML. */
export const MATCH_START = "\u0002"
export const MATCH_END = "\u0003"

const SCHEMA = `
  CREATE TABLE docs (
    id INTEGER PRIMARY KEY, repo TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
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
            .query<{ id: number }, (string | number)[]>("INSERT INTO docs (repo, path, kind, title, mtime, size, tags) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .get(file.repo, file.path, ...values)!.id
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
  search(q: string, opts: { repo?: string[]; limit?: number } = {}): SearchHit[] {
    const match = ftsQuery(q)
    if (!match) return []
    const limit = opts.limit ?? 20
    const repos = opts.repo?.length ? opts.repo : null
    const phrase = ftsPhrase(q)
    const rows = [...(phrase ? this.query(phrase, repos, limit * 2) : []), ...this.query(match, repos, limit * 2)]
    const seen = new Set<string>()
    const hits: SearchHit[] = []
    for (const r of rows) {
      const twin = `${r.repo}/${r.path.replace(/\.(md|html)$/, "")}`
      if (seen.has(twin)) continue
      seen.add(twin)
      hits.push({ ...r, mtime: new Date(r.mtime).toISOString() })
    }
    return hits.slice(0, limit)
  }

  private query(match: string, repos: string[] | null, limit: number) {
    return this.db
      .query<Omit<SearchHit, "mtime"> & { mtime: number }, (string | number)[]>(
        `SELECT d.repo, d.path, d.kind, d.title, d.mtime, d.tags,
                snippet(docs_fts, 1, char(2), char(3), '…', 16) AS snippet
           FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
          WHERE docs_fts MATCH ? ${repos ? `AND d.repo IN (${repos.map(() => "?").join(", ")})` : ""}
          ORDER BY bm25(docs_fts, 5.0, 1.0)
          LIMIT ?`,
      )
      .all(match, ...(repos ?? []), limit)
  }
}
