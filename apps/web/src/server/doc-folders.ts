import type { DocRow } from "@atlas/indexer"

export type FolderEntry = { name: string; docs: number; last: string }
export type FolderDoc = { repo: string; path: string; kind: DocRow["kind"]; title: string; type: string | null; tags: string; mtime: string }
export type FolderListing = { path: string; folders: FolderEntry[]; docs: FolderDoc[] }

/**
 * One level of the docs tree. `path` is "" for the root, whose folders are the repos, else `<repo>/<folder>/…`.
 * Twins count and show once, as the html. A folder with no doc under it is not listed.
 */
export function folderListing(rows: DocRow[], path: string): FolderListing {
  const [repo, ...rest] = path.split("/").filter(Boolean)
  const prefix = rest.length ? `${rest.join("/")}/` : ""
  const docs = new Map<string, DocRow>()
  for (const r of rows) {
    if ((repo !== undefined && r.repo !== repo) || !r.path.startsWith(prefix)) continue
    const key = `${r.repo}/${r.path.replace(/\.(md|html)$/, "")}`
    const seen = docs.get(key)
    docs.set(key, { ...(!seen || r.kind === "html" ? r : seen), mtime: Math.max(r.mtime, seen?.mtime ?? 0) })
  }
  const folders = new Map<string, { docs: number; last: number }>()
  const here: FolderDoc[] = []
  for (const d of docs.values()) {
    const rel = repo === undefined ? `${d.repo}/${d.path}` : d.path.slice(prefix.length)
    const slash = rel.indexOf("/")
    if (slash === -1) {
      here.push({ repo: d.repo, path: d.path, kind: d.kind, title: d.title, type: d.type || null, tags: d.tags, mtime: new Date(d.mtime).toISOString() })
      continue
    }
    const f = folders.get(rel.slice(0, slash)) ?? { docs: 0, last: 0 }
    f.docs++
    f.last = Math.max(f.last, d.mtime)
    folders.set(rel.slice(0, slash), f)
  }
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1)
  return {
    path: [repo, ...rest].filter(Boolean).join("/"),
    folders: [...folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, f]) => ({ name, docs: f.docs, last: new Date(f.last).toISOString() })),
    docs: here.sort((a, b) => name(a.path).localeCompare(name(b.path))),
  }
}
