import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { DocPalette } from "@/components/docs/doc-palette"
import { Dot, Merged, Rail } from "@/components/timeline/rail"
import { Segmented, Sidebar, type Filter } from "@/components/timeline/sidebar"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { api, ApiError } from "@/lib/api"
import { ago, daysSince, type EffortSummary, type EffortView } from "@/lib/timeline"
import { cn } from "cn"

// Design: atlas/timeline/design.html#look. The view state lives in the URL, so a link opens the same view.
type Search = {
  group?: string
  density?: "compact"
  filter?: Exclude<Filter, "all">
  side?: "list"
}

const text = (v: unknown) => (typeof v === "string" && v ? v : undefined)

export const Route = createFileRoute("/timeline")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    group: text(s.group),
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

  const efforts = useQuery({
    queryKey: ["timeline"],
    queryFn: () => api<EffortSummary[]>("/timeline"),
  })
  const view = useQuery({
    queryKey: ["timeline", search.group],
    queryFn: () => api<EffortView>(`/timeline?${new URLSearchParams({ group: search.group! })}`),
    enabled: !!search.group,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })
  useEffect(() => {
    document.title = view.data ? `${view.data.group.name} · Timeline · Atlas` : "Timeline · Atlas"
  }, [view.data])

  const set = (patch: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const compact = search.density === "compact"
  const selected = view.data?.group.id ?? (search.group && /^\d+$/.test(search.group) ? Number(search.group) : null)

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader onCommand={() => setPalette(true)} />
      <DocPalette open={palette} onOpenChange={setPalette} page="/timeline" />
      <div className="flex min-h-0 grow">
        <aside className={cn("shrink-0 overflow-y-auto bg-muted/40 px-3.5 py-[18px] md:w-[300px] md:border-r", search.group ? "max-md:hidden" : "max-md:w-full")}>
          <Sidebar
            efforts={(efforts.data ?? []).filter(isEffort)}
            selected={selected}
            filter={search.filter ?? "all"}
            bars={search.side !== "list"}
            onFilter={(f) => set({ filter: f === "all" ? undefined : f })}
            onBars={(b) => set({ side: b ? undefined : "list" })}
          />
        </aside>
        <main className={cn("min-w-0 grow overflow-y-auto px-4 pt-6 pb-10 sm:px-11", !search.group && "max-md:hidden")}>
          {!search.group ? (
            <Empty className="mt-10">
              <EmptyHeader>
                <EmptyTitle>Pick an effort</EmptyTitle>
                <EmptyDescription>Each effort shows what got done, what is in progress, and what comes next.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : view.error ? (
            <Empty className="mt-10">
              <EmptyHeader>
                <EmptyTitle>{view.error instanceof ApiError && view.error.status === 404 ? "No such effort" : "Could not load the timeline"}</EmptyTitle>
                <EmptyDescription>{view.error.message}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : view.data ? (
            <Effort view={view.data} compact={compact} onCompact={(c) => set({ density: c ? "compact" : undefined })} />
          ) : null}
        </main>
      </div>
    </div>
  )
}

function Effort({ view, compact, onCompact }: { view: EffortView; compact: boolean; onCompact: (c: boolean) => void }) {
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
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-[28px] font-semibold tracking-[-0.01em]">{g.name}</h1>
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
      {view.entries.length ? (
        <Rail view={view} compact={compact} />
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

function Legend({ dot, children }: { dot: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {dot}
      {children}
    </span>
  )
}
