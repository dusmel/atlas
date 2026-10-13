// Overview designs A and C, beside B in overview-view.tsx, for the owner to compare at ?design=a|c. The ones not picked get deleted.
import { Link } from "@tanstack/react-router"
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon, CalendarDaysIcon, FileTextIcon, FilesIcon, FolderGit2Icon, ListTodoIcon, MinusIcon, SunIcon } from "lucide-react"
import { cn } from "cn"
import { ageTone, useRepoColor } from "@/lib/doc-colors"
import { docHref, type Attention, type DocRef, type LinkedDoc, type RepoOverview } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" })
const dayAt = (i: number) => new Date(Date.now() - (29 - i) * 864e5)
const add = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)
const HATCH = "repeating-linear-gradient(135deg, currentColor 0 1.5px, transparent 1.5px 6px)"
const focus = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

type Props = { rows: RepoOverview[]; attention: Attention; NeedsAttention: (p: { attention: Attention }) => React.ReactNode }

function totals(rows: RepoOverview[]) {
  const sum = (f: (r: RepoOverview) => number) => add(rows.map(f))
  const perDay = Array.from({ length: 30 }, (_, i) => sum((r) => r.days[i]!))
  return {
    docs: sum((r) => r.docs),
    md: sum((r) => r.md),
    html: sum((r) => r.html),
    week: add(perDay.slice(-7)),
    lastWeek: add(perDay.slice(-14, -7)),
    month: add(perDay),
    todos: sum((r) => r.todo_docs.length),
    stale: sum((r) => r.stale),
    perDay,
  }
}

const newest = <T extends DocRef>(docs: T[], n: number) => [...docs].sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, n)
const dayLabel = (perDay: number[], i: number) => `${short.format(dayAt(i))}: ${perDay[i]} ${perDay[i] === 1 ? "doc" : "docs"}`

function Delta({ now, before, className }: { now: number; before: number; className?: string }) {
  const d = now - before
  const Icon = d > 0 ? ArrowUpRightIcon : d < 0 ? ArrowDownRightIcon : MinusIcon
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums", className)}>
      <Icon aria-hidden className="size-3.5" />
      {d === 0 ? "same as last week" : `${Math.abs(d)} ${d > 0 ? "more" : "fewer"} than last week`}
    </span>
  )
}

function CircleLink({ label, className, ...to }: { label: string; className?: string } & ({ to: "/docs"; search: { since?: string; view?: "activity" } } | { to: "/todos"; search: { view: "list" } })) {
  return (
    <Link {...(to as { to: "/docs" })} aria-label={label} className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border bg-card transition-colors hover:bg-muted", focus, className)}>
      <ArrowUpRightIcon aria-hidden className="size-4" />
    </Link>
  )
}

// ---------- A: Rings. A header band with the date, then soft cards: a dark gauge, active days as dots, a wave, nested circles per repo.

export function DesignRings({ rows, attention, NeedsAttention }: Props) {
  const t = totals(rows)
  const today = new Date()
  const card = "rounded-[28px] bg-card p-5 shadow-[0_1px_0_var(--border)]"
  return (
    <div className="@container flex flex-col gap-4 rounded-[36px] bg-muted/50 p-3 sm:p-4">
      <header className="flex flex-col gap-6 rounded-[28px] px-3 py-4 sm:px-4 @4xl:flex-row @4xl:items-center @4xl:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-20 items-center justify-center rounded-full border bg-card text-3xl font-light tabular-nums">{today.getDate()}</span>
          <span className="text-lg leading-tight">
            {weekday.format(today)},
            <br />
            {today.toLocaleDateString("en-GB", { month: "long" })}
          </span>
          <span aria-hidden className="mx-1 hidden h-10 w-px bg-border sm:block" />
          <Link to="/docs" search={{ since: "1w" }} className={cn("inline-flex h-12 items-center gap-3 rounded-full bg-brand px-5 text-sm font-medium text-white hover:bg-brand/90", focus)}>
            Show this week's changes
            <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
          <Link to="/docs" search={{ view: "activity" }} aria-label="Activity" className={cn("flex size-12 items-center justify-center rounded-full border bg-card hover:bg-muted", focus)}>
            <CalendarDaysIcon aria-hidden className="size-4" />
          </Link>
        </div>
        <p className="text-3xl font-medium tracking-tight @4xl:text-right @6xl:text-4xl">
          {t.week} {t.week === 1 ? "doc" : "docs"} changed this week.
          <span className="block font-light text-muted-foreground">{t.lastWeek} the week before.</span>
        </p>
      </header>

      <dl aria-label="Totals" className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto_minmax(0,0.9fr)_minmax(0,1.2fr)]">
        <div className={cn(card, "flex flex-col gap-4")}>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-sm font-medium">Docs</dt>
            <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
              in {rows.length} {rows.length === 1 ? "repo" : "repos"}
            </span>
          </div>
          <dd className="text-5xl font-light tracking-tight tabular-nums">{t.docs}</dd>
          <dd className="flex gap-2 text-xs">
            <span className="rounded-full bg-foreground px-4 py-2 text-background">Markdown {t.md}</span>
            <span className="rounded-full bg-muted px-4 py-2">HTML {t.html}</span>
          </dd>
        </div>
        <div className={cn(card, "flex flex-col justify-between gap-4")}>
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex size-9 items-center justify-center rounded-full border">
              <ListTodoIcon className="size-4" />
            </span>
            <div>
              <dt className="text-xs text-muted-foreground">With open todos</dt>
              <dd className="text-2xl tabular-nums">{t.todos}</dd>
            </div>
            <CircleLink label="Open the todos" to="/todos" search={{ view: "list" }} className="ml-auto" />
          </div>
          <div className="flex items-center gap-3 border-t pt-4">
            <span aria-hidden className="flex size-9 items-center justify-center rounded-full border">
              <FilesIcon className="size-4" />
            </span>
            <div>
              <dt className="text-xs text-muted-foreground">Untouched for 60 days</dt>
              <dd className="text-2xl tabular-nums">{t.stale}</dd>
            </div>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">{pct(t.stale, t.docs)}% of all</span>
          </div>
        </div>
        <div className="flex items-center justify-center @xl:col-span-2 @3xl:col-span-1">
          <DarkGauge share={pct(t.month, t.docs)} />
        </div>
        <ActiveDots perDay={t.perDay} className={card} />
        <div className={cn(card, "flex flex-col gap-2 @3xl:col-span-2 @6xl:col-span-1")}>
          <div className="flex items-start justify-between gap-2">
            <span aria-hidden className="flex size-9 items-center justify-center rounded-full border">
              <SunIcon className="size-4" />
            </span>
            <dd className="text-3xl font-light tabular-nums">{t.month}</dd>
          </div>
          <Wave perDay={t.perDay} />
          <div className="flex items-end justify-between gap-2">
            <dt className="text-sm leading-tight font-medium">
              Changed in 30 days
              <span className="block text-xs font-normal text-muted-foreground">each doc on its last day</span>
            </dt>
            <Delta now={t.week} before={t.lastWeek} className="hidden @3xl:inline-flex @6xl:hidden" />
          </div>
        </div>
      </dl>

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="rings-repos" className={cn(card, "flex flex-col gap-4")}>
          <h2 id="rings-repos" className="text-sm font-medium">
            Docs per repo
          </h2>
          <NestedRings rows={rows} />
        </section>

        <section aria-labelledby="rings-week" className="flex min-w-0 flex-col gap-3 rounded-[28px] bg-card/60 p-4 ring-1 ring-border @3xl:order-first @3xl:col-span-2 @6xl:order-none @6xl:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="rings-week" className="mr-auto px-1 text-sm font-medium">
              Last 30 days
            </h2>
            <RepoChips rows={rows} />
          </div>
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)]">
            <div className={cn(card, "flex flex-col gap-3")}>
              <p className="text-3xl font-light tabular-nums">
                {t.month}
                <span className="ml-1 text-xs text-muted-foreground">docs</span>
              </p>
              <Waveform perDay={t.perDay} />
              <p className="flex justify-between text-[10px] text-muted-foreground">
                <span>{short.format(dayAt(0))}</span>
                <span>Today</span>
              </p>
            </div>
            <div className={cn(card, "flex min-w-0 flex-col gap-3")}>
              <h3 className="text-sm font-medium">Changed this week</h3>
              <Timeline docs={newest(rows.flatMap((r) => r.changed), 4)} />
            </div>
            <AttentionCard attention={attention} className={card} />
          </div>
        </section>

        <section aria-labelledby="rings-todos" className={cn(card, "flex min-w-0 flex-col gap-3")}>
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            <span className="h-1.5 w-4 rounded-full bg-foreground" />
          </div>
          <h2 id="rings-todos" className="text-xl leading-snug font-medium">
            Docs with open todos
          </h2>
          <SoftList label="With open todos" docs={newest(rows.flatMap((r) => r.todo_docs), 5)} empty="No doc has open todos." />
          <h2 className="mt-2 text-xs text-muted-foreground">Plans untouched for 60 days</h2>
          <SoftList label="Plans untouched for 60 days, with open todos" docs={newest(rows.flatMap((r) => r.stale_plans), 3)} empty="No stale plans." />
        </section>
      </div>

      <NeedsAttention attention={attention} />
    </div>
  )
}

function DarkGauge({ share }: { share: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <figure className="relative flex size-40 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
      <svg aria-hidden viewBox="0 0 128 128" className="absolute inset-2 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={6} />
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--brand)" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${(share / 100) * c} ${c}`} />
      </svg>
      <figcaption className="text-center">
        <span className="block text-2xl font-medium tabular-nums">{share}%</span>
        <span className="text-[11px] opacity-70">changed in 30 days</span>
      </figcaption>
    </figure>
  )
}

function ActiveDots({ perDay, className }: { perDay: number[]; className?: string }) {
  const active = perDay.filter(Boolean).length
  return (
    <div className={cn(className, "flex flex-col gap-2")}>
      <CalendarDaysIcon aria-hidden className="size-4 text-muted-foreground" />
      <p className="text-xl leading-none">
        {active} {active === 1 ? "day" : "days"}
      </p>
      <p className="text-[11px] text-muted-foreground">with changes, of the last 30</p>
      <div aria-hidden className="grid grid-cols-10 gap-1">
        {perDay.map((n, i) => (
          <span key={i} title={dayLabel(perDay, i)} className={cn("size-2.5 rounded-full", n ? "bg-brand" : "bg-muted")} />
        ))}
      </div>
    </div>
  )
}

/** A smooth line through the 30 days. */
function Wave({ perDay }: { perDay: number[] }) {
  const max = Math.max(1, ...perDay)
  const pts = perDay.map((n, i) => [(i / 29) * 300, 54 - (n / max) * 48] as const)
  const d = pts.reduce((s, [x, y], i) => {
    if (!i) return `M${x} ${y}`
    const [px, py] = pts[i - 1]!
    const mx = (px + x) / 2
    return `${s} C${mx} ${py} ${mx} ${y} ${x} ${y}`
  }, "")
  return (
    <svg aria-hidden viewBox="0 0 300 60" preserveAspectRatio="none" className="h-16 w-full">
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Thin bars mirrored around a middle line, like a sound wave. */
function Waveform({ perDay }: { perDay: number[] }) {
  const max = Math.max(1, ...perDay)
  return (
    <div aria-hidden className="flex h-24 items-center justify-between gap-[2px]">
      {perDay.map((n, i) => (
        <span key={i} title={dayLabel(perDay, i)} className={cn("max-w-[3px] min-w-px flex-1 rounded-full", n ? "bg-brand" : "bg-border")} style={{ height: n ? `max(10%, ${(n / max) * 100}%)` : "6%" }} />
      ))}
    </div>
  )
}

function RepoChips({ rows }: { rows: RepoOverview[] }) {
  const repoColor = useRepoColor()
  const busy = rows.filter((r) => add(r.days)).sort((a, b) => add(b.days) - add(a.days)).slice(0, 4)
  return (
    <ul aria-label="Busiest repos" className="flex flex-wrap gap-1.5">
      {busy.map((r) => (
        <li key={r.repo}>
          <Link to="/docs" search={{ repo: r.repo }} className={cn("flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs hover:bg-muted", focus)} translate="no">
            {r.repo}
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: repoColor(r.repo) }} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The biggest repos as circles inside each other, all touching at the bottom. */
function NestedRings({ rows }: { rows: RepoOverview[] }) {
  const repoColor = useRepoColor()
  const top = [...rows].sort((a, b) => b.docs - a.docs).slice(0, 4)
  const rest = rows.length - top.length
  // A fixed ladder, not sizes by count: real counts differ so much that the small circles hide each other's labels.
  const sizes = [100, 76, 54, 32]
  return (
    <figure className="flex flex-col gap-4">
      <div className="relative mx-auto aspect-square w-full max-w-64">
        {top.map((r, i) => {
          const c = repoColor(r.repo)
          const inner = i === top.length - 1
          return (
            <Link
              key={r.repo}
              to="/docs"
              search={{ repo: r.repo }}
              aria-label={`${r.repo}: ${r.docs} docs`}
              className={cn("absolute bottom-0 left-1/2 flex -translate-x-1/2 justify-center rounded-full pt-[4%] text-sm font-medium tabular-nums", focus, inner && "items-center pt-0 text-white")}
              style={{ width: `${sizes[i]}%`, height: `${sizes[i]}%`, background: inner ? c : `color-mix(in oklab, ${c} ${14 + i * 8}%, var(--card))`, color: inner ? undefined : c }}
            >
              {r.docs}
            </Link>
          )
        })}
      </div>
      <ul className="flex flex-col gap-1.5 text-xs">
        {top.map((r) => (
          <li key={r.repo} className="flex items-center gap-2" translate="no">
            <span aria-hidden className="size-2 rounded-full" style={{ background: repoColor(r.repo) }} />
            <span className="truncate">{r.repo}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">{r.docs}</span>
          </li>
        ))}
        {rest > 0 && <li className="text-muted-foreground">and {rest} smaller {rest === 1 ? "repo" : "repos"}</li>}
      </ul>
    </figure>
  )
}

/** Docs on a vertical line, each with an icon bubble in its repo's colour. */
function Timeline({ docs }: { docs: DocRef[] }) {
  const repoColor = useRepoColor()
  if (!docs.length) return <p className="text-sm text-muted-foreground">Nothing changed this week.</p>
  return (
    <ul aria-label="Changed this week" className="relative flex flex-col gap-3 before:absolute before:top-3 before:bottom-3 before:left-3.5 before:w-px before:bg-border">
      {docs.map((d) => {
        const c = repoColor(d.repo)
        return (
          <li key={`${d.repo}/${d.path}`} className="relative">
            <a href={docHref(d)} className={cn("flex items-center gap-3 rounded-full py-0.5 pr-3", focus)}>
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full text-white" style={{ background: c }}>
                <FileTextIcon className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm hover:underline">{d.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  <span translate="no">{d.repo}</span>, <time dateTime={d.mtime}>{ago(d.mtime)}</time>
                </span>
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function AttentionCard({ attention, className }: { attention: Attention; className?: string }) {
  const groups = attention.no_doc.length
  const missing = attention.missing.length
  return (
    <div className={cn(className, "flex flex-col gap-2")}>
      <svg aria-hidden viewBox="0 0 48 48" className="size-12 text-brand">
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2
          return <line key={i} x1={24 + Math.cos(a) * 9} y1={24 + Math.sin(a) * 9} x2={24 + Math.cos(a) * 22} y2={24 + Math.sin(a) * 22} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        })}
        <circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
      <h3 className="text-sm font-medium">{groups + missing ? "Needs attention" : "Nothing needs attention"}</h3>
      <p className="text-xs text-muted-foreground">
        {groups + missing
          ? [groups && `${groups} ${groups === 1 ? "group has" : "groups have"} open todos and no doc`, missing && `${missing} ${missing === 1 ? "link points" : "links point"} at a missing doc`].filter(Boolean).join(". ") + "."
          : "Every group with open todos links a doc that exists."}
      </p>
      <Link to="/todos" search={{ view: "list" }} className={cn("mt-auto flex h-10 items-center justify-center rounded-full bg-brand px-4 text-sm font-medium whitespace-nowrap text-white hover:bg-brand/90", focus)}>
        Open the todos
      </Link>
    </div>
  )
}

function SoftList({ label, docs, empty }: { label: string; docs: (DocRef | LinkedDoc)[]; empty: string }) {
  if (!docs.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {docs.map((d) => (
        <li key={`${d.repo}/${d.path}`}>
          <a href={docHref(d)} className={cn("-mx-2 flex items-center gap-2 rounded-2xl px-2 py-1.5 hover:bg-muted/60", focus)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{d.title}</span>
              <span className="text-[11px] text-muted-foreground" translate="no">
                {d.repo}
              </span>
            </span>
            {"open" in d && (
              <span className="rounded-full border px-2 py-0.5 text-[11px] tabular-nums" title={`${d.open} open todos`}>
                {d.open} open
              </span>
            )}
            <time dateTime={d.mtime} title={exact(d.mtime)} className={cn("text-[11px] tabular-nums", ageTone(d.mtime))}>
              {ago(d.mtime)}
            </time>
          </a>
        </li>
      ))}
    </ul>
  )
}

// ---------- C: Pills. A warm panel: a light headline, one pill bar of how old the docs are, thin big numbers, and soft charts.

const SUN = "bg-[#f3cd5a] text-[#1d1a12] dark:bg-[#e2b84f]"

export function DesignPills({ rows, attention, NeedsAttention }: Props) {
  const t = totals(rows)
  const card = "rounded-[28px] bg-card/80 p-5 backdrop-blur-sm"
  const latest = newest(rows.flatMap((r) => r.changed), 1)[0]
  return (
    <div className="@container flex flex-col gap-5 rounded-[36px] bg-gradient-to-br from-muted/60 via-[#f8f1da] to-[#f6e2a2] p-4 sm:p-6 dark:from-card dark:via-[#26221a] dark:to-[#3b3119]">
      <header className="flex flex-col gap-6">
        <div className="flex flex-col gap-6 @4xl:flex-row @4xl:items-end @4xl:justify-between">
          <h2 className="text-4xl font-light tracking-tight @xl:text-5xl">Your docs, this month</h2>
          <dl aria-label="Totals" className="flex flex-wrap gap-x-8 gap-y-3">
          {[
            { label: "Docs", value: t.docs, Icon: FilesIcon },
            { label: "Repos", value: rows.length, Icon: FolderGit2Icon },
            { label: "This week", value: t.week, Icon: SunIcon },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="flex flex-col-reverse items-start">
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Icon aria-hidden className="size-3.5" />
                {label}
              </dt>
              <dd className="text-6xl leading-none font-extralight tracking-tight tabular-nums">{value}</dd>
            </div>
          ))}
          </dl>
        </div>
        <AgeBar t={t} />
      </header>

      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.1fr)]">
        {latest ? <LatestDoc doc={latest} /> : <div className={cn(card, "text-sm text-muted-foreground")}>Nothing changed this week.</div>}

        <section aria-labelledby="pills-week" className={cn(card, "flex flex-col gap-3")}>
          <div className="flex items-start justify-between">
            <h2 id="pills-week" className="text-xl">
              This week
            </h2>
            <CircleLink label="Open this week's changes" to="/docs" search={{ since: "1w" }} />
          </div>
          <p className="flex items-center gap-3">
            <span className="text-4xl font-light tabular-nums">{t.week}</span>
            <span className="text-xs leading-tight text-muted-foreground">
              docs changed
              <br />
              in 7 days
            </span>
          </p>
          <Lollipops perDay={t.perDay.slice(-7)} />
        </section>

        <section aria-labelledby="pills-fresh" className={cn(card, "flex flex-col gap-2")}>
          <div className="flex items-start justify-between">
            <h2 id="pills-fresh" className="text-xl">
              Freshness
            </h2>
            <CircleLink label="Open the activity" to="/docs" search={{ view: "activity" }} />
          </div>
          <TickRing share={pct(t.month, t.docs)} />
        </section>

        <div className="flex flex-col gap-4 @xl:col-span-2 @3xl:col-span-3 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @6xl:col-span-1 @6xl:row-span-2 @6xl:flex">
          <RepoShare rows={rows} total={t.docs} className={card} />
          <DarkList docs={newest(rows.flatMap((r) => r.changed), 6)} total={t.week} />
        </div>

        <section aria-labelledby="pills-repos" className={cn(card, "flex flex-col gap-1")}>
          <h2 id="pills-repos" className="mb-2 text-xl">
            Docs per repo
          </h2>
          <RepoBars rows={rows} total={t.docs} />
        </section>

        <section aria-labelledby="pills-days" className={cn(card, "flex min-w-0 flex-col gap-3 @xl:col-span-2")}>
          <h2 id="pills-days" className="text-xl">
            Docs changed per day
          </h2>
          <DotColumns perDay={t.perDay} />
        </section>
      </div>

      <section aria-labelledby="pills-todos" className={cn(card, "flex flex-col gap-2")}>
        <h2 id="pills-todos" className="text-xl">
          With open todos
        </h2>
        <SoftList label="With open todos" docs={newest(rows.flatMap((r) => r.todo_docs), 6)} empty="No doc has open todos." />
      </section>
      <NeedsAttention attention={attention} />
    </div>
  )
}

/** One pill bar split by when each doc last changed: this week, earlier this month, 30 to 60 days, older. */
function AgeBar({ t }: { t: ReturnType<typeof totals> }) {
  const middle = Math.max(0, t.docs - t.month - t.stale)
  const parts = [
    { label: "This week", n: t.week, className: "bg-foreground text-background" },
    { label: "Earlier this month", n: t.month - t.week, className: SUN },
    { label: "30 to 60 days", n: middle, className: "text-muted-foreground/50", hatch: true },
    { label: "Older", n: t.stale, className: "border border-foreground/30" },
  ].filter((p) => p.n)
  return (
    <ul aria-label="How old the docs are" className="flex w-full gap-1.5">
      {parts.map((p) => (
        <li key={p.label} className="flex min-w-16 flex-col gap-2" style={{ flexGrow: Math.max(p.n, t.docs * 0.07), flexBasis: 0 }}>
          <span className="truncate text-sm">{p.label}</span>
          <span className={cn("flex h-11 items-center rounded-full px-4 text-xs tabular-nums", p.className)} style={p.hatch ? { backgroundImage: HATCH } : undefined}>
            <span className={cn(p.hatch && "rounded-full bg-card/90 px-1.5 text-foreground")}>{pct(p.n, t.docs)}%</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function LatestDoc({ doc }: { doc: DocRef }) {
  const repoColor = useRepoColor()
  const c = repoColor(doc.repo)
  return (
    <a
      href={docHref(doc)}
      className={cn("relative flex min-h-56 flex-col justify-end gap-2 overflow-hidden rounded-[28px] p-5 text-white", focus)}
      style={{ background: `radial-gradient(120% 90% at 20% 10%, color-mix(in oklab, ${c} 55%, white), ${c} 55%, color-mix(in oklab, ${c} 60%, black))` }}
    >
      <FileTextIcon aria-hidden className="absolute top-5 left-5 size-16 opacity-25" strokeWidth={1} />
      <span className="text-xs opacity-80">Latest change</span>
      <span className="line-clamp-3 text-2xl leading-tight">{doc.title}</span>
      <span className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate opacity-80" translate="no">
          {doc.repo}
        </span>
        <time dateTime={doc.mtime} className="shrink-0 rounded-full border border-white/50 px-3 py-1.5 text-xs backdrop-blur">
          {ago(doc.mtime)}
        </time>
      </span>
    </a>
  )
}

/** A stick per day with a dot at its foot. The busiest day is yellow and says its count. */
function Lollipops({ perDay }: { perDay: number[] }) {
  const max = Math.max(1, ...perDay)
  const top = perDay.indexOf(Math.max(...perDay))
  return (
    <figure aria-label={`Docs changed per day, last 7 days: ${perDay.join(", ")}`} className="flex flex-col gap-2">
      <div className="flex h-32 items-end justify-between px-1">
        {perDay.map((n, i) => {
          const hot = n > 0 && i === top
          return (
            <div key={i} className="relative flex h-full w-6 flex-col items-center justify-end gap-1.5">
              {hot && <span className={cn("absolute -top-1 rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap tabular-nums", SUN)}>{n} docs</span>}
              <span
                className={cn("w-1.5 rounded-full", hot ? SUN : n ? "bg-foreground" : "text-muted-foreground/40")}
                style={{ height: n ? `${12 + (n / max) * 62}%` : "50%", backgroundImage: n ? undefined : HATCH }}
              />
              <span className={cn("size-1.5 rounded-full", hot ? SUN : "bg-foreground")} />
            </div>
          )
        })}
      </div>
      <div aria-hidden className="flex justify-between px-1 text-xs text-muted-foreground">
        {perDay.map((_, i) => (
          <span key={i} className="w-6 text-center">
            {weekday.format(dayAt(23 + i)).slice(0, 1)}
          </span>
        ))}
      </div>
    </figure>
  )
}

/** Sixty ticks round a circle; the share changed in 30 days is a thick yellow arc over them. */
function TickRing({ share }: { share: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <figure className="relative mx-auto flex aspect-square w-full max-w-44 items-center justify-center">
      <svg aria-hidden viewBox="0 0 120 120" className="absolute inset-0 -rotate-90 text-muted-foreground/50">
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * Math.PI * 2
          return <line key={i} x1={60 + Math.cos(a) * 38} y1={60 + Math.sin(a) * 38} x2={60 + Math.cos(a) * 43} y2={60 + Math.sin(a) * 43} stroke="currentColor" strokeWidth={1} />
        })}
        <circle cx="60" cy="60" r={r} fill="none" className="stroke-[#f3cd5a] dark:stroke-[#e2b84f]" strokeWidth={7} strokeLinecap="round" strokeDasharray={`${(share / 100) * c} ${c}`} />
      </svg>
      <figcaption className="text-center leading-tight">
        <span className="block text-3xl font-light tabular-nums">{share}%</span>
        <span className="text-[11px] text-muted-foreground">
          changed
          <br />
          in 30 days
        </span>
      </figcaption>
    </figure>
  )
}

function RepoShare({ rows, total, className }: { rows: RepoOverview[]; total: number; className?: string }) {
  const top = [...rows].sort((a, b) => b.docs - a.docs).slice(0, 3)
  const fills = [SUN, "bg-foreground text-background", "bg-muted-foreground/60 text-background"]
  return (
    <section aria-labelledby="pills-share" className={cn(className, "flex flex-col gap-3")}>
      <div className="flex items-baseline justify-between">
        <h2 id="pills-share" className="text-xl">
          Biggest repos
        </h2>
        <span className="text-4xl font-extralight tabular-nums">{pct(add(top.map((r) => r.docs)), total)}%</span>
      </div>
      <ul className="flex flex-1 gap-1">
        {top.map((r, i) => (
          <li key={r.repo} className="flex min-w-14 flex-col gap-1.5" style={{ flexGrow: r.docs, flexBasis: 0 }}>
            <span className="border-l border-foreground/40 pl-1.5 text-xs tabular-nums">{pct(r.docs, total)}%</span>
            <span className={cn("flex min-h-11 flex-1 items-end rounded-2xl px-3 pb-3.5 text-xs", fills[i])} translate="no">
              <span className="truncate">{r.repo}</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col">
        {top.map((r, i) => (
          <li key={r.repo} className="flex items-center gap-2 border-b border-dashed py-2 text-sm last:border-0">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", fills[i])} />
            <span className="min-w-0 flex-1 truncate" translate="no">
              {r.repo}
            </span>
            <span className="tabular-nums text-muted-foreground">{r.docs}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DarkList({ docs, total }: { docs: DocRef[]; total: number }) {
  return (
    <section aria-labelledby="pills-changed" className="flex flex-1 flex-col gap-4 rounded-[28px] bg-foreground p-5 text-background">
      <div className="flex items-baseline justify-between">
        <h2 id="pills-changed" className="text-xl">
          Changed this week
        </h2>
        <span className="text-4xl font-extralight tabular-nums">{total}</span>
      </div>
      {docs.length ? (
        <ul aria-label="Changed this week" className="flex flex-col gap-3">
          {docs.map((d) => (
            <li key={`${d.repo}/${d.path}`}>
              <a href={docHref(d)} className="flex items-center gap-3 rounded-full focus-visible:ring-2 focus-visible:ring-background/60 focus-visible:outline-none">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background/10">
                  <FileTextIcon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm hover:underline">{d.title}</span>
                  <span className="text-[11px] opacity-60">
                    <span translate="no">{d.repo}</span>, <time dateTime={d.mtime}>{ago(d.mtime)}</time>
                  </span>
                </span>
                <span aria-hidden className={cn("ml-auto size-5 shrink-0 rounded-full", SUN)} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm opacity-70">Nothing changed this week.</p>
      )}
    </section>
  )
}

function RepoBars({ rows, total }: { rows: RepoOverview[]; total: number }) {
  const repoColor = useRepoColor()
  return (
    <ul className="flex flex-col">
      {[...rows]
        .sort((a, b) => b.docs - a.docs)
        .map((r) => (
          <li key={r.repo} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.5rem] items-center gap-3 border-b border-dashed py-2 text-sm last:border-0">
            <Link to="/docs" search={{ repo: r.repo }} className={cn("truncate rounded hover:underline", focus)} translate="no">
              {r.repo}
            </Link>
            <span aria-hidden className="h-1.5 rounded-full bg-muted">
              <span className="block h-full rounded-full" style={{ width: `max(4px, ${pct(r.docs, total)}%)`, background: repoColor(r.repo) }} />
            </span>
            <span className="text-right text-xs text-muted-foreground tabular-nums">{r.docs}</span>
          </li>
        ))}
    </ul>
  )
}

/** A column of dots per day, one dot per step of docs. The busiest day stands out with its count. */
function DotColumns({ perDay }: { perDay: number[] }) {
  const max = Math.max(1, ...perDay)
  const step = Math.max(1, Math.ceil(max / 9))
  const top = perDay.indexOf(max)
  return (
    <figure className="flex flex-1 flex-col gap-2">
      <div className="relative flex min-h-48 flex-1 items-end justify-between gap-[2px] pt-8">
        {perDay.map((n, i) => {
          const hot = n > 0 && i === top
          const dots = Math.ceil(n / step)
          return (
            <div key={i} title={dayLabel(perDay, i)} className="relative flex h-full flex-1 flex-col-reverse items-center gap-[3px]">
              {Array.from({ length: Math.max(1, dots) }, (_, k) => (
                <span key={k} className={cn("aspect-square w-full max-w-2.5 shrink-0 rounded-full", hot ? "bg-foreground" : dots ? "bg-[#f3cd5a] dark:bg-[#e2b84f]" : "bg-foreground/10")} />
              ))}
              {hot && (
                <span className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-xl border bg-card px-2.5 py-1 text-[11px] whitespace-nowrap shadow-sm tabular-nums">
                  {short.format(dayAt(i))}: <strong className="font-medium">{n}</strong>
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div aria-hidden className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{short.format(dayAt(0))}</span>
        <span>{short.format(dayAt(10))}</span>
        <span>{short.format(dayAt(20))}</span>
        <span>Today</span>
      </div>
      <p className="text-xs text-muted-foreground">
        One dot is up to {step} {step === 1 ? "doc" : "docs"}, each on the day it last changed.
      </p>
    </figure>
  )
}
