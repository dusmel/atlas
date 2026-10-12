import { DocIndex, watchDocs } from "@atlas/indexer"
import { join } from "node:path"
import { dataDir } from "./app-db"
import { HttpError } from "./http"

let index: DocIndex | undefined
let ready: Promise<unknown> = Promise.resolve()

/** Built on first use, then kept current by the watcher. The container's health check calls this every 30 s, so it starts at boot. */
export function getIndex(): DocIndex {
  if (index) return index
  const docs = new DocIndex(join(dataDir(), "docs"))
  ready = docs.sync().then(
    (r) => console.log(`atlas: indexed ${r.docs} docs (${r.md} md, ${r.html} html) in ${r.ms} ms`),
    (err) => console.error("atlas: first docs index failed", err),
  )
  watchDocs(docs)
  index = docs
  return docs
}

export async function searchDocs(input: { q: string; repo: string[]; limit?: string }) {
  const limit = input.limit === undefined ? 20 : Number(input.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "bad_limit", "limit is a whole number from 1 to 100")
  const docs = getIndex()
  await ready
  return { q: input.q, results: docs.search(input.q, { repo: input.repo, limit }) }
}

export async function docsSummary() {
  const docs = getIndex()
  await ready
  return { ...docs.counts(), repos: docs.repos() }
}
