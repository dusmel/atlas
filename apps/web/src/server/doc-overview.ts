import type { DocMeta } from "@atlas/indexer"

export type DocRef = { repo: string; path: string; title: string; mtime: string }
export type LinkedDoc = DocRef & { open: number; groups: number[] }
export type RepoExtras = { days: number[]; changed: DocRef[]; todo_docs: LinkedDoc[]; stale_plans: LinkedDoc[] }

const DAY = 864e5
const stem = (path: string) => path.replace(/\.(md|html)$/, "")

/**
 * Per repo: docs last changed on each of the last 30 days (oldest first), this week's docs, docs that
 * groups with open todos link to, and those of them untouched for 60 days. Twins count once, as the html.
 * `linked` is keyed `repo/path` without the extension, as `linkedTodos` builds it.
 */
export function repoExtras(files: DocMeta[], linked: Map<string, { open: number; groups: number[] }>, now = Date.now(), list = 5): Map<string, RepoExtras> {
  const docs = new Map<string, DocMeta>()
  for (const f of files) {
    const key = `${f.repo}/${stem(f.path)}`
    const seen = docs.get(key)
    docs.set(key, { ...(!seen || f.kind === "html" ? f : seen), mtime: Math.max(f.mtime, seen?.mtime ?? 0) })
  }
  const out = new Map<string, RepoExtras>()
  const today = Math.floor(now / DAY)
  const ref = (d: DocMeta): DocRef => ({ repo: d.repo, path: d.path, title: d.title, mtime: new Date(d.mtime).toISOString() })
  const newest = [...docs].sort((a, b) => b[1].mtime - a[1].mtime)
  for (const [key, d] of newest) {
    const r = out.get(d.repo) ?? { days: Array<number>(30).fill(0), changed: [], todo_docs: [], stale_plans: [] }
    out.set(d.repo, r)
    const age = today - Math.floor(d.mtime / DAY)
    if (age >= 0 && age < 30) r.days[29 - age]!++
    if (now - d.mtime < 7 * DAY && r.changed.length < list) r.changed.push(ref(d))
    const todos = linked.get(key)
    if (!todos) continue
    r.todo_docs.push({ ...ref(d), ...todos })
    if (now - d.mtime >= 60 * DAY) r.stale_plans.push({ ...ref(d), ...todos })
  }
  for (const r of out.values()) {
    r.todo_docs = r.todo_docs.sort((a, b) => b.open - a.open).slice(0, list)
    r.stale_plans = r.stale_plans.sort((a, b) => a.mtime.localeCompare(b.mtime)).slice(0, list)
  }
  return out
}
