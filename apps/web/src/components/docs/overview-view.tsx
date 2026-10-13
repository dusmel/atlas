import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { BoxIcon, FileWarningIcon, FolderXIcon, ListTodoIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { docHref, folderLabel, type Attention, type DocRef, type LinkedDoc, type RepoOverview } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

const card = "rounded-xl border bg-card"
const link = "rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** A card per repo, the most recently changed first, under the totals and what needs attention. */
export function DocOverview({ repos }: { repos: string[] }) {
  const q = useQuery({ queryKey: ["doc-overview"], queryFn: () => api<{ repos: RepoOverview[]; attention: Attention }>("/docs/overview") })
  if (q.isPending)
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the overview">
        <Skeleton className="h-20" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-64" />
          ))}
        </div>
      </div>
    )
  if (q.isError) return <p className="text-sm text-destructive">{q.error.message}</p>
  const rows = q.data.repos.filter((r) => !repos.length || repos.includes(r.repo)).sort((a, b) => b.last.localeCompare(a.last))
  const sum = (f: (r: RepoOverview) => number) => rows.reduce((n, r) => n + f(r), 0)
  const stats = [
    { label: "Docs", value: sum((r) => r.docs) },
    { label: "Changed this week", value: sum((r) => r.week) },
    { label: "With open todos", value: sum((r) => r.todo_docs.length) },
    { label: "Untouched for 60 days", value: sum((r) => r.stale) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <dl aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={cn(card, "flex flex-col-reverse px-4 py-3")}>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      <NeedsAttention attention={q.data.attention} />
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((r) => (
          <RepoCard key={r.repo} r={r} />
        ))}
      </div>
    </div>
  )
}

function NeedsAttention({ attention }: { attention: Attention }) {
  const total = attention.no_doc.length + attention.missing.length
  if (!total) return null
  return (
    <section aria-labelledby="attention" className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <h2 id="attention" className="flex items-center gap-2 text-sm font-medium">
        <TriangleAlertIcon aria-hidden className="size-4 text-amber-600 dark:text-amber-400" />
        Needs attention
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{total}</span>
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {attention.missing.map((m) => (
          <li key={`${m.group_id}-${m.label}`} data-attention="missing" className="flex min-w-0 items-center gap-2">
            <FileWarningIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">
              <Link to="/todos" search={{ view: "list", group: String(m.group_id) }} className={link}>
                {m.name}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                links its {m.label} to <code className="font-mono text-xs">{m.path}</code>, which is not in {m.folder}
              </span>
            </span>
          </li>
        ))}
        {attention.no_doc.map((g) => (
          <li key={g.id} data-attention="no-doc" className="flex min-w-0 items-center gap-2">
            <FolderXIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">
              <Link to="/todos" search={{ view: "list", group: String(g.id) }} className={link}>
                {g.name}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                has {g.open} open {g.open === 1 ? "todo" : "todos"} and no doc
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RepoCard({ r }: { r: RepoOverview }) {
  return (
    <section data-repo={r.repo} aria-labelledby={`docs-${r.repo}`} className={cn(card, "flex min-w-0 flex-col gap-4 p-4")}>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`docs-${r.repo}`} className="font-medium">
            <Link to="/docs" search={{ repo: r.repo }} className={cn(link, "flex items-center gap-2")} translate="no">
              <BoxIcon className="size-4 text-muted-foreground" aria-hidden />
              {r.repo}
            </Link>
          </h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            <span data-count="docs" className="text-sm font-medium text-foreground">
              {r.docs}
            </span>{" "}
            docs · {r.md} md, {r.html} html · changed{" "}
            <time dateTime={r.last} title={exact(r.last)}>
              {ago(r.last)}
            </time>
          </p>
        </div>
        <Days days={r.days} repo={r.repo} />
      </header>
      <DocList title="Changed this week" docs={r.changed} empty="Nothing this week." />
      {r.todo_docs.length > 0 && <DocList title="With open todos" docs={r.todo_docs} />}
      {r.stale_plans.length > 0 && <DocList title="Plans untouched for 60 days, with open todos" docs={r.stale_plans} />}
      <p className="mt-auto truncate text-xs text-muted-foreground">
        {r.folders
          .slice(0, 4)
          .map((f) => `${folderLabel(f.folder)} ${f.docs}`)
          .join(" · ")}
      </p>
    </section>
  )
}

/** One bar per day for 30 days, today on the right: how many docs were last changed that day. */
function Days({ days, repo }: { days: number[]; repo: string }) {
  const max = Math.max(1, ...days)
  const total = days.reduce((a, b) => a + b, 0)
  return (
    <figure className="flex flex-col gap-1">
      <div aria-hidden className="flex h-10 items-end gap-0.5">
        {days.map((n, i) => (
          <span key={i} title={`${n} on ${new Date(Date.now() - (29 - i) * 864e5).toLocaleDateString()}`} className={cn("flex-1 rounded-sm", n ? "bg-primary/70" : "bg-muted")} style={{ height: n ? `${Math.max(12, (n / max) * 100)}%` : "3px" }} />
        ))}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {total} {total === 1 ? "doc" : "docs"} in {repo} last changed in the past 30 days
      </figcaption>
    </figure>
  )
}

function DocList({ title, docs, empty }: { title: string; docs: (DocRef | LinkedDoc)[]; empty?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {docs.length ? (
        <ul aria-label={title} className="flex flex-col">
          {docs.map((d) => (
            <li key={d.path}>
              <a href={docHref(d)} className="-mx-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1.5 py-1 text-sm hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <span className="truncate">{d.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {"open" in d && (
                    <span className="flex items-center gap-1" title={`${d.open} open todos`}>
                      <ListTodoIcon aria-hidden className="size-3.5" />
                      {d.open}
                    </span>
                  )}
                  <time dateTime={d.mtime} title={exact(d.mtime)}>
                    {ago(d.mtime)}
                  </time>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}
