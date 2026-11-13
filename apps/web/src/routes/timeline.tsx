import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { DocPalette } from "@/components/docs/doc-palette"
import { Dot, Merged, Rail } from "@/components/timeline/rail"
import { AgentIcon, ResumeCommand } from "@/components/timeline/session"
import { Segmented, Sidebar, type Filter } from "@/components/timeline/sidebar"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { api, ApiError } from "@/lib/api"
import { ago, daysSince, sessionSize, sessionSpan, sessionTitle, type EffortSummary, type EffortView, type SessionSummary, type SessionView, type TimelineList } from "@/lib/timeline"
import { cn } from "cn"

// Design: atlas/timeline/design.html#look. The view state lives in the URL, so a link opens the same view.
type Search = {
  group?: string
  session?: string
  density?: "compact"
  filter?: Exclude<Filter, "all">
  side?: "list"
}

const text = (v: unknown) => (typeof v === "string" && v ? v : undefined)

export const Route = createFileRoute("/timeline")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    group: text(s.group),
    session: text(s.session),
    density: s.density === "compact" ? "compact" : undefined,
    filter: s.filter === "active" || s.filter === "neglected" ? s.filter : undefined,
    side: s.side === "list" ? "list" : undefined,
  }),
  component: TimelinePage,
})

/** A todo group counts as an effort once it has branches linked or a synced entry. */
const isEffort = (e: EffortSummary) => !!e.branches || e.bar.length > 0

function TimelinePage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/timeline" })
  const [palette, setPalette] = useState(false)
  useHotkeys({ "mod+k": () => setPalette((o) => !o) })

  const list = useQuery({
    queryKey: ["timeline"],
    queryFn: () => api<TimelineList>("/timeline"),
  })
  const retry = (n: number, e: Error) => !(e instanceof ApiError && e.status === 404) && n < 1
  const view = useQuery({
    queryKey: ["timeline", search.group],
    queryFn: () => api<EffortView>(`/timeline?${new URLSearchParams({ group: search.group! })}`),
    enabled: !!search.group && !search.session,
    retry,
  })
  const sessionView = useQuery({
    queryKey: ["timeline", "session", search.session],
    queryFn: () => api<SessionView>(`/timeline?${new URLSearchParams({ session: search.session! })}`),
    enabled: !!search.session,
    retry,
  })
  const shown = search.session ? sessionView : view
  useEffect(() => {
    const name = search.session ? sessionView.data && sessionTitle(sessionView.data.session) : view.data?.group.name
    document.title = name ? `${name} · Timeline · Atlas` : "Timeline · Atlas"
  }, [search.session, view.data, sessionView.data])

  const efforts = (list.data?.efforts ?? []).filter(isEffort)
  // A session linked only to groups that are not efforts yet still needs a place: it lists with the loose ones.
  const loose = [...(list.data?.sessions ?? []), ...(list.data?.efforts ?? []).filter((e) => !isEffort(e)).flatMap((e) => e.sessions)]
    .filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i && !efforts.some((e) => e.sessions.some((x) => x.id === s.id)))
    .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))

  const set = (patch: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const compact = search.density === "compact"
  const selected = search.session ? null : (view.data?.group.id ?? (search.group && /^\d+$/.test(search.group) ? Number(search.group) : null))
  const picked = !!(search.group || search.session)

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader onCommand={() => setPalette(true)} />
      <DocPalette open={palette} onOpenChange={setPalette} page="/timeline" />
      <div className="flex min-h-0 grow">
        <aside className={cn("shrink-0 overflow-y-auto bg-muted/40 px-3.5 py-[18px] md:w-[300px] md:border-r", picked ? "max-md:hidden" : "max-md:w-full")}>
          <Sidebar
            efforts={efforts}
            sessions={loose}
            selected={selected}
            session={search.session ?? null}
            filter={search.filter ?? "all"}
            bars={search.side !== "list"}
            onFilter={(f) => set({ filter: f === "all" ? undefined : f })}
            onBars={(b) => set({ side: b ? undefined : "list" })}
          />
        </aside>
        <main className={cn("min-w-0 grow overflow-y-auto px-4 pt-6 pb-10 sm:px-11", !picked && "max-md:hidden")}>
          {!picked ? (
            <Empty className="mt-10">
              <EmptyHeader>
                <EmptyTitle>Pick an effort</EmptyTitle>
                <EmptyDescription>Each effort shows what got done, what is in progress, and what comes next.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : shown.error ? (
            <Empty className="mt-10">
              <EmptyHeader>
                <EmptyTitle>{shown.error instanceof ApiError && shown.error.status === 404 ? (search.session ? "No such session" : "No such effort") : "Could not load the timeline"}</EmptyTitle>
                <EmptyDescription>{shown.error.message}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : search.session ? (
            sessionView.data && <Session view={sessionView.data} compact={compact} onCompact={(c) => set({ density: c ? "compact" : undefined })} />
          ) : view.data ? (
            <Effort
              view={view.data}
              sessions={list.data?.efforts.find((e) => e.id === view.data.group.id)?.sessions ?? []}
              compact={compact}
              onCompact={(c) => set({ density: c ? "compact" : undefined })}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}

function Effort({ view, sessions, compact, onCompact }: { view: EffortView; sessions: SessionSummary[]; compact: boolean; onCompact: (c: boolean) => void }) {
  const g = view.group
  const synced =
    view.entries
      .map((e) => e.updated_at)
      .sort()
      .at(-1) ?? null
  return (
    <div className="flex max-w-4xl flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
        <Link to="/timeline" className="mr-1 inline-flex items-center md:hidden" aria-label="All efforts">
          <ArrowLeftIcon className="size-4" />
        </Link>
        <span>{g.repo_name}</span>
        <span aria-hidden>·</span>
        <Link to="/todos" search={{ view: "list", group: String(g.id) }} className="hover:text-foreground">
          {g.open} open {g.open === 1 ? "todo" : "todos"}
        </Link>
        {g.branches && (
          <>
            <span aria-hidden>·</span>
            <span>
              branches <span className="font-mono">{g.branches}</span>
            </span>
          </>
        )}
        {sessions.length > 0 && (
          <>
            <span aria-hidden>·</span>
            <span title={sessions.map((s) => `${sessionTitle(s)} · ${sessionSpan(s)}`).join("\n")}>
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            </span>
          </>
        )}
        {g.docs
          .filter((d) => d.href)
          .map((d) => (
            <span key={d.label} className="contents">
              <span aria-hidden>·</span>
              <a href={d.href!} className="text-link underline-offset-2 hover:underline">
                {d.label}
              </a>
            </span>
          ))}
        <span className="grow" />
        {synced && <span title={synced}>synced {ago(daysSince(synced))}</span>}
      </div>
      <Title name={g.name} compact={compact} onCompact={onCompact} />
      <Legends />
      {view.entries.length ? (
        <Rail entries={view.entries} owner={g.id} compact={compact} docsFolder={view.docs_folder} effortDir={view.effort_dir} sessions={sessions} />
      ) : (
        <Empty className="mt-6 border">
          <EmptyHeader>
            <EmptyTitle>Nothing synced yet</EmptyTitle>
            <EmptyDescription>
              Run <code className="font-mono">atlas timeline sync &quot;{g.name}&quot;</code> in the repo. A group needs its branches first:{" "}
              <code className="font-mono">atlas timeline link &quot;{g.name}&quot; --branches &apos;v1/*&apos;</code>.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function Title({ name, icon, compact, onCompact }: { name: string; icon?: React.ReactNode; compact: boolean; onCompact: (c: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-[-0.01em]">
        {icon}
        {name}
      </h1>
      <span className="grow" />
      <span className="text-[13px]">
        <Segmented
          label="Density"
          options={[
            {
              id: "expanded",
              label: "Expanded",
              title: "Every entry with its lines",
            },
            {
              id: "compact",
              label: "Compact",
              title: "One line per entry; now stays open",
            },
          ]}
          value={compact ? "compact" : "expanded"}
          onChange={(v) => onCompact(v === "compact")}
        />
      </span>
    </div>
  )
}

function Legends() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <Legend dot={<Dot state="done" size={12} />}>done</Legend>
      <Legend dot={<Dot state="doing" size={12} />}>doing</Legend>
      <Legend dot={<Dot state="todo" size={12} />}>to do, on a dotted line</Legend>
      <Legend dot={<Merged size={13} />}>merged</Legend>
      <span className="grow" />
      <span>
        Compact keeps <b className="font-medium text-foreground">now</b> open
      </span>
    </div>
  )
}

const SIGNALS: Record<string, string> = { todos: "its todos", prs: "its PRs", files: "the files it wrote" }

/** Design #look-orphans: the header, why it is listed, then one entry per day and what it left open. */
function Session({ view, compact, onCompact }: { view: SessionView; compact: boolean; onCompact: (c: boolean) => void }) {
  const s = view.session
  const and = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? ""))
  return (
    <div className="flex max-w-4xl flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
        <Link to="/timeline" className="mr-1 inline-flex items-center md:hidden" aria-label="All efforts and sessions">
          <ArrowLeftIcon className="size-4" />
        </Link>
        {s.repo_name && (
          <>
            <span>{s.repo_name}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="font-mono text-[12px]" title={s.id}>
          {s.id.slice(0, 8)}
        </span>
        <span aria-hidden>·</span>
        <span>{sessionSpan(s)}</span>
        <span aria-hidden>·</span>
        <span>{sessionSize(s)}</span>
      </div>
      <Title name={sessionTitle(s)} icon={<AgentIcon size={22} />} compact={compact} onCompact={onCompact} />
      <section aria-label="Why it is listed" className="flex flex-col gap-2 rounded-[10px] border bg-muted/30 px-4 py-3 text-[14px]">
        {s.efforts.length ? (
          <p>
            Worked on{" "}
            {s.efforts.map((e, i) => (
              <span key={e.id}>
                {i > 0 && (i === s.efforts.length - 1 ? " and " : ", ")}
                <Link to="/timeline" search={{ group: String(e.id) }} className="font-medium text-link underline-offset-2 hover:underline">
                  {e.name}
                </Link>{" "}
                <span className="text-muted-foreground">({e.repo_name}, by {and(e.signals.map((x) => SIGNALS[x] ?? x))})</span>
              </span>
            ))}
            .
          </p>
        ) : (
          <p>
            Belongs to no effort. It is listed because it is big enough to be one: 3 or more commits, 3 or more todos, 30 or more prompts, or 2 or more days.
          </p>
        )}
        <p className="text-[13px] text-muted-foreground">
          Titles and lines come from a digest of each day. The page never shows prompt text. Resume the session in its folder:
        </p>
        <ResumeCommand session={s} />
      </section>
      <Legends />
      {view.entries.length ? (
        <Rail entries={view.entries} owner={s.id} compact={compact} />
      ) : (
        <Empty className="mt-6 border">
          <EmptyHeader>
            <EmptyTitle>No days synced yet</EmptyTitle>
            <EmptyDescription>
              Run <code className="font-mono">atlas timeline sync --sessions</code> on the Mac where it ran.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function Legend({ dot, children }: { dot: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {dot}
      {children}
    </span>
  )
}
