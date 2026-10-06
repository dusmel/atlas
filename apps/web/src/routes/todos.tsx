import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityView } from "@/components/todos/activity-view"
import { Board } from "@/components/todos/board"
import { CommandPalette } from "@/components/todos/command-palette"
import { MoveDialog, NewItemDialog, ShortcutsDialog } from "@/components/todos/dialogs"
import { FilterBar, useOptions } from "@/components/todos/filters"
import { ItemPanel } from "@/components/todos/item-panel"
import { ListView } from "@/components/todos/list-view"
import { MobileBoard } from "@/components/todos/mobile-board"
import { OverviewView } from "@/components/todos/overview-view"
import { TriageView } from "@/components/todos/triage-view"
import { VIEWS, ViewTabs, type View } from "@/components/todos/view-tabs"
import { useHotkeys, type Hotkeys } from "@/hooks/use-hotkeys"
import { useIsDesktop } from "@/hooks/use-media-query"
import { layout, step } from "@/lib/board"
import { matches, STATUSES, useActions, useGroups, useItemDetail, useItems, useRepos, type Filters, type Row, type Status } from "@/lib/todos"

// Filters live in the URL as comma lists, so a bookmark is a saved view: /todos?view=list&repo=sem&priority=P0,P1
type Search = { view?: Exclude<View, "board">; sort?: string; repo?: string; group?: string; priority?: string; status?: string; by?: string; q?: string; done?: "all"; item?: number; lane?: Status }

const text = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v))

export const Route = createFileRoute("/todos")({
  head: () => ({ meta: [{ title: "Todos · Atlas" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    view: VIEWS.some((v) => v.id === s.view && v.id !== "board") ? (s.view as Search["view"]) : undefined,
    sort: text(s.sort),
    repo: text(s.repo),
    group: text(s.group),
    priority: text(s.priority),
    status: text(s.status),
    by: text(s.by),
    q: text(s.q),
    done: s.done === "all" ? "all" : undefined,
    item: Number.isInteger(Number(s.item)) && Number(s.item) > 0 ? Number(s.item) : undefined,
    lane: STATUSES.includes(s.lane as Status) ? (s.lane as Status) : undefined,
  }),
  component: TodosPage,
})

const list = (v?: string) => (v ? v.split(",").filter(Boolean) : undefined)

function toFilters(s: Search): Filters {
  return {
    repo: list(s.repo),
    group: list(s.group)?.map((g) => (g === "none" ? "none" : Number(g))),
    priority: list(s.priority),
    status: list(s.status),
    by: list(s.by),
    q: s.q,
    done: s.done,
  }
}

const join = (v?: (string | number)[]) => (v?.length ? v.join(",") : undefined)
const fromFilters = (f: Filters): Partial<Search> => ({
  repo: join(f.repo),
  group: join(f.group),
  priority: join(f.priority),
  status: join(f.status),
  by: join(f.by),
  q: f.q || undefined,
  done: f.done,
})

/** Rows you folded stay folded on this browser. Inbox starts folded: it holds about 90 untriaged items. */
function useFolded() {
  const KEY = "atlas.folded-rows"
  const [folded, setFolded] = useState<Set<string>>(() => new Set(["inbox"]))
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY)
      if (saved) setFolded(new Set(JSON.parse(saved) as string[]))
    } catch {}
  }, [])
  const toggle = useCallback((key: string) => {
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]))
      } catch {}
      return next
    })
  }, [])
  return [folded, toggle] as const
}

const focusCard = (id: number) =>
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-item="${id}"]`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  })

function TodosPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/todos" })
  const setSearch = useCallback((patch: Partial<Search>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true }), [navigate])

  const itemsQuery = useItems()
  const repos = useRepos().data ?? []
  const groups = useGroups().data ?? []
  const all = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const desktop = useIsDesktop()
  const actions = useActions()
  const { setTheme } = useTheme()
  const searchRef = useRef<HTMLInputElement>(null)

  const filters = useMemo(() => toFilters(search), [search])
  const setFilters = (f: Filters) => setSearch(fromFilters(f))
  const options = useOptions(all, filters, repos, groups)
  const visible = useMemo(() => all.filter((i) => matches(i, filters)), [all, filters])
  const statuses = useMemo(() => (filters.status?.length ? STATUSES.filter((s) => filters.status!.includes(s)) : [...STATUSES]), [filters.status])

  const [folded, toggleRow] = useFolded()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleCell = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const rows = useMemo(() => layout(visible, statuses, folded, expanded), [visible, statuses, folded, expanded])
  const laneTotals = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, visible.filter((i) => i.status === s).length])) as Record<Status, number>, [visible])
  const childCount = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of all) if (i.parent_id) m.set(i.parent_id, (m.get(i.parent_id) ?? 0) + 1)
    return m
  }, [all])
  const showRepo = useMemo(() => new Set(visible.map((i) => i.repo_id)).size > 1, [visible])

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = all.find((i) => i.id === selectedId) ?? null
  const [adding, setAdding] = useState<{ priority: Row } | null>(null)
  const [moving, setMoving] = useState<number | null>(null)
  const [palette, setPalette] = useState<{ open: boolean; page: "root" | "filter" | "views" }>({ open: false, page: "root" })
  const [shortcuts, setShortcuts] = useState(false)

  // The open item may be filtered out, or older than the Done window, so fall back to fetching it.
  const listed = search.item ? all.find((i) => i.id === search.item) : undefined
  const fetched = useItemDetail(search.item && !listed ? search.item : null)
  const panelItem = listed ?? fetched.data?.item ?? null

  const open = (id: number) => {
    setSelectedId(id)
    setSearch({ item: id })
  }
  const closePanel = () => {
    setSearch({ item: undefined })
    if (selectedId) focusCard(selectedId)
  }
  const select = (id: number | null) => {
    setSelectedId(id)
    if (id) focusCard(id)
  }
  const onSelected = (fn: (item: NonNullable<typeof selected>) => void) => () => selected && fn(selected)

  const view: View = search.view ?? "board"
  const setView = (v: View) => setSearch({ view: v === "board" ? undefined : v })
  const inbox = useMemo(
    () => all.filter((i) => i.priority === null && i.status !== "done" && matches(i, filters, "priority")).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id),
    [all, filters],
  )
  const overviewItems = useMemo(() => all.filter((i) => matches(i, { ...filters, done: "all" })), [all, filters])

  // Every view adds its own keys to these; only the view on screen listens.
  const keys: Hotkeys = {
    "mod+k": () => setPalette({ open: true, page: "root" }),
    "/": () => searchRef.current?.focus(),
    f: () => setPalette({ open: true, page: "filter" }),
    n: () => setAdding({ priority: null }),
    "?": () => setShortcuts(true),
    v: () => setPalette({ open: true, page: "views" }),
  }

  const boardKeys: Hotkeys = {
    j: () => select(step(rows, selectedId, "down")),
    k: () => select(step(rows, selectedId, "up")),
    h: () => (desktop ? select(step(rows, selectedId, "left")) : undefined),
    l: () => (desktop ? select(step(rows, selectedId, "right")) : undefined),
    Enter: onSelected((i) => open(i.id)),
    "0": onSelected((i) => actions.update(i, { priority: "P0" })),
    "1": onSelected((i) => actions.update(i, { priority: "P1" })),
    "2": onSelected((i) => actions.update(i, { priority: "P2" })),
    "3": onSelected((i) => actions.update(i, { priority: "P3" })),
    i: onSelected((i) => actions.update(i, { priority: null })),
    s: onSelected((i) => actions.update(i, { status: STATUSES[(STATUSES.indexOf(i.status) + 1) % STATUSES.length] })),
    m: onSelected((i) => setMoving(i.id)),
    a: onSelected((i) => {
      const next = step(rows, i.id, "down")
      actions.archive(i)
      select(next !== i.id ? next : null)
    }),
    z: () => actions.undoArchive(),
    Escape: () => {
      setSelectedId(null)
      ;(document.activeElement as HTMLElement | null)?.blur()
    },
  }
  // List and Triage listen for themselves, with these keys added to their own.
  useHotkeys(view === "board" ? { ...keys, ...boardKeys } : keys, view === "board" || view === "overview" || view === "activity")

  // A card that changes row or lane is drawn again elsewhere; keep the keyboard on it.
  const position = selected ? `${selected.priority}:${selected.status}` : ""
  useEffect(() => {
    if (selectedId && document.activeElement === document.body) focusCard(selectedId)
  }, [position, selectedId])

  const boardProps = {
    rows,
    statuses,
    laneTotals,
    showRepo,
    childCount,
    expanded,
    selectedId,
    doneAll: filters.done === "all",
    onSelect: setSelectedId,
    onOpen: open,
    onAdd: (priority: Row) => setAdding({ priority }),
    onToggleRow: toggleRow,
    onToggleCell: toggleCell,
    onToggleDone: () => setSearch({ done: filters.done === "all" ? undefined : "all" }),
    onMove: actions.move,
  }

  return (
    <div className="min-h-dvh">
      <a href="#todos" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to the {VIEWS.find((v) => v.id === view)!.label.toLowerCase()}
      </a>
      <AppHeader onCommand={() => setPalette({ open: true, page: "root" })} onShortcuts={() => setShortcuts(true)} />
      <main id="todos">
        <h1 className="sr-only">Todos: {VIEWS.find((v) => v.id === view)!.label}</h1>
        <ViewTabs view={view} inbox={inbox.length} />
        <FilterBar
          filters={filters}
          options={options}
          onChange={setFilters}
          desktop={desktop}
          searchRef={searchRef}
          shown={view === "board" || view === "list" ? visible.length : view === "triage" ? inbox.length : view === "overview" ? overviewItems.length : undefined}
        />
        {view === "activity" ? (
          <ActivityView repo={filters.repo} by={filters.by} otherFilters={!!(filters.group?.length || filters.priority?.length || filters.status?.length || filters.q)} onOpen={open} />
        ) : itemsQuery.isPending ? (
          <BoardSkeleton />
        ) : itemsQuery.isError ? (
          <Empty className="mx-4 my-10 border">
            <EmptyHeader>
              <EmptyTitle>The board didn't load</EmptyTitle>
              <EmptyDescription>{itemsQuery.error.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => itemsQuery.refetch()}>Try again</Button>
            </EmptyContent>
          </Empty>
        ) : view === "triage" ? (
          <TriageView inbox={inbox} all={all} groups={groups} onOpen={open} onCurrent={setSelectedId} keys={keys} />
        ) : view === "overview" ? (
          <OverviewView items={overviewItems} onOpen={open} />
        ) : visible.length === 0 ? (
          <Empty className="mx-4 my-10 border sm:mx-6">
            <EmptyHeader>
              <EmptyTitle>No items match</EmptyTitle>
              <EmptyDescription>{all.length ? "Remove a filter or change the search." : "Add the first item with N, or the button below."}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {all.length ? <Button onClick={() => setFilters({ done: filters.done })}>Clear filters</Button> : <Button onClick={() => setAdding({ priority: null })}>New item</Button>}
            </EmptyContent>
          </Empty>
        ) : view === "list" ? (
          <ListView
            items={visible}
            groups={groups}
            showRepo={showRepo}
            sort={search.sort}
            onSort={(sort) => setSearch({ sort })}
            cursor={selectedId}
            onCursor={setSelectedId}
            onOpen={open}
            onMove={setMoving}
            keys={keys}
          />
        ) : desktop ? (
          <Board {...boardProps} />
        ) : (
          <MobileBoard {...boardProps} lane={search.lane ?? "todo"} onLane={(lane) => setSearch({ lane })} />
        )}
      </main>

      {!desktop && view !== "triage" && (
        <Button
          size="icon"
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 size-14 rounded-full shadow-lg"
          aria-label="New item"
          onClick={() => setAdding({ priority: null })}
        >
          <PlusIcon className="size-6" />
        </Button>
      )}

      <ItemPanel item={panelItem} items={all} desktop={desktop} onClose={closePanel} onOpen={open} />
      <NewItemDialog
        open={!!adding}
        priority={adding?.priority ?? null}
        repos={repos}
        groups={groups}
        items={all}
        repoHint={filters.repo?.length === 1 ? filters.repo[0] : undefined}
        onClose={() => setAdding(null)}
        onCreated={(item) => select(item.id)}
        onOpen={open}
      />
      <MoveDialog item={all.find((i) => i.id === moving) ?? null} items={all} onClose={() => setMoving(null)} />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <CommandPalette
        open={palette.open}
        page={palette.page}
        view={view}
        onOpenChange={(o) => setPalette((p) => ({ ...p, open: o }))}
        items={all}
        selected={selected}
        filters={filters}
        doneAll={filters.done === "all"}
        options={options}
        onFilters={setFilters}
        run={{
          openItem: open,
          newItem: () => setAdding({ priority: null }),
          move: onSelected((i) => setMoving(i.id)),
          archive: onSelected((i) => actions.archive(i)),
          setPriority: (r) => selected && actions.update(selected, { priority: r }),
          setStatus: (s) => selected && actions.update(selected, { status: s }),
          toggleDone: boardProps.onToggleDone,
          view: setView,
          shortcuts: () => setShortcuts(true),
          settings: () => navigate({ to: "/settings" }),
          theme: setTheme,
        }}
      />
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-6" aria-busy="true" aria-label="Loading the board">
      {[0, 1, 2].map((r) => (
        <div key={r} className="grid grid-cols-1 gap-3 md:grid-cols-[7rem_repeat(3,minmax(0,1fr))]">
          <Skeleton className="hidden h-16 md:block" />
          {[0, 1, 2].map((c) => (
            <Skeleton key={c} className="h-20" />
          ))}
        </div>
      ))}
    </div>
  )
}

