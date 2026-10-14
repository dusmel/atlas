import { useQuery } from "@tanstack/react-query"
import { Link, useSearch } from "@tanstack/react-router"
import { ArrowDownRightIcon, ArrowUpRightIcon, BoxIcon, CopyXIcon, FileWarningIcon, FolderXIcon, ListTodoIcon, MinusIcon, TriangleAlertIcon } from "lucide-react"
import { Fragment } from "react"
import { cn } from "cn"
import { Skeleton } from "@/components/ui/skeleton"
import { DesignReport, DesignTrends } from "./overview-designs"
import { api } from "@/lib/api"
import { ageTone, useRepoColor } from "@/lib/doc-colors"
import { docHref, docKey, type Attention, type DocRef, type LinkedDoc, type RepoOverview } from "@/lib/docs"
import { exact, stamp } from "@/lib/format"

const card = "rounded-2xl border bg-card p-5 shadow-xs"
const link = "rounded underline-offset-4 hover:text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })
const dayAt = (i: number) => new Date(Date.now() - (29 - i) * 864e5)
const add = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
// Diagonal stripes in the current colour, for "nothing here" and "old".
const HATCH = "repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 5px)"
// A day with more dots than this shows CAP dots, shared out by repo, and its count on top.
const CAP = 12

/** One number for the week, a dot per doc changed, how fresh the docs are, and each repo's share. */
/** `params` carries the type and tag filters; repos are filtered here. */
export function DocOverview({ repos, params }: { repos: string[]; params: URLSearchParams }) {
  const typeTag = new URLSearchParams([...params].filter(([k]) => k === "type" || k === "tag"))
  const q = useQuery({ queryKey: ["doc-overview", typeTag.toString()], queryFn: () => api<{ repos: RepoOverview[]; attention: Attention }>(`/docs/overview?${typeTag}`) })
  const design = useSearch({ from: "/docs", select: (s) => s.design })
  if (q.isPending)
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the overview">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-36 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  if (q.isError) return <p className="text-sm text-destructive">{q.error.message}</p>

  const rows = q.data.repos.filter((r) => !repos.length || repos.includes(r.repo)).sort((a, b) => b.last.localeCompare(a.last))
  const sum = (f: (r: RepoOverview) => number) => add(rows.map(f))
  const t = {
    docs: sum((r) => r.docs),
    week: sum((r) => add(r.days.slice(-7))),
    lastWeek: sum((r) => add(r.days.slice(-14, -7))),
    month: sum((r) => add(r.days)),
    todos: sum((r) => r.todo_docs.length),
    stale: sum((r) => r.stale),
  }
  const Design = design === "report" ? DesignReport : design === "trends" ? DesignTrends : null
  if (Design)
    return (
      <div className="flex flex-col gap-4">
        <DesignSwitch />
        <Design rows={rows} attention={q.data.attention} NeedsAttention={NeedsAttention} />
      </div>
    )
  const newest = <T extends DocRef>(docs: T[]) => [...docs].sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 6)

  return (
    <div className="flex flex-col gap-4">
      <DesignSwitch />
      <dl aria-label="Totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat hero label="Changed this week" value={t.week} to={{ to: "/docs", search: { since: "1w" } }} foot={<Delta now={t.week} before={t.lastWeek} hero />} />
        <Stat label="Docs" value={t.docs} to={{ to: "/docs", search: {} }} foot={`in ${rows.length} ${rows.length === 1 ? "repo" : "repos"}`} />
        <Stat label="With open todos" value={t.todos} to={{ to: "/todos", search: { view: "list" } }} foot="linked from a todo group" />
        <Stat label="Untouched for 60 days" value={t.stale} foot={`${t.docs ? Math.round((t.stale / t.docs) * 100) : 0}% of the docs`} />
      </dl>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="ov-days" className={cn(card, "flex min-w-0 flex-col gap-4")}>
          <Heading id="ov-days" title="Docs changed per day" sub={`Each doc on the day it last changed · ${t.month} in 30 days`} />
          <DotMatrix rows={rows} />
        </section>
        <section aria-labelledby="ov-fresh" className={cn(card, "flex flex-col gap-3")}>
          <Heading id="ov-fresh" title="How fresh the docs are" sub="By when each was last changed" />
          <Freshness recent={t.month} stale={t.stale} total={t.docs} />
        </section>
      </div>

      <NeedsAttention attention={q.data.attention} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="ov-repos" className={cn(card, "flex min-w-0 flex-col gap-4")}>
          <Heading id="ov-repos" title="Docs per repo" sub="Solid is markdown, light is html" />
          <RepoBars rows={rows} />
        </section>
        <section aria-labelledby="ov-changed" className={cn(card, "flex min-w-0 flex-col gap-3")}>
          <Heading id="ov-changed" title="Changed this week" sub="The latest six" />
          <DocList label="Changed this week" docs={newest(rows.flatMap((r) => r.changed))} empty="Nothing this week." />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="ov-todos" className={cn(card, "flex min-w-0 flex-col gap-3")}>
          <Heading id="ov-todos" title="With open todos" sub="Docs a todo group links to" />
          <DocList label="With open todos" docs={newest(rows.flatMap((r) => r.todo_docs))} empty="No doc has open todos." />
        </section>
        <section aria-labelledby="ov-stale" className={cn(card, "flex min-w-0 flex-col gap-3")}>
          <Heading id="ov-stale" title="Plans untouched for 60 days" sub="With open todos still on them" />
          <DocList label="Plans untouched for 60 days, with open todos" docs={newest(rows.flatMap((r) => r.stale_plans))} empty="No stale plans." />
        </section>
      </div>
    </div>
  )
}

const DESIGNS = [
  { id: undefined, label: "Cards" },
  { id: "report", label: "Report" },
  { id: "trends", label: "Trends" },
] as const

/** Cards is the default; Report and Trends sit behind ?design=. */
function DesignSwitch() {
  return (
    <nav aria-label="Overview design" className="flex items-center justify-end gap-1 text-xs">
      <span className="mr-1 text-muted-foreground">Design</span>
      {DESIGNS.map((d) => (
        <Link
          key={d.label}
          from="/docs"
          to="/docs"
          search={(s) => ({ ...s, design: d.id })}
          activeOptions={{ explicitUndefined: true }}
          className="rounded-full border px-2.5 py-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:border-transparent aria-[current=page]:bg-foreground aria-[current=page]:text-background"
        >
          {d.label}
        </Link>
      ))}
    </nav>
  )
}

function Heading({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <header className="flex flex-col gap-0.5">
      <h2 id={id} className="font-medium">
        {title}
      </h2>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </header>
  )
}

type Target = { to: "/docs"; search: { since?: string } } | { to: "/todos"; search: { view: "list" } }

function Stat({ label, value, foot, to, hero }: { label: string; value: number; foot: React.ReactNode; to?: Target; hero?: boolean }) {
  return (
    <div className={cn(card, "relative flex min-h-36 flex-col gap-1", hero && "border-transparent bg-brand text-white")}>
      <dt className={cn("pr-9 text-sm", hero ? "text-white/85" : "text-muted-foreground")}>{label}</dt>
      <dd className="mt-auto text-4xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className={cn("text-xs", hero ? "text-white/85" : "text-muted-foreground")}>{foot}</dd>
      {to && (
        <Link
          {...(to as { to: "/docs" })}
          aria-label={`Open: ${label}`}
          className={cn("absolute top-4 right-4 flex size-8 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", hero ? "border-white/40 bg-white text-brand hover:bg-white/90" : "hover:bg-muted")}
        >
          <ArrowUpRightIcon aria-hidden className="size-4" />
        </Link>
      )}
    </div>
  )
}

function Delta({ now, before, hero }: { now: number; before: number; hero?: boolean }) {
  const d = now - before
  const Icon = d > 0 ? ArrowUpRightIcon : d < 0 ? ArrowDownRightIcon : MinusIcon
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1 py-px font-medium tabular-nums", hero ? "bg-white/20" : "bg-muted")}>
        <Icon aria-hidden className="size-3" />
        {Math.abs(d)}
      </span>
      {d === 0 ? "same as last week" : d > 0 ? "more than last week" : "fewer than last week"}
    </span>
  )
}

/** One column a day, one dot a doc, coloured by repo. */
function DotMatrix({ rows }: { rows: RepoOverview[] }) {
  const repoColor = useRepoColor()
  const active = rows.filter((r) => add(r.days))
  return (
    <figure className="flex flex-col gap-3">
      <div aria-hidden className="flex h-44 items-end justify-between gap-[3px]">
        {Array.from({ length: 30 }, (_, i) => {
          const parts = rows.map((r) => ({ repo: r.repo, n: r.days[i]! })).filter((p) => p.n)
          const n = add(parts.map((p) => p.n))
          const dots = n > CAP ? share(parts, CAP) : parts.flatMap((p) => Array<string>(p.n).fill(p.repo))
          return (
            <div key={i} title={dayTitle(rows, i)} className="flex h-full flex-1 flex-col-reverse items-center gap-[3px]">
              {dots.length ? (
                dots.map((repo, k) => <span key={k} className="aspect-square w-full max-w-2.5 shrink-0 rounded-full" style={{ background: repoColor(repo) }} />)
              ) : (
                <span className="h-6 w-full max-w-2.5 shrink-0 rounded-full text-muted-foreground/35" style={{ backgroundImage: HATCH }} />
              )}
              {n > CAP && <span className="text-[10px] leading-none font-medium text-muted-foreground tabular-nums">{n}</span>}
            </div>
          )
        })}
      </div>
      <div aria-hidden className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{short.format(dayAt(0))}</span>
        <span>{short.format(dayAt(15))}</span>
        <span>Today</span>
      </div>
      {active.length > 0 && (
        <ul aria-label="Repos" className="flex flex-wrap gap-1.5">
          {active.map((r) => (
            <li key={r.repo} className="flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-1.5 text-xs text-muted-foreground" translate="no">
              <span aria-hidden className="size-2 rounded-full" style={{ background: repoColor(r.repo) }} />
              {r.repo}
              <span className="text-foreground tabular-nums">{add(r.days)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

function dayTitle(rows: RepoOverview[], i: number) {
  const parts = rows.filter((r) => r.days[i]).map((r) => `${r.repo} ${r.days[i]}`)
  const n = add(rows.map((r) => r.days[i]!))
  return `${short.format(dayAt(i))}: ${n} ${n === 1 ? "doc" : "docs"}${parts.length ? ` (${parts.join(", ")})` : ""}`
}

/** `cap` dots split by repo in proportion, largest remainders first, every repo with changes keeping at least one. */
function share(parts: { repo: string; n: number }[], cap: number): string[] {
  const total = add(parts.map((p) => p.n))
  const exact = parts.map((p) => (p.n / total) * cap)
  const counts = exact.map((e) => Math.max(1, Math.floor(e)))
  let left = cap - add(counts)
  for (const i of exact.map((e, i) => ({ i, rem: e - Math.floor(e) })).sort((a, b) => b.rem - a.rem).map((x) => x.i)) {
    if (left <= 0) break
    counts[i]!++
    left--
  }
  return parts.flatMap((p, i) => Array<string>(counts[i]!).fill(p.repo)).slice(0, cap)
}

/** A half ring: changed in 30 days, 30 to 60 days, and untouched for 60 days, hatched. */
function Freshness({ recent, stale, total }: { recent: number; stale: number, total: number }) {
  const middle = Math.max(0, total - recent - stale)
  const pct = (n: number) => (total ? (n / total) * 100 : 0)
  const parts = [
    { label: "Last 30 days", n: recent, stroke: "var(--link)" },
    { label: "30 to 60 days", n: middle, stroke: "color-mix(in oklab, var(--link) 40%, transparent)" },
    { label: "Older", n: stale, stroke: "url(#ov-hatch)" },
  ]
  let at = 0
  return (
    <figure className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-56">
        <svg aria-hidden viewBox="0 0 120 66" className="w-full text-muted-foreground/45">
          <defs>
            <pattern id="ov-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="1.4" height="4" fill="currentColor" />
            </pattern>
          </defs>
          <path d="M12 60 A48 48 0 0 1 108 60" pathLength={100} fill="none" stroke="var(--muted)" strokeWidth={14} />
          {parts.map((p) => {
            const len = pct(p.n)
            const el = len > 0 && <path key={p.label} d="M12 60 A48 48 0 0 1 108 60" pathLength={100} fill="none" stroke={p.stroke} strokeWidth={14} strokeDasharray={`${Math.max(0, len - 0.8)} 100`} strokeDashoffset={-at} />
            at += len
            return el
          })}
        </svg>
        <p className="absolute inset-x-0 bottom-0 text-center">
          <span className="block text-3xl font-semibold tracking-tight tabular-nums">{Math.round(pct(recent))}%</span>
          <span className="text-xs text-muted-foreground">changed in 30 days</span>
        </p>
      </div>
      <ul className="flex w-full flex-col gap-1 text-xs">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-[3px] text-muted-foreground/60" style={p.stroke.startsWith("url") ? { backgroundImage: HATCH } : { background: p.stroke }} />
            <span className="flex-1 text-muted-foreground">{p.label}</span>
            <span className="tabular-nums">{p.n}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

function RepoBars({ rows }: { rows: RepoOverview[] }) {
  const repoColor = useRepoColor()
  const most = Math.max(1, ...rows.map((r) => r.docs))
  return (
    <ul className="flex flex-col gap-3">
      {[...rows].sort((a, b) => b.docs - a.docs).map((r) => {
        const c = repoColor(r.repo)
        return (
          <li key={r.repo} data-repo={r.repo} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
            <span aria-hidden className="row-span-2 flex size-8 items-center justify-center rounded-lg" style={{ background: `color-mix(in oklab, ${c} 16%, transparent)`, color: c }}>
              <BoxIcon className="size-4" />
            </span>
            <Link to="/docs" search={{ repo: r.repo }} className={cn(link, "truncate text-sm font-medium")} translate="no">
              {r.repo}
            </Link>
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              <span data-count="docs" className="text-sm font-medium text-foreground">
                {r.docs}
              </span>{" "}
              · {add(r.days.slice(-7))} this week
            </span>
            <div aria-hidden className="col-span-2 h-2 rounded-full bg-muted">
              <div className="flex h-full overflow-hidden rounded-full" style={{ width: `max(0.5rem, ${(r.docs / most) * 100}%)` }}>
                <span style={{ width: `${(r.md / Math.max(1, r.md + r.html)) * 100}%`, background: c }} />
                <span className="flex-1" style={{ background: `color-mix(in oklab, ${c} 40%, transparent)` }} />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function DocList({ label, docs, empty }: { label: string; docs: (DocRef | LinkedDoc)[]; empty: string }) {
  const repoColor = useRepoColor()
  if (!docs.length) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>
  return (
    <ul aria-label={label} className="flex flex-col">
      {docs.map((d) => (
        <li key={`${d.repo}/${d.path}`}>
          <a href={docHref(d)} className="-mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <span aria-hidden className="size-2 rounded-full" style={{ background: repoColor(d.repo) }} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{d.title}</span>
              <span className="truncate text-xs text-muted-foreground" translate="no">
                {d.repo}
              </span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
              {"open" in d && (
                <span className="flex items-center gap-1" title={`${d.open} open todos`}>
                  <ListTodoIcon aria-hidden className="size-3.5" />
                  {d.open}
                </span>
              )}
              <time dateTime={d.mtime} title={exact(d.mtime)} className={ageTone(d.mtime)}>
                {stamp(d.mtime)}
              </time>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function NeedsAttention({ attention }: { attention: Attention }) {
  const total = attention.no_doc.length + attention.missing.length + attention.duplicates.length
  if (!total) return null
  return (
    <section aria-labelledby="attention" className="rounded-2xl border border-amber-500/40 bg-amber-500/5 px-5 py-4">
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
        {attention.duplicates.map((d) => (
          <li key={d.id} data-attention="duplicate-id" className="flex min-w-0 items-start gap-2">
            <CopyXIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="text-muted-foreground">
                {d.docs.length} docs share the id <code className="font-mono text-xs">{d.id}</code>, so links by that id find none of them:{" "}
              </span>
              {d.docs.map((doc, i) => (
                <Fragment key={docKey(doc)}>
                  {i > 0 && <span className="text-muted-foreground">, </span>}
                  <a href={docHref(doc)} className={link} translate="no">
                    {doc.repo}/{doc.path}
                  </a>
                </Fragment>
              ))}
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
