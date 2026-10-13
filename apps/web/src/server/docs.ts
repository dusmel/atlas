import { frontmatter } from "@atlas/doc-render"
import { DocIndex, htmlText, mdText, watchDocs, type SearchHit } from "@atlas/indexer"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join, posix } from "node:path"
import { getDb } from "./app-db"
import { docHref } from "@/lib/docs"
import { sinceMs } from "@/lib/since"
import { listDocEvents, recordDocChanges } from "./doc-activity"
import { closestDocs } from "./closest-docs"
import { repoExtras } from "./doc-overview"
import { docFile } from "./doc-files"
import { readMega, readSource, sourceRoot, writeSource, type Source } from "./docs-source"
import { HttpError } from "./http"
import { createShare, listShares, type Share } from "./shares"

let index: DocIndex | undefined
let ready: Promise<unknown> = Promise.resolve()
let unwatch = () => {}

/** Built on first use, then kept current by the watcher. The container's health check calls this every 30 s, so it starts at boot. */
export function getIndex(): DocIndex {
  if (index) return index
  const docs = new DocIndex(sourceRoot(readSource().source))
  docs.onSync = (r) => {
    if (!r.added && !r.changed && !r.removed) return
    try {
      recordDocChanges(getDb(), docs.files())
    } catch (err) {
      console.error("atlas: logging doc changes failed", err)
    }
  }
  ready = docs.sync().then(
    (r) => console.log(`atlas: indexed ${r.docs} docs (${r.md} md, ${r.html} html) in ${r.ms} ms`),
    (err) => console.error("atlas: first docs index failed", err),
  )
  unwatch = watchDocs(docs)
  index = docs
  return docs
}

/**
 * Serves and indexes the `atlas push` copy (`manual`) or MEGA's (`mega`). Holding again, as every
 * push does, only re-dates the switch. The index moves in place, so search keeps working.
 */
export async function holdDocs(source: Source) {
  const root = sourceRoot(source)
  if (!existsSync(root)) throw new HttpError(409, "no_manual_copy", `${root} is missing: create it on the box first (runbook R9)`)
  writeSource(source)
  const docs = getIndex()
  await ready
  if (docs.root !== root) {
    unwatch()
    const { docs: count, md, html } = await docs.moveTo(root)
    unwatch = watchDocs(docs)
    console.log(`atlas: docs source is now ${source}, ${count} docs (${md} md, ${html} html)`)
  }
  return docsStatus()
}

export function docsStatus() {
  return { ...readSource(), count: getIndex().counts().docs, mega: readMega() }
}

const filtersOf = (input: { repo: string[]; folder: string[]; since?: string }) => {
  const window = input.since === undefined ? undefined : sinceMs(input.since)
  if (window === null) throw new HttpError(400, "bad_since", "since is a number and a unit: 30m, 3h, 2d or 1w")
  return { repo: input.repo, folder: input.folder, after: window === undefined ? undefined : Date.now() - window }
}

export async function searchDocs(input: { q: string; repo: string[]; folder: string[]; since?: string; limit?: string }) {
  const limit = input.limit === undefined ? 20 : Number(input.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "bad_limit", "limit is a whole number from 1 to 100")
  const filters = filtersOf(input)
  const docs = getIndex()
  await ready
  // An empty query lists the most recently changed docs, for the page before anything is typed.
  const results = input.q.trim() ? docs.search(input.q, { ...filters, limit }) : docs.recent({ ...filters, limit })
  return { q: input.q, results: withTodos(results), facets: docs.facets(input.q, filters) }
}

export async function docsSummary() {
  const docs = getIndex()
  await ready
  return { ...docs.counts(), repos: docs.repos(), folders: Object.fromEntries(repoFolders()) }
}

export async function docsOverview() {
  const docs = getIndex()
  await ready
  const extras = repoExtras(docs.files(), linkedTodos())
  return { repos: docs.overview().map((r) => ({ ...r, ...extras.get(r.repo)! })), attention: attention() }
}

/** Groups with open todos and no doc, and group docs whose file the served copy lacks. */
function attention() {
  const groups = getDb()
    .query<{ id: number; name: string; repo_id: string; open: number; docs: number }, []>(
      `SELECT g.id, g.name, g.repo_id,
              (SELECT count(*) FROM items i WHERE i.group_id = g.id AND i.status != 'done' AND i.archived_at IS NULL) AS open,
              (SELECT count(*) FROM group_docs d WHERE d.group_id = g.id) AS docs
         FROM groups g`,
    )
    .all()
  const folders = repoFolders()
  const root = getIndex().root
  const missing = getDb()
    .query<{ group_id: number; name: string; repo_id: string; label: string; path: string }, []>("SELECT d.group_id, g.name, g.repo_id, d.label, d.path FROM group_docs d JOIN groups g ON g.id = d.group_id ORDER BY g.name, d.label")
    .all()
    .flatMap((d) => {
      const folder = folders.get(d.repo_id)
      // A repo with no docs folder here can't be checked.
      if (!folder) return []
      return docFile(root, folder, posix.normalize(d.path.replace(/^\.\//, ""))) ? [] : [{ ...d, folder }]
    })
  return { no_doc: groups.filter((g) => g.open > 0 && g.docs === 0).map(({ docs, ...g }) => g), missing }
}

export function docsActivity(input: { repo: string[]; folder: string[]; since?: string }) {
  const { after, ...filters } = filtersOf(input)
  return { events: listDocEvents(getDb(), { ...filters, after: after === undefined ? undefined : new Date(after).toISOString() }) }
}

// A group's doc paths are relative to its repo's folder under docs/, whose meta.json holds the todo repo id.
function repoFolders(): Map<string, string> {
  const root = getIndex().root
  const out = new Map<string, string>()
  let dirs: string[] = []
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return out
  }
  for (const dir of dirs) {
    try {
      const id = JSON.parse(readFileSync(join(root, dir, "meta.json"), "utf8")).id
      if (typeof id === "string") out.set(id, dir)
    } catch {
      // No meta.json: the folder has no todo repo.
    }
  }
  return out
}

const twin = (path: string) => path.replace(/\.(md|html)$/, "")

/** Open todos per doc (md and html as one), from the groups that link the doc under any label. */
function linkedTodos(): Map<string, { open: number; groups: number[] }> {
  const groups = getDb()
    .query<{ id: number; repo_id: string; path: string; open: number }, []>(
      `SELECT g.id, g.repo_id, d.path,
              (SELECT count(*) FROM items i WHERE i.group_id = g.id AND i.status != 'done' AND i.archived_at IS NULL) AS open
         FROM groups g JOIN group_docs d ON d.group_id = g.id`,
    )
    .all()
    .filter((g) => g.open > 0)
  const linked = new Map<string, { open: number; groups: number[] }>()
  if (!groups.length) return linked
  const folders = repoFolders()
  for (const g of groups) {
    const folder = folders.get(g.repo_id)
    if (!folder) continue
    const key = twin(posix.normalize(`${folder}/${g.path}`))
    const entry = linked.get(key) ?? { open: 0, groups: [] }
    if (entry.groups.includes(g.id)) continue
    entry.open += g.open
    entry.groups.push(g.id)
    linked.set(key, entry)
  }
  return linked
}

/** Adds the open todos in groups that link to each doc, as a count and the group ids to filter Todos by. */
function withTodos(hits: SearchHit[]) {
  const linked = linkedTodos()
  if (!linked.size) return hits
  return hits.map((h) => {
    const todos = linked.get(twin(`${h.repo}/${h.path}`))
    return todos ? { ...h, todos } : h
  })
}

/**
 * Adds where a todo's group docs open in `/r/`, null for one the served copy lacks, and the
 * docs folder of the todo's repo, which relative links in its body resolve against.
 */
export function withDocLinks<T extends { item: { repo_id: string }; group: { docs: { label: string; path: string }[] } | null }>(detail: T) {
  const folder = repoFolders().get(detail.item.repo_id) ?? null
  const href = (path: string) => {
    const rel = posix.normalize(path.replace(/^\.\//, ""))
    return folder && docFile(getIndex().root, folder, rel) ? docHref({ repo: folder, path: rel }) : null
  }
  return {
    ...detail,
    docs_folder: folder,
    group: detail.group && { ...detail.group, docs: detail.group.docs.map((d) => ({ ...d, href: href(d.path) })) },
  }
}

/** A doc's file in the copy being served, or a 404. */
export function findDoc(repo: string, path: string) {
  const file = docFile(getIndex().root, repo, path)
  if (!file) throw new HttpError(404, "not_found", `No doc ${repo}/${path}`)
  return file
}

/** What the frame's toolbar needs for `/r/<repo>/<path>`; the page itself loads from `/raw` (spec section 6). */
export async function viewDoc(repo: string, path: string) {
  const file = docFile(getIndex().root, repo, path)
  if (!file) {
    await ready
    throw new HttpError(404, "not_found", `No doc ${repo}/${path}`, { closest: closestDocs(getIndex().files(), repo, path) })
  }
  const kind = path.endsWith(".md") ? "md" : path.endsWith(".html") ? "html" : null
  if (!kind) throw new HttpError(400, "not_a_doc", "Only md and html files open as docs")
  const text = await Bun.file(file).text()
  const name = basename(path)
  const title = kind === "md" ? mdText(text, name).title : htmlText(text, name).title
  const type = (kind === "md" ? frontmatter(text).front["doc-type"] : /<meta\s+name="doc-type"\s+content="([^"]*)"/i.exec(text)?.[1]) || null
  const markdown = kind === "md" || !!docFile(getIndex().root, repo, `${path.slice(0, -5)}.md`)
  // An md twin's page is its html (spec D25). The app moves there, since links inside the app skip the server's redirect.
  const html = kind === "md" ? `${path.slice(0, -3)}.html` : null
  const htmlTwin = html && docFile(getIndex().root, repo, html) ? html : null
  const share = listShares(getDb()).find((s) => s.repo_id === repo && s.path === path) ?? null
  return { repo, path, kind, title, type, markdown, twin: htmlTwin, mtime: statSync(file).mtime.toISOString(), todos: linkedTodos().get(twin(`${repo}/${path}`)) ?? null, share }
}

export function shareDoc(repo: string, path: string): Share {
  findDoc(repo, path)
  return createShare(getDb(), repo, path)
}

/** Live shares with each doc's title, or null when the doc is gone from the served copy. */
export async function sharesWithTitles() {
  const docs = getIndex()
  await ready
  const titles = new Map(docs.files().map((f) => [`${f.repo}/${f.path}`, f.title]))
  return { shares: listShares(getDb()).map((s) => ({ ...s, title: titles.get(`${s.repo_id}/${s.path}`) ?? null })) }
}
