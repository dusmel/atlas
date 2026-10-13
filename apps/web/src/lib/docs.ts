import { defaultUrlTransform } from "react-markdown"
import { ActivityIcon, ChartColumnIcon, SearchIcon } from "lucide-react"

export type Hit = { repo: string; path: string; kind: "md" | "html"; title: string; snippet: string; mtime: string; tags: string; todos?: { open: number; groups: number[] } }
export type Facets = { total: number; repo: Record<string, number>; folder: Record<string, number> }
/** `folders` maps a todo repo id to its docs folder, from the folder's meta.json. */
export type Summary = { docs: number; md: number; html: number; repos: { name: string; docs: number }[]; folders: Record<string, string> }
export type DocEvent = { id: number; at: string; change: "added" | "changed" | "removed"; repo: string; path: string; kind: string; kinds: string[]; title: string }
export type RepoOverview = { repo: string; docs: number; md: number; html: number; week: number; stale: number; last: string; folders: { folder: string; docs: number }[] }
export type MegaPair = { path: string; run: string; status: string; error: string }
export type DocsStatus = {
  source: "mega" | "manual"
  since: string | null
  count: number
  mega: { state: "unknown" | "ok" | "syncing" | "failed"; checked: string | null; last_pull: string | null; pairs: MegaPair[]; detail?: string; pull_requested?: string | null }
}
export type Share = { token: string; repo_id: string; path: string; created_at: string; revoked_at: string | null }
export type DocPage = { repo: string; path: string; kind: "md" | "html"; title: string; type: string | null; markdown: boolean; twin: string | null; mtime: string; todos: { open: number; groups: number[] } | null; share: Share | null }
export type Option = { value: string; label: string; count: number }

export const DOC_VIEWS = [
  { id: "search", label: "Search", icon: SearchIcon },
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "overview", label: "Overview", icon: ChartColumnIcon },
] as const
export type DocView = (typeof DOC_VIEWS)[number]["id"]

// Several repos or folders sit in the URL comma-separated, as on Todos.
export const list = (v?: string) => (v ? v.split(",").filter(Boolean) : [])
export const joined = (values: string[]) => (values.length ? values.join(",") : undefined)
export const flip = (values: string[], v: string) => (values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
export const folderLabel = (f: string) => (f === "." ? "Top level" : f)

/** What Enter and the copy button copy: the path from the repo's root, where atlas/ holds the docs. */
export const docPath = (d: { path: string }) => `atlas/${d.path}`
export const docKey = (d: { repo: string; path: string }) => `${d.repo}/${d.path}`

const segments = (d: { repo: string; path: string }) => [d.repo, ...d.path.split("/")].map(encodeURIComponent).join("/")
/** The doc's page in the frame. Each segment is encoded, so spaces and # survive. */
export const docHref = (d: { repo: string; path: string }) => `/r/${segments(d)}`
/** The doc itself, as the frame's iframe loads it. */
export const rawHref = (d: { repo: string; path: string }) => `/raw/${segments(d)}`

/**
 * ReactMarkdown's urlTransform for a todo body: a relative link opens that doc in /r/, read from
 * the repo's atlas/ folder. `atlas/` in front is dropped, since that is how copied paths start.
 */
export const docLinks = (folder: string | null) => (url: string) => {
  if (!folder || /^([a-z][a-z0-9+.-]*:|[#/?])/i.test(url)) return defaultUrlTransform(url)
  const [path = "", hash = ""] = url.split(/(?=#)/)
  const parts: string[] = []
  for (const p of path.replace(/^(\.\/)?atlas\//, "").split("/")) {
    if (p === "..") {
      if (!parts.pop()) return defaultUrlTransform(url)
    } else if (p && p !== ".") parts.push(p)
  }
  return parts.length ? docHref({ repo: folder, path: parts.map(decodeURIComponent).join("/") }) + hash : defaultUrlTransform(url)
}
