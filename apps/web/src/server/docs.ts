import { DocIndex, watchDocs, type SearchHit } from "@atlas/indexer"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import { getDb } from "./app-db"
import { sinceMs } from "@/lib/since"
import { listDocEvents, recordDocChanges } from "./doc-activity"
import { readMega, readSource, sourceRoot, writeSource, type Source } from "./docs-source"
import { HttpError } from "./http"

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
  return { ...docs.counts(), repos: docs.repos() }
}

export async function docsOverview() {
  const docs = getIndex()
  await ready
  return { repos: docs.overview() }
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

/** Adds the open todos in groups that link to each doc, as a count and the group ids to filter Todos by. */
function withTodos(hits: SearchHit[]) {
  const groups = getDb()
    .query<{ id: number; repo_id: string; path: string; open: number }, []>(
      `SELECT g.id, g.repo_id, d.path,
              (SELECT count(*) FROM items i WHERE i.group_id = g.id AND i.status != 'done' AND i.archived_at IS NULL) AS open
         FROM groups g JOIN group_docs d ON d.group_id = g.id`,
    )
    .all()
    .filter((g) => g.open > 0)
  if (!groups.length) return hits
  const folders = repoFolders()
  const linked = new Map<string, { open: number; groups: number[] }>()
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
  return hits.map((h) => {
    const todos = linked.get(twin(`${h.repo}/${h.path}`))
    return todos ? { ...h, todos } : h
  })
}
