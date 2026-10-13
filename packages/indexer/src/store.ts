import { Database } from "bun:sqlite"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { htmlText, mdText, tagList, type DocText } from "./extract.ts"
import { scanDocs, type DocFile } from "./scan.ts"

export type Counts = { docs: number; md: number; html: number }
export type SyncResult = Counts & { added: number; changed: number; removed: number; ms: number }
/** `type` is "" for a doc with no `doc-type`. */
export type SearchHit = { repo: string; path: string; kind: DocFile["kind"]; title: string; snippet: string; mtime: string; tags: string; type: string }
/**
 * `folder` is the first folder inside the repo, "." for a doc at its top. `after` is a time in ms: only docs changed since.
 * `type` holds doc types, with `none` for a doc without one. Several values in one filter match any of them.
 */
export type DocFilters = { repo?: string[]; folder?: string[]; after?: number; type?: string[]; tag?: string[] }
/** Matching docs per repo, folder, type and tag, each counted with the other filters applied. Twins count once. */
export type Facets = { total: number; repo: Record<string, number>; folder: Record<string, number>; type: Record<string, number>; tag: Record<string, number> }
/** One row of the index, without its text. */
export type DocMeta = { repo: string; path: string; kind: DocFile["kind"]; title: string; mtime: number; size: number }
/** A row with its type ("" for none) and tags as written. */
export type DocRow = DocMeta & { type: string; tags: string }
/** Per repo: docs (twins once), files by kind, docs changed in the last week, docs untouched for 60 days, and the biggest folders. */
export type RepoOverview = { repo: string; docs: number; md: number; html: number; week: number; stale: number; last: string; folders: { folder: string; docs: number }[] }

/** Snippets wrap each match in these, so a client can mark them up without trusting the doc's text as HTML. */
export const MATCH_START = "\u0002"
export const MATCH_END = "\u0003"

const SCHEMA = `
  CREATE TABLE docs (
    id INTEGER PRIMARY KEY, repo TEXT NOT NULL, path TEXT NOT NULL, folder TEXT NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, mtime INTEGER NOT NULL, size INTEGER NOT NULL, tags TEXT NOT NULL, low INTEGER NOT NULL, type TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    UNIQUE (repo, path)
  );
  CREATE INDEX docs_doc_id ON docs (doc_id) WHERE doc_id != '';
  CREATE TABLE doc_tags (doc_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (tag, doc_id)) WITHOUT ROWID;
  CREATE VIRTUAL TABLE docs_fts USING fts5(title, path, body, tokenize = 'porter unicode61');
`

/** Folders whose docs rank after the rest: proof and leftovers, not the docs people look for. */
export const LOW_WEIGHT_FOLDERS = [/^evidence$/, /^trash$/, /^legacy/, /^backups$/, /^PR-reviews$/, /^fixtures?$/]
export const lowWeight = (path: string) => path.split("/").slice(0, -1).some((part) => LOW_WEIGHT_FOLDERS.some((re) => re.test(part)))

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
  /** Called after every sync that finished, with the index already updated. */
  onSync?: (result: SyncResult) => void

  constructor(public root: string) {
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
      this.db.run("DELETE FROM doc_tags")
      this.db.run("DELETE FROM docs")
      return this.diff()
    })
    this.queue = run.catch(() => {})
    return run
  }

  /**
   * Indexes another folder in place: files with the same mtime and size are kept, so search keeps
   * working through the switch and an rsync'd copy (which keeps mtimes) re-reads nothing.
   */
  moveTo(root: string): Promise<SyncResult> {
    const run = this.queue.then(() => {
      this.root = root
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
        this.db.run("DELETE FROM doc_tags WHERE doc_id = ?", [id])
        this.db.run("DELETE FROM docs WHERE id = ?", [id])
      }
      for (const { file, id, mtime, size, text } of reads) {
        const values = [file.kind, text.title, mtime, size, text.tags, text.type, text.contract.id ?? ""]
        let rowid = id
        if (rowid === undefined) {
          rowid = this.db
            .query<{ id: number }, (string | number)[]>("INSERT INTO docs (repo, path, folder, low, kind, title, mtime, size, tags, type, doc_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .get(file.repo, file.path, folderOf(file.path), Number(lowWeight(file.path)), ...values)!.id
        } else {
          this.db.run("UPDATE docs SET kind = ?, title = ?, mtime = ?, size = ?, tags = ?, type = ?, doc_id = ? WHERE id = ?", [...values, rowid])
          this.db.run("DELETE FROM docs_fts WHERE rowid = ?", [rowid])
          this.db.run("DELETE FROM doc_tags WHERE doc_id = ?", [rowid])
        }
        for (const tag of tagList(text.tags)) this.db.run("INSERT INTO doc_tags (doc_id, tag) VALUES (?, ?)", [rowid, tag])
        // The tokenizer splits the path on / - _ and ., so atlas-web-v1-spec.html reads as its words.
        this.db.run("INSERT INTO docs_fts (rowid, title, path, body) VALUES (?, ?, ?, ?)", [rowid, text.title, file.path, text.body])
      }
    })()
    const changed = reads.filter((r) => r.id !== undefined).length
    const result = { ...this.counts(), added: reads.length - changed, changed, removed: removed.length, ms: Math.round(performance.now() - started) }
    this.onSync?.(result)
    return result
  }

  files(): DocMeta[] {
    return this.db.query<DocMeta, []>("SELECT repo, path, kind, title, mtime, size FROM docs").all()
  }

  /** Every doc that passes the filters, both twins included. */
  list(opts: DocFilters = {}): DocRow[] {
    const w = where(opts)
    return this.db.query<DocRow, (string | number)[]>(`SELECT d.repo, d.path, d.kind, d.title, d.mtime, d.size, d.type, d.tags FROM docs d WHERE 1 = 1 ${w.sql}`).all(...w.params)
  }

  overview(now = Date.now(), opts: DocFilters = {}): RepoOverview[] {
    const week = now - 7 * 864e5
    const stale = now - 60 * 864e5
    const w = where(opts)
    const rows = this.db
      .query<Omit<RepoOverview, "folders" | "last"> & { last: number }, (string | number)[]>(
        `SELECT d.repo, ${TWINS} AS docs, sum(d.kind = 'md') AS md, sum(d.kind = 'html') AS html,
                count(DISTINCT CASE WHEN d.mtime >= ? THEN ${TWIN} END) AS week,
                count(DISTINCT CASE WHEN d.mtime < ? THEN ${TWIN} END) AS stale, max(d.mtime) AS last
           FROM docs d WHERE 1 = 1 ${w.sql} GROUP BY d.repo ORDER BY d.repo`,
      )
      .all(week, stale, ...w.params)
    const folders = this.db
      .query<{ repo: string; folder: string; docs: number }, (string | number)[]>(`SELECT d.repo, d.folder, ${TWINS} AS docs FROM docs d WHERE 1 = 1 ${w.sql} GROUP BY d.repo, d.folder ORDER BY docs DESC, d.folder`)
      .all(...w.params)
    return rows.map((r) => ({ ...r, last: new Date(r.last).toISOString(), folders: folders.filter((f) => f.repo === r.repo).map(({ folder, docs }) => ({ folder, docs })) }))
  }

  counts(): Counts {
    const rows = this.db.query<{ kind: string; n: number }, []>("SELECT kind, count(*) AS n FROM docs GROUP BY kind").all()
    const md = rows.find((r) => r.kind === "md")?.n ?? 0
    const html = rows.find((r) => r.kind === "html")?.n ?? 0
    return { docs: md + html, md, html }
  }

  /**
   * Three tiers: every word in the title or path, then the exact phrase anywhere, then every word
   * anywhere. In each, docs in low-weight folders come last, then bm25 with title and path weighted 5x.
   * A doc kept as both x.md and x.html shows once, at the better rank of the two, as the html.
   */
  search(q: string, opts: DocFilters & { limit?: number } = {}): SearchHit[] {
    const match = ftsQuery(q)
    if (!match) return []
    const limit = opts.limit ?? 20
    const phrase = ftsPhrase(q)
    const tiers = [`{title path} : (${match})`, ...(phrase ? [phrase] : []), match]
    return this.hits(tiers.flatMap((m) => this.query(m, opts, limit * 2)), limit)
  }

  /** The most recently changed docs, newest first, with no snippet. Twins show once, as in search. */
  recent(opts: DocFilters & { limit?: number } = {}): SearchHit[] {
    const limit = opts.limit ?? 20
    const w = where(opts)
    const rows = this.db
      .query<Omit<SearchHit, "mtime"> & { mtime: number }, (string | number)[]>(
        `SELECT d.repo, d.path, d.kind, d.title, d.mtime, d.tags, d.type, '' AS snippet FROM docs d
          WHERE 1 = 1 ${w.sql}
          ORDER BY d.mtime DESC, d.repo, d.path
          LIMIT ?`,
      )
      .all(...w.params, limit * 2)
    return this.hits(rows, limit)
  }

  /** Counts for the filters: every doc matching `q` (or every doc, when it is empty), not only the first page. */
  facets(q: string, opts: DocFilters = {}): Facets {
    const match = q.trim() ? ftsQuery(q) : null
    if (q.trim() && !match) return { total: 0, repo: {}, folder: {}, type: {}, tag: {} }
    // Phrase hits are a subset of all-words hits, so counting the all-words query covers both.
    const from = (join = "") => (match ? `FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid ${join} WHERE docs_fts MATCH ?` : `FROM docs d ${join} WHERE 1 = 1`)
    const count = (by: string | null, skip?: keyof DocFilters, join?: string) => {
      const w = where(opts, skip)
      return this.db
        .query<{ v: string; n: number }, (string | number)[]>(`SELECT ${by ?? "''"} AS v, ${TWINS} AS n ${from(join)} ${w.sql} ${by ? `GROUP BY ${by}` : ""}`)
        .all(...(match ? [match] : []), ...w.params)
    }
    const map = (rows: { v: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.v, r.n]))
    return {
      total: count(null)[0]?.n ?? 0,
      repo: map(count("d.repo", "repo")),
      folder: map(count("d.folder", "folder")),
      type: map(count(`CASE d.type WHEN '' THEN '${NO_TYPE}' ELSE d.type END`, "type")),
      tag: map(count("t.tag", "tag", "JOIN doc_tags t ON t.doc_id = d.id")),
    }
  }

  private query(match: string, opts: DocFilters, limit: number) {
    const w = where(opts)
    return this.db
      .query<Omit<SearchHit, "mtime"> & { mtime: number }, (string | number)[]>(
        `SELECT d.repo, d.path, d.kind, d.title, d.mtime, d.tags, d.type,
                snippet(docs_fts, 2, char(2), char(3), '…', 16) AS snippet
           FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
          WHERE docs_fts MATCH ? ${w.sql}
          ORDER BY d.low, bm25(docs_fts, 5.0, 5.0, 1.0)
          LIMIT ?`,
      )
      .all(match, ...w.params, limit)
  }

  /**
   * Where the doc with this id is now, as the html when it has twins. Null when no doc holds the id, or
   * when two docs do: a copied doc keeps its id, and the contract counts both as having none.
   */
  byId(id: string): DocMeta | null {
    const rows = this.db.query<DocMeta & { stem: string }, [string]>(`SELECT d.repo, d.path, d.kind, d.title, d.mtime, d.size, ${TWIN} AS stem FROM docs d WHERE d.doc_id = ? ORDER BY d.kind = 'md'`).all(id)
    if (!rows.length || rows.some((r) => r.stem !== rows[0]!.stem)) return null
    const { stem: _, ...doc } = rows[0]!
    return doc
  }

  /** Every file whose id no other doc holds, for the server's record of the paths each id has had. */
  ids(): { repo: string; path: string; id: string }[] {
    return this.db
      .query<{ repo: string; path: string; id: string }, []>(
        `SELECT d.repo, d.path, d.doc_id AS id FROM docs d
          WHERE d.doc_id != '' AND d.doc_id NOT IN (SELECT doc_id FROM docs d WHERE doc_id != '' GROUP BY doc_id HAVING count(DISTINCT ${TWIN}) > 1)`,
      )
      .all()
  }

  /** Ids held by more than one doc, each with its docs (twins once, as the html). Overview lists them. */
  duplicateIds(): { id: string; docs: { repo: string; path: string; title: string }[] }[] {
    const rows = this.db
      .query<{ id: string; repo: string; path: string; title: string; stem: string }, []>(
        `SELECT d.doc_id AS id, d.repo, d.path, d.title, ${TWIN} AS stem FROM docs d
          WHERE d.doc_id IN (SELECT doc_id FROM docs d WHERE doc_id != '' GROUP BY doc_id HAVING count(DISTINCT ${TWIN}) > 1)
          ORDER BY d.doc_id, d.repo, d.path, d.kind = 'md'`,
      )
      .all()
    const out = new Map<string, Map<string, { repo: string; path: string; title: string }>>()
    for (const { id, stem, ...doc } of rows) {
      const docs = out.get(id) ?? new Map()
      out.set(id, docs)
      if (!docs.has(stem)) docs.set(stem, doc)
    }
    return [...out].map(([id, docs]) => ({ id, docs: [...docs.values()] }))
  }

  /** The html twin of an md doc, or null. When both exist, the html is the doc (spec D25). */
  htmlTwin(repo: string, path: string): Omit<SearchHit, "mtime" | "snippet"> & { mtime: number } | null {
    if (!path.endsWith(".md")) return null
    return this.db
      .query<Omit<SearchHit, "mtime" | "snippet"> & { mtime: number }, [string, string]>("SELECT repo, path, kind, title, mtime, tags, type FROM docs WHERE repo = ? AND path = ?")
      .get(repo, `${path.slice(0, -3)}.html`)
  }

  // Keeps the first of x.md and x.html, so a doc kept as both shows once, and shows it as the html.
  private hits(rows: (Omit<SearchHit, "mtime"> & { mtime: number })[], limit: number): SearchHit[] {
    const seen = new Set<string>()
    const out: SearchHit[] = []
    for (const r of rows) {
      const twin = `${r.repo}/${r.path.replace(/\.(md|html)$/, "")}`
      if (seen.has(twin)) continue
      seen.add(twin)
      const doc = { ...r, ...this.htmlTwin(r.repo, r.path) }
      out.push({ ...doc, mtime: new Date(doc.mtime).toISOString() })
      if (out.length === limit) break
    }
    return out
  }
}

/** The `type` filter value for docs with no `doc-type`. */
export const NO_TYPE = "none"

export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : ".")

// x.md and x.html are one doc for counting: the path without its extension, which is the kind.
const TWIN = "d.repo || '/' || substr(d.path, 1, length(d.path) - length(d.kind) - 1)"
const TWINS = `count(DISTINCT ${TWIN})`

function where(f: DocFilters, skip?: keyof DocFilters): { sql: string; params: (string | number)[] } {
  const parts: string[] = []
  const params: (string | number)[] = []
  for (const key of ["repo", "folder"] as const) {
    const values = f[key]
    if (key === skip || !values?.length) continue
    parts.push(`AND d.${key} IN (${values.map(() => "?").join(", ")})`)
    params.push(...values)
  }
  if (f.type?.length && skip !== "type") {
    parts.push(`AND d.type IN (${f.type.map(() => "?").join(", ")})`)
    params.push(...f.type.map((t) => (t === NO_TYPE ? "" : t)))
  }
  if (f.tag?.length && skip !== "tag") {
    parts.push(`AND d.id IN (SELECT doc_id FROM doc_tags WHERE tag IN (${f.tag.map(() => "?").join(", ")}))`)
    params.push(...f.tag)
  }
  if (f.after !== undefined && skip !== "after") {
    parts.push("AND d.mtime >= ?")
    params.push(f.after)
  }
  return { sql: parts.join(" "), params }
}
