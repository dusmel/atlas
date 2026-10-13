// Overview's Report and Trends designs, at ?design=report and ?design=trends. Cards, the default, is in overview-view.tsx.
import { Link } from "@tanstack/react-router"
import { ArrowDownRightIcon, ArrowUpRightIcon, ListTodoIcon, MinusIcon } from "lucide-react"
import { cn } from "cn"
import { ageTone, useRepoColor } from "@/lib/doc-colors"
import { docHref, folderLabel, type Attention, type DocRef, type LinkedDoc, type RepoOverview } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

const link = "rounded underline-offset-4 hover:text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })
const dayAt = (i: number) => new Date(Date.now() - (29 - i) * 864e5)
const add = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

type Props = { rows: RepoOverview[]; attention: Attention; NeedsAttention: (p: { attention: Attention }) => React.ReactNode }

function totals(rows: RepoOverview[]) {
  const sum = (f: (r: RepoOverview) => number) => add(rows.map(f))
  return {
    docs: sum((r) => r.docs),
    week: sum((r) => add(r.days.slice(-7))),
    lastWeek: sum((r) => add(r.days.slice(-14, -7))),
    todos: sum((r) => r.todo_docs.length),
    stale: sum((r) => r.stale),
    month: sum((r) => add(r.days)),
  }
}

const newest = <T extends DocRef>(docs: T[], n = 8) => [...docs].sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, n)

function Delta({ now, before, className }: { now: number; before: number; className?: string }) {
  const d = now - before
  const Icon = d > 0 ? ArrowUpRightIcon : d < 0 ? ArrowDownRightIcon : MinusIcon
  return (
    <span className={cn("flex items-center gap-1 text-xs text-muted-foreground tabular-nums", className)}>
      <Icon aria-hidden className={cn("size-3.5", d > 0 && "text-fresh", d < 0 && "text-old")} />
      {d === 0 ? "same as last week" : `${Math.abs(d)} ${d > 0 ? "more" : "fewer"} than last week`}
    </span>
  )
}

function RepoName({ repo, className }: { repo: string; className?: string }) {
  const repoColor = useRepoColor()
  return (
    <Link to="/docs" search={{ repo }} className={cn(link, "flex min-w-0 items-center gap-2")} translate="no">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: repoColor(repo) }} />
      <span className={cn("truncate", className)}>{repo}</span>
    </Link>
  )
}

/** Docs as plain rows: title, repo dot, open todos, age. */
function Docs({ title, docs, empty }: { title: string; docs: (DocRef | LinkedDoc)[]; empty?: string }) {
  const repoColor = useRepoColor()
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1">
      <h2 className="border-b pb-2 text-xs font-medium text-muted-foreground">{title}</h2>
      {docs.length ? (
        <ul className="flex flex-col">
          {docs.map((d) => (
            <li key={`${d.repo}/${d.path}`}>
              <a href={docHref(d)} className="-mx-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: repoColor(d.repo) }} title={d.repo} />
                <span className="truncate">{d.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {"open" in d && (
                    <span className="flex items-center gap-1" title={`${d.open} open todos`}>
                      <ListTodoIcon aria-hidden className="size-3.5" />
                      {d.open}
                    </span>
                  )}
                  <time dateTime={d.mtime} title={exact(d.mtime)} className={ageTone(d.mtime)}>
                    {ago(d.mtime)}
                  </time>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-1.5 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

const dayTitle = (rows: RepoOverview[], i: number) => {
  const parts = rows.filter((r) => r.days[i]).map((r) => `${r.repo} ${r.days[i]}`)
  const n = add(rows.map((r) => r.days[i]!))
  return `${short.format(dayAt(i))}: ${n} ${n === 1 ? "doc" : "docs"}${parts.length ? ` (${parts.join(", ")})` : ""}`
}

function DayAxis({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("flex justify-between text-[10px] text-muted-foreground tabular-nums", className)}>
      <span>{short.format(dayAt(0))}</span>
      <span>{short.format(dayAt(15))}</span>
      <span>Today</span>
    </div>
  )
}

// ---------- Report: numbers in a ruled strip, stacked bars, a table of repos.

export function DesignReport({ rows, attention, NeedsAttention }: Props) {
  const t = totals(rows)
  const stats = [
    { label: "Docs", value: t.docs },
    { label: "Changed this week", value: t.week, delta: <Delta now={t.week} before={t.lastWeek} /> },
    { label: "With open todos", value: t.todos },
    { label: "Untouched for 60 days", value: t.stale },
  ]
  return (
    <div className="flex flex-col gap-10">
      <dl aria-label="Totals" className="grid grid-cols-2 gap-y-4 border-y py-4 sm:grid-cols-4 sm:divide-x">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1 sm:px-4 sm:first:pl-0">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="text-3xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
            {s.delta}
          </div>
        ))}
      </dl>
      <section aria-labelledby="ov-bars" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ov-bars" className="text-sm font-medium">
            Docs changed per day <span className="font-normal text-muted-foreground">· last 30 days, {t.month} in all</span>
          </h2>
          <Legend rows={rows} />
        </div>
        <StackedBars rows={rows} />
      </section>
      <NeedsAttention attention={attention} />
      <RepoTable rows={rows} />
      <div className="grid gap-8 md:grid-cols-2">
        <Docs title="Changed this week" docs={newest(rows.flatMap((r) => r.changed))} empty="Nothing this week." />
        <Docs title="With open todos" docs={newest(rows.flatMap((r) => r.todo_docs))} empty="No doc has open todos." />
      </div>
    </div>
  )
}

function Legend({ rows, items }: { rows: RepoOverview[]; items?: { name: string; color: string }[] }) {
  const repoColor = useRepoColor()
  const shown = items ?? rows.filter((r) => add(r.days)).map((r) => ({ name: r.repo, color: repoColor(r.repo) }))
  return (
    <ul aria-label="Repos" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {shown.map((r) => (
        <li key={r.name} className="flex items-center gap-1.5" translate="no">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: r.color }} />
          {r.name}
        </li>
      ))}
    </ul>
  )
}

function StackedBars({ rows }: { rows: RepoOverview[] }) {
  const repoColor = useRepoColor()
  const per = Array.from({ length: 30 }, (_, i) => add(rows.map((r) => r.days[i]!)))
  const max = Math.max(1, ...per)
  return (
    <figure className="flex flex-col gap-1.5">
      <div className="relative h-44">
        {[1, 0.5, 0].map((f) => (
          <div key={f} aria-hidden className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${f * 100}%` }}>
            <span className="w-7 shrink-0 translate-y-1/2 text-right text-[10px] text-muted-foreground tabular-nums">{Math.round(max * f)}</span>
            <span className="h-px flex-1 translate-y-1/2 bg-border" />
          </div>
        ))}
        <div aria-hidden className="absolute inset-y-0 right-0 left-9 flex items-end gap-[3px]">
          {per.map((_, i) => (
            <div key={i} title={dayTitle(rows, i)} className="flex h-full flex-1 flex-col-reverse">
              {rows.map((r) =>
                r.days[i] ? <span key={r.repo} className="w-full first:rounded-b-[2px] last:rounded-t-[2px]" style={{ height: `max(2px, ${(r.days[i]! / max) * 100}%)`, background: repoColor(r.repo) }} /> : null,
              )}
            </div>
          ))}
        </div>
      </div>
      <DayAxis className="ml-9" />
    </figure>
  )
}

function RepoTable({ rows }: { rows: RepoOverview[] }) {
  const repoColor = useRepoColor()
  return (
    <table aria-label="Repos" className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground [&>th]:pb-2 [&>th]:font-medium">
          <th>Repo</th>
          <th className="text-right">Docs</th>
          <th className="text-right">This week</th>
          <th className="text-right max-sm:hidden">Untouched</th>
          <th className="pl-6 max-md:hidden">Last 30 days</th>
          <th className="text-right">Changed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.repo} data-repo={r.repo} className="border-b last:border-0 [&>td]:py-2">
            <td className="max-w-40">
              <RepoName repo={r.repo} />
            </td>
            <td className="text-right tabular-nums" data-count="docs">
              {r.docs}
            </td>
            <td className="text-right tabular-nums">{add(r.days.slice(-7)) || <span className="text-muted-foreground">0</span>}</td>
            <td className="text-right text-muted-foreground tabular-nums max-sm:hidden">{r.stale}</td>
            <td className="pl-6 max-md:hidden">
              <Spark days={r.days} color={repoColor(r.repo)} />
            </td>
            <td className="text-right text-xs">
              <time dateTime={r.last} title={exact(r.last)} className={ageTone(r.last)}>
                {ago(r.last)}
              </time>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Spark({ days, color }: { days: number[]; color: string }) {
  const max = Math.max(1, ...days)
  return (
    <div aria-hidden className="flex h-4 w-36 items-end gap-px">
      {days.map((n, i) => (
        <span key={i} className={cn("flex-1 rounded-[1px]", !n && "bg-border")} style={n ? { height: `max(3px, ${(n / max) * 100}%)`, background: color } : { height: 1 }} />
      ))}
    </div>
  )
}

// ---------- Trends: one headline number, a dot per doc changed, and a running total per repo as lines.

export function DesignTrends({ rows, attention, NeedsAttention }: Props) {
  const repoColor = useRepoColor()
  const t = totals(rows)
  const stats = [
    { label: "Changed this week", value: t.week, delta: <Delta now={t.week} before={t.lastWeek} /> },
    { label: "Changed in 30 days", value: t.month },
    { label: "Docs", value: t.docs },
    { label: "With open todos", value: t.todos },
    { label: "Untouched for 60 days", value: t.stale },
  ]
  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <section aria-labelledby="ov-lines" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ov-lines" className="text-sm font-medium">
              Docs changed, running total <span className="font-normal text-muted-foreground">· last 30 days</span>
            </h2>
            <Legend rows={rows} items={lineSeries(rows, repoColor)} />
          </div>
          <Lines rows={rows} />
        </section>
        <dl aria-label="Totals" className="flex flex-col divide-y self-start">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5 py-2.5 first:pt-0">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="text-2xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
              {s.delta}
            </div>
          ))}
        </dl>
      </div>
      <NeedsAttention attention={attention} />
      <section aria-labelledby="ov-folders" className="flex flex-col gap-3">
        <h2 id="ov-folders" className="border-b pb-2 text-xs font-medium text-muted-foreground">
          Where the docs are
        </h2>
        <ul className="grid gap-x-10 gap-y-4 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.repo} data-repo={r.repo} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <RepoName repo={r.repo} className="font-medium" />
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  <span data-count="docs">{r.docs}</span> docs ·{" "}
                  <time dateTime={r.last} title={exact(r.last)} className={ageTone(r.last)}>
                    {ago(r.last)}
                  </time>
                </span>
              </div>
              <div aria-hidden className="flex h-2 gap-px overflow-hidden rounded-[2px]">
                {r.folders.map((f, k) => (
                  <span key={f.folder} title={`${folderLabel(f.folder)} ${f.docs}`} style={{ flexGrow: f.docs, background: repoColor(r.repo), opacity: 1 - Math.min(k, 4) * 0.18 }} />
                ))}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {r.folders
                  .slice(0, 4)
                  .map((f) => `${folderLabel(f.folder)} ${f.docs}`)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <div className="grid gap-8 md:grid-cols-2">
        <Docs title="Changed this week" docs={newest(rows.flatMap((r) => r.changed))} empty="Nothing this week." />
        <Docs title="With open todos" docs={newest(rows.flatMap((r) => r.todo_docs))} empty="No doc has open todos." />
      </div>
    </div>
  )
}

/** A running total per repo, so a burst of changes reads as a step. The five busiest repos get a line; the rest share one. */
function lineSeries(rows: RepoOverview[], repoColor: (repo: string) => string) {
  const busy = rows.filter((r) => add(r.days)).sort((a, b) => add(b.days) - add(a.days))
  const rest = busy.slice(5)
  return [
    ...busy.slice(0, 5).map((r) => ({ name: r.repo, color: repoColor(r.repo), days: r.days, rest: [] as string[] })),
    ...(rest.length ? [{ name: `${rest.length} more`, color: "var(--muted-foreground)", days: Array.from({ length: 30 }, (_, i) => add(rest.map((r) => r.days[i]!))), rest: rest.map((r) => r.repo) }] : []),
  ]
}

function Lines({ rows }: { rows: RepoOverview[] }) {
  const repoColor = useRepoColor()
  const series = lineSeries(rows, repoColor).map((s) => ({ ...s, run: s.days.map((_, i) => add(s.days.slice(0, i + 1))) }))
  const rest = series.find((s) => s.rest.length)?.rest ?? []
  const max = Math.max(1, ...series.map((s) => s.run.at(-1)!))
  const x = (i: number) => (i / 29) * 300
  const y = (n: number) => 100 - (n / max) * 100
  return (
    <figure className="flex flex-col gap-1.5">
      <div className="relative h-48">
        {[1, 0.5, 0].map((f) => (
          <div key={f} aria-hidden className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${f * 100}%` }}>
            <span className="w-7 shrink-0 translate-y-1/2 text-right text-[10px] text-muted-foreground tabular-nums">{Math.round(max * f)}</span>
            <span className="h-px flex-1 translate-y-1/2 bg-border" />
          </div>
        ))}
        <svg aria-hidden viewBox="0 0 300 100" preserveAspectRatio="none" className="absolute inset-y-0 right-0 left-9 h-full w-[calc(100%-2.25rem)] overflow-visible">
          {series.map((s) => (
            <path key={s.name} d={s.run.map((n, i) => `${i ? "L" : "M"}${x(i)} ${y(n)}`).join("")} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ))}
        </svg>
        <div className="absolute inset-y-0 right-0 left-9 flex">
          {Array.from({ length: 30 }, (_, i) => (
            <span key={i} title={dayTitle(rows, i)} className="flex-1 hover:bg-foreground/5" />
          ))}
        </div>
      </div>
      <DayAxis className="ml-9" />
      {rest.length > 0 && <p className="text-xs text-muted-foreground">The grey line adds up {rest.join(", ")}.</p>}
    </figure>
  )
}
