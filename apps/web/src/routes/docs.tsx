import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { BoxIcon, ClockIcon, FolderIcon, ListFilterIcon, SearchIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "cn"
import { AppHeader } from "@/components/app-header"
import { DocActivity } from "@/components/docs/activity-view"
import { DocsPalette } from "@/components/docs/docs-palette"
import { ChangedPopover, CheckList, FilterBadge, FolderPopover } from "@/components/docs/filters"
import { copyPath, Hits } from "@/components/docs/hits"
import { DocOverview } from "@/components/docs/overview-view"
import { DocsSidebar } from "@/components/docs/sidebar"
import { SinceControl } from "@/components/todos/filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { api } from "@/lib/api"
import { DOC_VIEWS, docHref, docKey, flip, folderLabel, joined, list, type DocView, type Facets, type Hit, type Option, type Summary } from "@/lib/docs"
import { sinceLabel, sinceMs } from "@/lib/since"

type Search = { view?: Exclude<DocView, "search">; q?: string; repo?: string; folder?: string; since?: string; doc?: string }

const text = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v))

export const Route = createFileRoute("/docs")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    view: DOC_VIEWS.some((v) => v.id === s.view && v.id !== "search") ? (s.view as Search["view"]) : undefined,
    q: text(s.q),
    repo: text(s.repo),
    folder: text(s.folder),
    since: sinceMs(text(s.since)) ? text(s.since) : undefined,
    doc: text(s.doc),
  }),
  component: DocsPage,
})

function DocsPage() {
  const search = Route.useSearch()
  const { since } = search
  const view: DocView = search.view ?? "search"
  // The query only applies to Search; Activity and Overview count every doc.
  const q = view === "search" ? (search.q ?? "") : ""
  const repos = list(search.repo)
  const folders = list(search.folder)
  const navigate = useNavigate({ from: "/docs" })
  const [typed, setTyped] = useState(search.q ?? "")
  const [palette, setPalette] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(search.doc)
  const input = useRef<HTMLInputElement>(null)
  const set = (next: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...next }), replace: true })

  // The URL follows the box after a short pause, so a search can be linked and the back button works.
  useEffect(() => {
    if (typed === (search.q ?? "")) return
    const t = setTimeout(() => void navigate({ search: (s) => ({ ...s, q: typed || undefined, doc: undefined }), replace: true }), 200)
    return () => clearTimeout(t)
  }, [typed, search.q, navigate])

  const summary = useQuery({ queryKey: ["docs"], queryFn: () => api<Summary>("/docs"), staleTime: 60_000 })
  const filters = new URLSearchParams({ ...(search.repo ? { repo: search.repo } : {}), ...(search.folder ? { folder: search.folder } : {}), ...(since ? { since } : {}) })
  const results = useQuery({
    queryKey: ["search", q, search.repo, search.folder, since],
    queryFn: () => api<{ results: Hit[]; facets: Facets }>(`/search?${new URLSearchParams({ q, ...Object.fromEntries(filters) })}`),
    // Keep the last results on screen while typing, but never show them under Recently changed.
    placeholderData: (prev, prevQuery) => (q.trim() && String(prevQuery?.queryKey[1] ?? "").trim() ? prev : undefined),
  })
  const facets = results.data?.facets
  const hits = view === "search" ? (results.data?.results ?? []) : []
  const current = hits.find((h) => docKey(h) === selected)

  // Repos keep their order while typing, so the checkboxes don't move under the pointer.
  const repoOptions: Option[] = (summary.data?.repos ?? []).map((r) => ({ value: r.name, label: r.name, count: facets?.repo[r.name] ?? 0 }))
  const folderOptions: Option[] = [...new Set([...Object.keys(facets?.folder ?? {}), ...folders])]
    .sort((a, b) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)))
    .map((f) => ({ value: f, label: folderLabel(f), count: facets?.folder[f] ?? 0 }))
  const filtered = repos.length + folders.length + (since ? 1 : 0)
  const clear = () => set({ repo: undefined, folder: undefined, since: undefined })
  const toggleRepo = (v: string) => set({ repo: joined(flip(repos, v)) })

  // j and k move the focus with the selection, so Enter on the row copies its path. The arrows in the box leave the focus there.
  const move = (step: 1 | -1, focus = false) => {
    if (!hits.length) return
    const at = hits.findIndex((h) => docKey(h) === selected)
    const next = hits[at === -1 ? (step === 1 ? 0 : hits.length - 1) : Math.min(hits.length - 1, Math.max(0, at + step))]
    setSelected(docKey(next))
    const row = document.querySelector<HTMLElement>(`[data-result="${CSS.escape(docKey(next))}"]`)
    if (focus) row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: "nearest" })
  }
  useHotkeys({
    "mod+k": () => setPalette((o) => !o),
    "/": () => (set({ view: undefined }), requestAnimationFrame(() => input.current?.focus())),
    j: () => move(1, true),
    k: () => move(-1, true),
    o: () => current && window.location.assign(docHref(current)),
  })

  return (
    <>
      <AppHeader onCommand={() => setPalette(true)} />
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-5 sm:px-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <DocsSidebar view={view} summary={summary.data} repoOptions={repoOptions} repos={repos} onToggle={toggleRepo} onAll={() => set({ repo: undefined })} />

        <main className="flex min-w-0 flex-col gap-4">
          <h1 className="sr-only">Docs: {DOC_VIEWS.find((v) => v.id === view)!.label}</h1>
          <nav aria-label="Views" className="-mx-1 flex gap-1 md:hidden">
            {DOC_VIEWS.map((v) => (
              <Link
                key={v.id}
                to="/docs"
                search={(s) => ({ ...s, view: v.id === "search" ? undefined : v.id })}
                aria-current={view === v.id ? "page" : undefined}
                className={cn("flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground", view === v.id && "bg-muted font-medium text-foreground")}
              >
                <v.icon aria-hidden className="size-4" />
                {v.label}
              </Link>
            ))}
          </nav>

          <form role="search" className="flex flex-col gap-2 md:flex-row" onSubmit={(e) => e.preventDefault()}>
            {view === "search" && (
              <InputGroup className="flex-1">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  ref={input}
                  type="search"
                  name="q"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search the docs"
                  placeholder="Search titles and text of every doc…"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    // The arrows and Enter work from the box too, so a search never needs the mouse.
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") (e.preventDefault(), move(e.key === "ArrowDown" ? 1 : -1))
                    else if (e.key === "Enter" && current) copyPath(current)
                    else if (e.key === "Escape") input.current?.blur()
                  }}
                />
                <InputGroupAddon align="inline-end" className="max-md:hidden">
                  <Kbd>/</Kbd>
                </InputGroupAddon>
              </InputGroup>
            )}
            {view !== "overview" && (
              <div className={cn("hidden gap-2 md:flex", view !== "search" && "md:ml-auto")}>
                <FolderPopover options={folderOptions} picked={folders} onToggle={(v) => set({ folder: joined(flip(folders, v)) })} />
                <ChangedPopover since={since} onChange={(s) => set({ since: s })} />
              </div>
            )}
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="outline" className="min-h-11 md:hidden">
                  <ListFilterIcon data-icon="inline-start" />
                  Filters
                  {filtered > 0 && <Badge className="ml-1 tabular-nums">{filtered}</Badge>}
                </Button>
              </DrawerTrigger>
              <DrawerContent className="pb-[env(safe-area-inset-bottom)]">
                <DrawerHeader className="flex-row items-center justify-between">
                  <DrawerTitle>Filters</DrawerTitle>
                  {filtered > 0 && (
                    <Button variant="ghost" size="sm" onClick={clear}>
                      Clear all
                    </Button>
                  )}
                </DrawerHeader>
                <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 pb-4">
                  {view !== "overview" && (
                    <section aria-labelledby="changed-heading" className="flex flex-col gap-1 px-2">
                      <h3 id="changed-heading" className="text-xs font-medium text-muted-foreground">
                        Changed in the last
                      </h3>
                      <SinceControl value={since} onChange={(s) => set({ since: s })} />
                    </section>
                  )}
                  <CheckList name="repo" legend="Repos" options={repoOptions} picked={repos} onToggle={toggleRepo} touch />
                  {view !== "overview" && <CheckList name="folder" legend="Folders" options={folderOptions} picked={folders} onToggle={(v) => set({ folder: joined(flip(folders, v)) })} touch />}
                  {summary.data && (
                    <p className="px-2 text-xs text-muted-foreground tabular-nums">
                      {summary.data.docs} docs in {summary.data.repos.length} repos: {summary.data.md} markdown, {summary.data.html} html.
                    </p>
                  )}
                </div>
              </DrawerContent>
            </Drawer>
          </form>

          {filtered > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* The sidebar shows the picked repos on a wide screen. */}
              {repos.map((r) => (
                <FilterBadge key={`repo:${r}`} className="md:hidden" kind="Repo" icon={<BoxIcon />} label={r} onRemove={() => toggleRepo(r)} />
              ))}
              {view !== "overview" && folders.map((f) => <FilterBadge key={`folder:${f}`} kind="Folder" icon={<FolderIcon />} label={folderLabel(f)} onRemove={() => set({ folder: joined(flip(folders, f)) })} />)}
              {view !== "overview" && since && <FilterBadge kind="Changed" icon={<ClockIcon />} label={`in the last ${sinceLabel(since)}`} onRemove={() => set({ since: undefined })} />}
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={clear}>
                Clear filters
              </Button>
            </div>
          )}

          {view === "activity" ? (
            <DocActivity params={filters} />
          ) : view === "overview" ? (
            <DocOverview repos={repos} />
          ) : results.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : results.isError ? (
            <p className="text-sm text-destructive">{results.error.message}</p>
          ) : !q.trim() ? (
            <section aria-labelledby="recent" className="flex flex-col gap-1">
              <h2 id="recent" className="text-sm font-medium">
                Recently changed
              </h2>
              {hits.length ? <Hits hits={hits} label="Recently changed docs" selected={selected} onSelect={setSelected} /> : <p className="py-3 text-sm text-muted-foreground">No doc fits these filters.</p>}
            </section>
          ) : hits.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No doc matches “{q}”</EmptyTitle>
                <EmptyDescription>{filtered ? "Try fewer filters, or fewer words." : "Try fewer words. The last word matches the start of a word."}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                {results.data.facets.total} {results.data.facets.total === 1 ? "doc matches" : "docs match"}
                {results.data.facets.total > hits.length && `, showing the first ${hits.length}`}
              </p>
              <Hits hits={hits} label="Results" selected={selected} onSelect={setSelected} />
            </>
          )}

          {view === "search" && hits.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground max-md:hidden">
              <span>
                <Kbd>J</Kbd> <Kbd>K</Kbd> or the arrows to move
              </span>
              <span>
                <Kbd>↵</Kbd> to copy the path
              </span>
              <span>
                <Kbd>⌘K</Kbd> to find a doc from anywhere
              </span>
            </p>
          )}
        </main>
      </div>

      <DocsPalette
        open={palette}
        onOpenChange={setPalette}
        view={view}
        selected={current}
        filtered={filtered > 0}
        run={{
          pick: (h, query) => {
            setTyped(query)
            setSelected(docKey(h))
            void navigate({ search: { q: query || undefined, doc: docKey(h) } })
          },
          view: (v) => set({ view: v === "search" ? undefined : v }),
          copy: () => current && copyPath(current),
          open: () => current && window.location.assign(docHref(current)),
          clear,
          go: (to) => void navigate({ to }),
        }}
      />
    </>
  )
}
