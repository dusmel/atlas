import { DocIndex, fastWins, htmlText, mdText, watchDocs, type SearchHit } from "@atlas/indexer"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { mkdir, utimes } from "node:fs/promises"
import { basename, join } from "node:path"
import { getDb } from "./app-db"
import { docHref } from "@/lib/docs"
import { sinceMs } from "@/lib/since"
import { docEventDays, listDocEvents, recordDocChanges } from "./doc-activity"
import { folderListing } from "./doc-folders"
import { closestDocs } from "./closest-docs"
import { groupDocPath, movedFrom, placeOf, recordDocIds, type Place } from "./doc-ids"
import { repoExtras } from "./doc-overview"
import { docFile } from "./doc-files"
import { fastRoot, readMega, readSource, sourceRoot, writeSource, type Source } from "./docs-source"
import { HttpError } from "./http"
import { createShare, listShares, type Share } from "./shares"

let index: DocIndex | undefined
let ready: Promise<unknown> = Promise.resolve()
let unwatch = () => {}

/** Built on first use, then kept current by the watcher. The container's health check calls this every 30 s, so it starts at boot. */
export function getIndex(): DocIndex {
  if (index) return index
  const docs = new DocIndex(sourceRoot(readSource().source), fastRoot())
  docs.onSync = (r) => {
    if (!r.added && !r.changed && !r.removed) return
    try {
      recordDocChanges(getDb(), docs.files())
    } catch (err) {
      console.error("atlas: logging doc changes failed", err)
    }
    try {
      recordDocIds(getDb(), docs, repoFolders())
    } catch (err) {
      console.error("atlas: recording doc ids failed", err)
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

/** A file in the copy being served, or its fast copy while that is newer, by the index's rule. Null when neither has it. */
export function servedFile(repo: string, path: string): string | null {
  const base = docFile(getIndex().root, repo, path)
  const fast = docFile(fastRoot(), repo, path)
  return fast && fastWins(statSync(fast).mtimeMs, base ? statSync(base).mtimeMs : null) ? fast : base
}

const MAX_PUBLISH = 5 * 1024 * 1024

/**
 * `atlas doc publish`: keeps the doc in the fast folder with the Mac's mtime, to the second, and indexes
 * it before answering, so its link works at once. MEGA's copy takes over once it arrives (spec section 9).
 */
export async function publishDoc(input: Record<string, unknown>) {
  const { repo, path, mtime, text } = input
  if (typeof repo !== "string" || typeof path !== "string") throw new HttpError(400, "bad_field", "Send repo and path, as in /r/<repo>/<path>")
  const parts = [repo, ...path.split("/")]
  if (parts.some((p) => !p || p.startsWith(".") || p.includes("\\") || p.includes("\0")) || !/\.(md|html)$/.test(path)) {
    throw new HttpError(400, "bad_path", "repo and path name an md or html file inside a repo's docs folder, with no hidden or .. parts")
  }
  if (typeof mtime !== "number" || !Number.isFinite(mtime) || mtime <= 0) throw new HttpError(400, "bad_mtime", "mtime is the file's modification time in ms since 1970")
  if (typeof text !== "string") throw new HttpError(400, "bad_field", "text holds the doc")
  if (Buffer.byteLength(text) > MAX_PUBLISH) throw new HttpError(413, "too_large", "A doc over 5 MB waits for MEGA")
  const file = join(fastRoot(), ...parts)
  await mkdir(join(file, ".."), { recursive: true })
  await Bun.write(file, text)
  const seconds = Math.floor(mtime / 1000)
  await utimes(file, seconds, seconds)
  const docs = getIndex()
  await ready
  await docs.sync()
  // The sync deletes a fast copy the served copy has caught up with, so a kept one is the one served.
  return { repo, path, href: docHref({ repo, path }), fast: existsSync(file) }
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

/** The filters every Docs view takes. Several values in one filter match any of them. */
export type FilterInput = { repo: string[]; folder: string[]; type: string[]; tag: string[]; since?: string }

const many = (url: URL, key: string) => url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean)

/** The filters from a request's query string, as the Docs page sends them. */
export const filterInput = (url: URL): FilterInput => ({
  repo: many(url, "repo"),
  folder: many(url, "folder"),
  type: many(url, "type"),
  tag: many(url, "tag"),
  since: url.searchParams.get("since") ?? undefined,
})

const filtersOf = (input: FilterInput) => {
  const window = input.since === undefined ? undefined : sinceMs(input.since)
  if (window === null) throw new HttpError(400, "bad_since", "since is a number and a unit: 30m, 3h, 2d or 1w")
  return { repo: input.repo, folder: input.folder, type: input.type, tag: input.tag.map((t) => t.toLowerCase()), after: window === undefined ? undefined : Date.now() - window }
}

export async function searchDocs(input: FilterInput & { q: string; limit?: string }) {
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
  const all = docs.facets("")
  return { ...docs.counts(), repos: docs.repos(), types: all.type, tags: all.tag, folders: Object.fromEntries(repoFolders()) }
}

/** Overview takes the type and tag filters; its repos are filtered on the page, and attention is about groups, not docs. */
export async function docsOverview(input: Pick<FilterInput, "type" | "tag">) {
  const docs = getIndex()
  await ready
  const filters = filtersOf({ repo: [], folder: [], ...input })
  const extras = repoExtras(docs.list(filters), linkedTodos())
  return { repos: docs.overview(Date.now(), filters).map((r) => ({ ...r, ...extras.get(r.repo)! })), attention: attention() }
}

/** One level of the docs tree, narrowed by the repo, type and tag filters. */
export async function docsFolder(path: string, input: Pick<FilterInput, "repo" | "type" | "tag">) {
  const docs = getIndex()
  await ready
  return folderListing(docs.list(filtersOf({ folder: [], ...input })), path)
}

/** Groups with open todos and no doc, group docs whose file the served copy lacks, and ids two docs hold. */
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
  const missing = getDb()
    .query<{ group_id: number; name: string; repo_id: string; label: string; path: string; doc_id: string | null }, []>(
      "SELECT d.group_id, g.name, g.repo_id, d.label, d.path, d.doc_id FROM group_docs d JOIN groups g ON g.id = d.group_id ORDER BY g.name, d.label",
    )
    .all()
    .flatMap(({ doc_id, ...d }) => {
      const folder = folders.get(d.repo_id)
      // A repo with no docs folder here can't be checked.
      if (!folder) return []
      const at = placeOf(getIndex(), doc_id, { repo: folder, path: groupDocPath(d.path) })
      return servedFile(at.repo, at.path) ? [] : [{ ...d, folder }]
    })
  return { no_doc: groups.filter((g) => g.open > 0 && g.docs === 0).map(({ docs, ...g }) => g), missing, duplicates: getIndex().duplicateIds() }
}

/**
 * The log keeps no type or tags, so those filters match the docs the index has now. A removed doc
 * has neither, so it drops out while they are set.
 */
async function eventFilters(input: FilterInput) {
  const { after, type, tag, ...filters } = filtersOf(input)
  if (!type.length && !tag.length) return { ...filters, after }
  const docs = getIndex()
  await ready
  return { ...filters, after, paths: docs.list({ type, tag }).map((d) => `${d.repo}/${d.path}`) }
}

export async function docsActivity(input: FilterInput) {
  const { after, ...filters } = await eventFilters(input)
  return { events: listDocEvents(getDb(), { ...filters, after: after === undefined ? undefined : new Date(after).toISOString() }) }
}

export async function docsActivityDays(input: FilterInput, tz: string | null) {
  const { after: _, ...filters } = await eventFilters(input)
  return docEventDays(getDb(), { ...filters, tz })
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

/** The groups that link each doc (md and html as one) under any label, and the open todos in them. */
function linkedGroups(): Map<string, { open: number; groups: number[]; names: { id: number; name: string }[] }> {
  const groups = getDb()
    .query<{ id: number; name: string; repo_id: string; path: string; doc_id: string | null; open: number }, []>(
      `SELECT g.id, g.name, g.repo_id, d.path, d.doc_id,
              (SELECT count(*) FROM items i WHERE i.group_id = g.id AND i.status != 'done' AND i.archived_at IS NULL) AS open
         FROM groups g JOIN group_docs d ON d.group_id = g.id ORDER BY g.name`,
    )
    .all()
  const linked = new Map<string, { open: number; groups: number[]; names: { id: number; name: string }[] }>()
  if (!groups.length) return linked
  const folders = repoFolders()
  // A group can link both twins of a doc; count it once.
  const seen = new Set<string>()
  for (const g of groups) {
    const folder = folders.get(g.repo_id)
    if (!folder) continue
    const at = placeOf(getIndex(), g.doc_id, { repo: folder, path: groupDocPath(g.path) })
    const key = twin(`${at.repo}/${at.path}`)
    if (seen.has(`${g.id} ${key}`)) continue
    seen.add(`${g.id} ${key}`)
    const entry = linked.get(key) ?? { open: 0, groups: [], names: [] }
    linked.set(key, entry)
    entry.names.push({ id: g.id, name: g.name })
    if (!g.open) continue
    entry.open += g.open
    entry.groups.push(g.id)
  }
  return linked
}

/** Open todos per doc, from the groups that link it: a count and the group ids to filter Todos by. */
function linkedTodos(): Map<string, { open: number; groups: number[] }> {
  const out = new Map<string, { open: number; groups: number[] }>()
  for (const [key, { open, groups }] of linkedGroups()) if (open) out.set(key, { open, groups })
  return out
}

/** Adds the names of the groups that link each doc, and the open todos in them. */
function withTodos(hits: SearchHit[]) {
  const linked = linkedGroups()
  if (!linked.size) return hits
  return hits.map((h) => {
    const entry = linked.get(twin(`${h.repo}/${h.path}`))
    if (!entry) return h
    return { ...h, groups: entry.names, ...(entry.open ? { todos: { open: entry.open, groups: entry.groups } } : {}) }
  })
}

/**
 * Adds where a todo's group docs open in `/r/`, null for one the served copy lacks, and the
 * docs folder of the todo's repo, which relative links in its body resolve against.
 */
export function withDocLinks<T extends { item: { repo_id: string }; group: { id: number; docs: { label: string; path: string }[] } | null }>(detail: T) {
  const folder = repoFolders().get(detail.item.repo_id) ?? null
  const ids = new Map(
    detail.group ? getDb().query<{ label: string; doc_id: string | null }, [number]>("SELECT label, doc_id FROM group_docs WHERE group_id = ?").all(detail.group.id).map((d) => [d.label, d.doc_id]) : [],
  )
  const href = (d: { label: string; path: string }) => {
    if (!folder) return null
    // A doc with an id is found where it is now, after a rename or a move.
    const at = placeOf(getIndex(), ids.get(d.label) ?? null, { repo: folder, path: groupDocPath(d.path) })
    return servedFile(at.repo, at.path) ? docHref(at) : null
  }
  return {
    ...detail,
    docs_folder: folder,
    group: detail.group && { ...detail.group, docs: detail.group.docs.map((d) => ({ ...d, href: href(d) })) },
  }
}

/** A doc's file in the copy being served, or a 404. */
export function findDoc(repo: string, path: string) {
  const file = servedFile(repo, path)
  if (!file) throw new HttpError(404, "not_found", `No doc ${repo}/${path}`)
  return file
}

/** A doc's text and contract, read from its file. */
async function readDoc(file: string, path: string) {
  const text = await Bun.file(file).text()
  return path.endsWith(".md") ? mdText(text, basename(path)) : htmlText(text, basename(path))
}

/** The doc's id when no other doc holds it (spec section 9), else null. */
const ownId = (id: string | null) => (id && getIndex().byId(id) ? id : null)

/**
 * What the frame's toolbar needs for `/r/<repo>/<path>`; the page itself loads from `/raw` (spec section 6).
 * A 404 carries `moved` when a doc with an id once lived at the path and now lives elsewhere.
 */
export async function viewDoc(repo: string, path: string) {
  const file = servedFile(repo, path)
  if (!file) {
    await ready
    const moved = movedFrom(getDb(), getIndex(), { repo, path })
    throw new HttpError(404, "not_found", `No doc ${repo}/${path}`, { closest: closestDocs(getIndex().files(), repo, path), moved })
  }
  const kind = path.endsWith(".md") ? "md" : path.endsWith(".html") ? "html" : null
  if (!kind) throw new HttpError(400, "not_a_doc", "Only md and html files open as docs")
  const { title, type, contract } = await readDoc(file, path)
  const markdown = kind === "md" || !!contract.md || !!servedFile(repo, `${path.slice(0, -5)}.md`)
  // An md twin's page is its html (spec D25). The app moves there, since links inside the app skip the server's redirect.
  const html = kind === "md" ? `${path.slice(0, -3)}.html` : null
  const htmlTwin = html && servedFile(repo, html) ? html : null
  const id = ownId(contract.id)
  const share = listShares(getDb()).find((s) => (id && s.doc_id === id) || (s.repo_id === repo && s.path === path)) ?? null
  const todo = contract.todo === null ? null : (getDb().query<{ id: number; title: string; status: string }, [number]>("SELECT id, title, status FROM items WHERE id = ?").get(contract.todo) ?? null)
  const { md: _, ...fields } = contract
  return {
    repo,
    path,
    kind,
    id,
    title,
    type: type || null,
    markdown,
    twin: htmlTwin,
    mtime: statSync(file).mtime.toISOString(),
    todos: linkedTodos().get(twin(`${repo}/${path}`)) ?? null,
    todo,
    share,
    contract: { ...fields, id },
  }
}

/** A doc's markdown for agents and Copy as Markdown: an md file as written, else an html doc's `atlas-md` block, else its md twin. */
export async function docMarkdown(repo: string, path: string): Promise<string | null> {
  const file = servedFile(repo, path)
  if (path.endsWith(".md")) return file ? Bun.file(file).text() : null
  if (!path.endsWith(".html")) return null
  const block = file && (await readDoc(file, path)).contract.md
  if (block) return `${block}\n`
  const md = servedFile(repo, `${path.slice(0, -5)}.md`)
  return md ? Bun.file(md).text() : null
}

export async function shareDoc(repo: string, path: string): Promise<Share> {
  const file = findDoc(repo, path)
  return createShare(getDb(), repo, path, ownId((await readDoc(file, path)).contract.id))
}

/** Where a share's doc is now: found by its id after a move, else at the path it was shared from. */
export const sharePlace = (share: Share): Place => placeOf(getIndex(), share.doc_id, { repo: share.repo_id, path: share.path })

/** Live shares with each doc's current place and title, or a null title when the doc is gone from the served copy. */
export async function sharesWithTitles() {
  const docs = getIndex()
  await ready
  const titles = new Map(docs.files().map((f) => [`${f.repo}/${f.path}`, f.title]))
  return {
    shares: listShares(getDb()).map((s) => {
      const at = sharePlace(s)
      return { ...s, repo_id: at.repo, path: at.path, title: titles.get(`${at.repo}/${at.path}`) ?? null }
    }),
  }
}
