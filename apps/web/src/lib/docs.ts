import { ActivityIcon, ChartColumnIcon, SearchIcon } from "lucide-react"

export type Hit = { repo: string; path: string; kind: "md" | "html"; title: string; snippet: string; mtime: string; tags: string; todos?: { open: number; groups: number[] } }
export type Facets = { total: number; repo: Record<string, number>; folder: Record<string, number> }
export type Summary = { docs: number; md: number; html: number; repos: { name: string; docs: number }[] }
export type DocEvent = { id: number; at: string; change: "added" | "changed" | "removed"; repo: string; path: string; kind: string; kinds: string[]; title: string }
export type RepoOverview = { repo: string; docs: number; md: number; html: number; week: number; stale: number; last: string; folders: { folder: string; docs: number }[] }
export type MegaPair = { path: string; run: string; status: string; error: string }
export type DocsStatus = {
  source: "mega" | "manual"
  since: string | null
  count: number
  mega: { state: "unknown" | "ok" | "syncing" | "failed"; checked: string | null; last_pull: string | null; pairs: MegaPair[]; detail?: string; pull_requested?: string | null }
}
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
