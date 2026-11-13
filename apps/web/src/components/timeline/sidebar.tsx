import { Link } from "@tanstack/react-router"
import { ChevronRightIcon, FolderIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "cn"
import { ago, daysSince, effortState, sessionSize, sessionSpan, sessionTitle, type EffortSummary, type SessionSummary } from "@/lib/timeline"
import { AgentIcon } from "./session"

// Design: atlas/timeline/design.html#look-sidebar.

export type Filter = "active" | "neglected" | "all"

const FILTERS: { id: Filter; label: string; title: string }[] = [
  {
    id: "active",
    label: "Active",
    title: "In progress, or touched in the last 14 days",
  },
  {
    id: "neglected",
    label: "Neglected",
    title: "Not done, and untouched for 7 days or more",
  },
  { id: "all", label: "All", title: "Every effort" },
]

const TINT = {
  doing: "text-doing",
  done: "text-done",
  planned: "text-muted-foreground",
  quiet: "text-muted-foreground/50",
}

type Row = EffortSummary & {
  days: number | null
  state: ReturnType<typeof effortState>
}

/** Efforts by repo, with what waits on you on top, then the sessions that belong to no effort. */
export function Sidebar({
  efforts,
  sessions,
  selected,
  session,
  filter,
  bars,
  onFilter,
  onBars,
}: {
  efforts: EffortSummary[]
  /** Sessions with no effort. */
  sessions: SessionSummary[]
  selected: number | null
  /** The selected session's id. */
  session: string | null
  filter: Filter
  bars: boolean
  onFilter: (f: Filter) => void
  onBars: (b: boolean) => void
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // The selected effort, or the effort of the selected session, opens once the list has loaded.
  const opened = efforts.filter((e) => e.id === selected || (!!session && e.sessions.some((s) => s.id === session))).map((e) => e.id)
  useEffect(() => {
    if (opened.length) setOpen((o) => ({ ...o, ...Object.fromEntries(opened.map((id) => [id, true])) }))
  }, [opened.join()])
  const [fold, setFold] = useState<Record<string, boolean>>({})
  const flip = (k: string) => setFold((f) => ({ ...f, [k]: !f[k] }))

  const rows: Row[] = efforts
    .map((e) => {
      const days = daysSince(e.last_at)
      return { ...e, days, state: effortState(e, days) }
    })
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()) || e.repo_name.toLowerCase().includes(q.toLowerCase()))
    .filter((e) => filter !== "active" || e.state === "doing" || (e.days !== null && e.days <= 14) || e.id === selected)
    .filter((e) => filter !== "neglected" || (e.state !== "done" && (e.days === null || e.days >= 7)))
  const waiting = efforts.flatMap((e) => e.waiting.map((w) => ({ ...w, effort: e })))

  // Neglected lists everything it finds; the other filters fold old efforts and quiet repos.
  const noFold = filter === "neglected" || !!q
  const repos = [...new Set(rows.map((e) => e.repo_name))].map((name) => {
    const list = rows.filter((e) => e.repo_name === name)
    return {
      name,
      list,
      newest: Math.min(...list.map((e) => e.days ?? Infinity)),
    }
  })
  const active = repos.filter((r) => noFold || r.newest <= 7 || r.list.some((e) => e.id === selected))
  const quiet = repos.filter((r) => !active.includes(r))

  const repoBlock = (r: (typeof repos)[number]) => {
    const shown = noFold || fold[r.name] ? r.list : r.list.filter((e) => (e.days !== null && e.days <= 14) || e.id === selected)
    const hidden = r.list.length - shown.length
    return (
      <div key={r.name} className="flex flex-col">
        <div className="px-1 pb-[3px] text-xs text-muted-foreground">{r.name}</div>
        {shown.map((e) => (
          <EffortRow key={e.id} e={e} selected={e.id === selected} session={session} bars={bars} open={!!open[e.id]} onToggle={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))} />
        ))}
        {(hidden > 0 || fold[r.name]) && (
          <button type="button" onClick={() => flip(r.name)} className="cursor-pointer px-2 py-[5px] text-left text-[12.5px] text-muted-foreground hover:text-foreground">
            {fold[r.name] ? "Fewer" : `${hidden} older`}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an effort or session"
          aria-label="Find an effort or session"
          className="rounded-[7px] border bg-background px-2.5 py-[7px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2 px-1 text-xs">
          <Segmented label="Filter" options={FILTERS} value={filter} onChange={onFilter} />
          <span className="grow" />
          <Segmented
            label="Sidebar view"
            options={[
              {
                id: "bars",
                label: "Bars",
                title: "Each effort with its phase bar",
              },
              {
                id: "list",
                label: "List",
                title: "Names and dates only, to skim",
              },
            ]}
            value={bars ? "bars" : "list"}
            onChange={(v) => onBars(v === "bars")}
          />
        </div>
      </div>

      {waiting.length > 0 && (
        <section aria-label="Waiting on you" className="flex flex-col gap-1.5">
          <div className="px-1 text-xs font-semibold text-[color-mix(in_oklab,var(--doing)_60%,black)] dark:text-doing">Waiting on you · {waiting.length}</div>
          {waiting.map((w, i) => (
            <Link
              key={i}
              to="/timeline"
              search={(s) => ({ ...s, session: undefined, group: String(w.effort.id) })}
              className="ml-1 border-l-2 border-doing/50 py-px pl-2.5 text-[13px] leading-snug text-foreground/90 hover:text-foreground"
            >
              {w.text} <span className="text-muted-foreground">· {w.effort.name}</span>
            </Link>
          ))}
        </section>
      )}

      <nav aria-label="Efforts" className="flex flex-col gap-3.5">
        {active.map(repoBlock)}
        {quiet.length > 0 && (
          <div className="flex flex-col gap-3.5">
            <button
              type="button"
              onClick={() => flip("quiet")}
              aria-expanded={!!fold.quiet}
              className="cursor-pointer px-2 py-[5px] text-left text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              {fold.quiet ? "▾" : "▸"} {quiet.length} quiet {quiet.length === 1 ? "repo" : "repos"}
            </button>
            {fold.quiet && quiet.map(repoBlock)}
          </div>
        )}
        {!rows.length && (
          <p className="px-1 text-[13px] text-muted-foreground">{efforts.length ? "No effort matches." : "No efforts yet. Link a todo group to its branches with atlas timeline link."}</p>
        )}
      </nav>

      <Loose sessions={sessions} q={q} filter={filter} selected={session} fold={fold} flip={flip} />
    </div>
  )
}

const recent = (s: SessionSummary) => (daysSince(s.ended_at) ?? Infinity) <= 14

/**
 * Sessions with no effort (design #look-orphans): big ones get a lean row, smaller ones fold into one
 * line. Active and Neglected fold sessions older than 14 days.
 */
function Loose({ sessions, q, filter, selected, fold, flip }: { sessions: SessionSummary[]; q: string; filter: Filter; selected: string | null; fold: Record<string, boolean>; flip: (k: string) => void }) {
  const found = sessions.filter((s) => !q || sessionTitle(s).toLowerCase().includes(q.toLowerCase()) || s.id.startsWith(q.toLowerCase()) || !!s.repo_name?.toLowerCase().includes(q.toLowerCase()))
  if (!found.length) return null
  const big = found.filter((s) => s.big || s.id === selected)
  const small = found.filter((s) => !big.includes(s))
  const shown = filter === "all" || q || fold.older ? big : big.filter((s) => recent(s) || s.id === selected)
  const older = big.length - shown.length
  return (
    <section aria-label="Sessions with no effort" className="flex flex-col">
      <div className="px-1 pb-[3px] text-xs text-muted-foreground">Sessions with no effort</div>
      {shown.map((s) => (
        <SessionRow key={s.id} s={s} selected={s.id === selected} detail={[s.repo_name, sessionSize(s)].filter(Boolean).join(" · ")} />
      ))}
      {(older > 0 || fold.older) && (
        <button type="button" onClick={() => flip("older")} className="cursor-pointer px-2 py-[5px] text-left text-[12.5px] text-muted-foreground hover:text-foreground">
          {fold.older ? "Fewer" : `${older} older`}
        </button>
      )}
      {small.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => flip("small")}
            aria-expanded={!!fold.small}
            title="Under 3 commits, 3 todos, 30 prompts and 2 days"
            className="cursor-pointer px-2 py-[5px] text-left text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            {fold.small ? "▾" : "▸"} {small.length} smaller {small.length === 1 ? "session" : "sessions"}
          </button>
          {fold.small && small.map((s) => <SessionRow key={s.id} s={s} selected={s.id === selected} detail={[s.repo_name, sessionSize(s)].filter(Boolean).join(" · ")} />)}
        </>
      )}
    </section>
  )
}

/** A session by its title, with the short id in grey; `detail` is the grey line under it. */
export function SessionRow({ s, selected, detail, nested }: { s: SessionSummary; selected: boolean; detail?: string; nested?: boolean }) {
  return (
    <Link
      to="/timeline"
      search={(p) => ({ ...p, group: undefined, session: s.id })}
      aria-current={selected ? "page" : undefined}
      data-session={s.id}
      title={`${sessionTitle(s)} · ${sessionSpan(s)}`}
      className={cn("flex flex-col rounded-[7px] px-2 py-1 hover:bg-muted/70", nested && "ml-[19px] py-0.5", selected && "bg-[color-mix(in_oklab,var(--link)_9%,transparent)]")}
    >
      <span className="flex min-w-0 items-center gap-2">
        <AgentIcon size={12} />
        <span className={cn("truncate", nested ? "text-[13px]" : "", selected ? "font-semibold text-link" : "text-foreground")}>{sessionTitle(s)}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{s.id.slice(0, 8)}</span>
        <span className="grow" />
        <span className="text-xs whitespace-nowrap text-muted-foreground">{ago(daysSince(s.ended_at))}</span>
      </span>
      {detail && <span className="ml-[20px] truncate text-xs text-muted-foreground">{detail}</span>}
    </Link>
  )
}

function EffortRow({ e, selected, session, bars, open, onToggle }: { e: Row; selected: boolean; session: string | null; bars: boolean; open: boolean; onToggle: () => void }) {
  const repos = [...new Set([e.repo_name, ...e.sessions.map((s) => s.repo_name).filter((r): r is string => !!r)])]
  const status = e.doing ? `${e.doing} open` : e.state === "done" ? "Done" : e.bar.length ? `${e.bar.length} ${e.bar.length === 1 ? "entry" : "entries"}, none started` : "Not synced yet"
  return (
    <div data-effort={e.name} className={cn("block rounded-[7px] px-2 py-1.5", selected && "bg-[color-mix(in_oklab,var(--link)_9%,transparent)]")}>
      <span className="flex items-center gap-2">
        <span className={cn("flex shrink-0", TINT[e.state])} title={e.state}>
          <EffortIcon />
        </span>
        <Link
          to="/timeline"
          search={(s) => ({ ...s, session: undefined, group: String(e.id) })}
          aria-current={selected ? "page" : undefined}
          className={cn("truncate", selected ? "font-semibold text-link" : e.state === "done" || e.state === "quiet" ? "text-muted-foreground" : "text-foreground")}
        >
          {e.name}
        </Link>
        <span className="grow" />
        <span className="text-xs whitespace-nowrap text-muted-foreground">{e.state === "doing" && e.days === 0 ? "now" : ago(e.days)}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? "Hide details" : "Show details"}
          className="-my-1 -mr-1.5 flex size-6 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRightIcon className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>
      </span>
      {bars && e.bar.length > 0 && (
        <span className="mt-[5px] mr-6 ml-[21px] flex gap-0.5" aria-label={`Phases: ${e.bar.map((b) => `${b.title} ${b.state}`).join(", ")}`}>
          {e.bar.map((b) => (
            <span
              key={b.entry}
              title={`${b.title}: ${b.state}`}
              className={cn("h-[3px] flex-1 rounded-[2px]", b.state === "done" && "bg-done", b.state === "doing" && "bg-doing", b.state === "todo" && "bg-border")}
              style={
                b.state === "parked"
                  ? {
                      background: "repeating-linear-gradient(45deg, var(--muted-foreground) 0 2px, transparent 2px 4px)",
                      opacity: 0.5,
                    }
                  : undefined
              }
            />
          ))}
        </span>
      )}
      {open && (
        <>
          <span className="mt-[5px] ml-[21px] block text-xs text-muted-foreground">{status}</span>
          {/* Sessions stay folded until the effort is expanded, so a long list of efforts stays short. */}
          {e.sessions.length > 0 && (
            <span className="mt-1 -mr-2 -ml-2 flex flex-col" data-effort-sessions>
              {e.sessions.map((s) => (
                <SessionRow key={s.id} s={s} selected={s.id === session} nested />
              ))}
            </span>
          )}
          {repos.map((r) => (
            <span key={r} className="mt-1 ml-[21px] flex items-center gap-1.5 text-xs text-muted-foreground">
              <FolderIcon className="size-3 shrink-0" aria-hidden />
              {r}
              {r === e.repo_name && e.branches && <span className="font-mono text-[11px]">· {e.branches}</span>}
            </span>
          ))}
        </>
      )}
    </div>
  )
}

/** The effort icon from the herdr atlas mod (atlas-chip/effort.svg): a target. */
function EffortIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="block" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}

/** A small segmented control: a grey track with the chosen option on a white chip. */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string; title?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-[7px] bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn(
            "cursor-pointer rounded-[5px] px-[9px] py-[3px]",
            value === o.id ? "bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}
