import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { BoxIcon, CheckIcon, ChevronDownIcon, ClockIcon, FolderIcon, ListFilterIcon, SearchIcon, XIcon } from "lucide-react"
import { Fragment, useEffect, useState } from "react"
import { cn } from "cn"
import { AppHeader } from "@/components/app-header"
import { SinceControl } from "@/components/todos/filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { ago, exact } from "@/lib/format"
import { sinceLabel, sinceMs } from "@/lib/since"

type Search = { q?: string; repo?: string; folder?: string; since?: string }
type Hit = { repo: string; path: string; kind: "md" | "html"; title: string; snippet: string; mtime: string; tags: string }
type Facets = { total: number; repo: Record<string, number>; folder: Record<string, number> }
type Summary = { docs: number; md: number; html: number; repos: { name: string; docs: number }[] }
type Option = { value: string; label: string; count: number }

const text = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v))
// Several repos or folders sit in the URL comma-separated, as on Todos.
const list = (v?: string) => (v ? v.split(",").filter(Boolean) : [])
const joined = (values: string[]) => (values.length ? values.join(",") : undefined)
const flip = (values: string[], v: string) => (values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
const folderLabel = (f: string) => (f === "." ? "Top level" : f)

export const Route = createFileRoute("/docs")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: text(s.q),
    repo: text(s.repo),
    folder: text(s.folder),
    since: sinceMs(text(s.since)) ? text(s.since) : undefined,
  }),
  component: DocsPage,
})

function DocsPage() {
  const search = Route.useSearch()
  const { q = "", since } = search
  const repos = list(search.repo)
  const folders = list(search.folder)
  const navigate = useNavigate({ from: "/docs" })
  const [typed, setTyped] = useState(q)
  const set = (next: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...next }), replace: true })

  // The URL follows the box after a short pause, so a search can be linked and the back button works.
  useEffect(() => {
    if (typed === q) return
    const t = setTimeout(() => void navigate({ search: (s) => ({ ...s, q: typed || undefined }), replace: true }), 200)
    return () => clearTimeout(t)
  }, [typed, q, navigate])

  const summary = useQuery({ queryKey: ["docs"], queryFn: () => api<Summary>("/docs"), staleTime: 60_000 })
  const params = new URLSearchParams({ q, ...(search.repo ? { repo: search.repo } : {}), ...(search.folder ? { folder: search.folder } : {}), ...(since ? { since } : {}) })
  const results = useQuery({
    queryKey: ["search", q, search.repo, search.folder, since],
    queryFn: () => api<{ results: Hit[]; facets: Facets }>(`/search?${params}`),
    // Keep the last results on screen while typing, but never show them under Recently changed.
    placeholderData: (prev, prevQuery) => (q.trim() && String(prevQuery?.queryKey[1] ?? "").trim() ? prev : undefined),
  })
  const facets = results.data?.facets

  // Repos keep their order while typing, so the checkboxes don't move under the pointer.
  const repoOptions: Option[] = (summary.data?.repos ?? []).map((r) => ({ value: r.name, label: r.name, count: facets?.repo[r.name] ?? 0 }))
  const folderOptions: Option[] = [...new Set([...Object.keys(facets?.folder ?? {}), ...folders])]
    .sort((a, b) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)))
    .map((f) => ({ value: f, label: folderLabel(f), count: facets?.folder[f] ?? 0 }))
  const filtered = repos.length + folders.length + (since ? 1 : 0)
  const clear = () => set({ repo: undefined, folder: undefined, since: undefined })

  return (
    <>
      <AppHeader />
      <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-5 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside aria-label="Repos" className="hidden md:block">
          <div className="sticky top-5 flex flex-col gap-1">
            <div className="flex h-7 items-center justify-between">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Repos</h2>
              {repos.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => set({ repo: undefined })}>
                  All
                </Button>
              )}
            </div>
            <CheckList name="repo" options={repoOptions} picked={repos} onToggle={(v) => set({ repo: joined(flip(repos, v)) })} />
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          <h1 className="sr-only">Search the docs</h1>
          <form role="search" className="flex flex-col gap-2 md:flex-row" onSubmit={(e) => e.preventDefault()}>
            <InputGroup className="flex-1">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                name="q"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-label="Search the docs"
                placeholder="Search titles and text of every doc…"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </InputGroup>
            <div className="hidden gap-2 md:flex">
              <FolderPopover options={folderOptions} picked={folders} onToggle={(v) => set({ folder: joined(flip(folders, v)) })} />
              <ChangedPopover since={since} onChange={(s) => set({ since: s })} />
            </div>
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
                  <section aria-labelledby="changed-heading" className="flex flex-col gap-1">
                    <h3 id="changed-heading" className="text-xs font-medium text-muted-foreground">
                      Changed in the last
                    </h3>
                    <SinceControl value={since} onChange={(s) => set({ since: s })} />
                  </section>
                  <section aria-labelledby="repos-heading" className="flex flex-col gap-1">
                    <h3 id="repos-heading" className="text-xs font-medium text-muted-foreground">
                      Repos
                    </h3>
                    <CheckList name="repo" options={repoOptions} picked={repos} onToggle={(v) => set({ repo: joined(flip(repos, v)) })} touch />
                  </section>
                  <section aria-labelledby="folders-heading" className="flex flex-col gap-1">
                    <h3 id="folders-heading" className="text-xs font-medium text-muted-foreground">
                      Folders
                    </h3>
                    <CheckList name="folder" options={folderOptions} picked={folders} onToggle={(v) => set({ folder: joined(flip(folders, v)) })} touch />
                  </section>
                </div>
              </DrawerContent>
            </Drawer>
          </form>

          {filtered > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* The sidebar shows the picked repos on a wide screen. */}
              {repos.map((r) => (
                <FilterBadge key={`repo:${r}`} className="md:hidden" kind="Repo" icon={<BoxIcon />} label={r} onRemove={() => set({ repo: joined(flip(repos, r)) })} />
              ))}
              {folders.map((f) => (
                <FilterBadge key={`folder:${f}`} kind="Folder" icon={<FolderIcon />} label={folderLabel(f)} onRemove={() => set({ folder: joined(flip(folders, f)) })} />
              ))}
              {since && <FilterBadge kind="Changed" icon={<ClockIcon />} label={`in the last ${sinceLabel(since)}`} onRemove={() => set({ since: undefined })} />}
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={clear}>
                Clear filters
              </Button>
            </div>
          )}

          {!q.trim() && (
            <p className="text-sm text-muted-foreground" data-testid="docs-summary">
              {summary.data ? `${summary.data.docs} docs (${summary.data.md} markdown, ${summary.data.html} html) in ${summary.data.repos.length} repos.` : "Loading the docs…"}
            </p>
          )}
          {results.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : results.isError ? (
            <p className="text-sm text-destructive">{results.error.message}</p>
          ) : !q.trim() ? (
            <section aria-labelledby="recent" className="flex flex-col">
              <h2 id="recent" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Recently changed
              </h2>
              {results.data.results.length ? (
                <Hits hits={results.data.results} label="Recently changed docs" />
              ) : (
                <p className="py-3 text-sm text-muted-foreground">No doc fits these filters.</p>
              )}
            </section>
          ) : results.data.results.length === 0 ? (
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
                {results.data.facets.total > results.data.results.length && `, showing the first ${results.data.results.length}`}
              </p>
              <Hits hits={results.data.results} label="Results" />
            </>
          )}
        </main>
      </div>
    </>
  )
}

/** Checkboxes with a count each: the repo sidebar, and the repos and folders in the phone drawer. */
function CheckList({ name, options, picked, onToggle, touch }: { name: string; options: Option[]; picked: string[]; onToggle: (v: string) => void; touch?: boolean }) {
  return (
    <ul className="flex flex-col">
      {options.map((o) => (
        <li key={o.value}>
          <label className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted", touch ? "min-h-11" : "min-h-8")}>
            <input type="checkbox" name={name} value={o.value} className="size-4 shrink-0 accent-primary" checked={picked.includes(o.value)} onChange={() => onToggle(o.value)} />
            <span className={cn("min-w-0 flex-1 truncate", !o.count && !picked.includes(o.value) && "text-muted-foreground")} translate="no">
              {o.label}
            </span>
            <span className={cn("text-xs tabular-nums", o.count ? "text-muted-foreground" : "text-muted-foreground/50")}>{o.count}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

function FolderPopover({ options, picked, onToggle }: { options: Option[]; picked: string[]; onToggle: (v: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(picked.length && "border-primary/40")}>
          Folder
          {picked.length > 0 && <Badge className="h-5 min-w-5 px-1 tabular-nums">{picked.length}</Badge>}
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command loop>
          <CommandInput autoFocus placeholder="Filter by folder…" />
          <CommandList className="max-h-[min(60vh,24rem)]">
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = picked.includes(o.value)
                return (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => onToggle(o.value)} aria-checked={on} className="[&>svg:last-child]:hidden">
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {on && <CheckIcon className="size-3" />}
                    </span>
                    <FolderIcon className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className={cn("text-xs tabular-nums", o.count ? "text-muted-foreground" : "text-muted-foreground/50")}>{o.count}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ChangedPopover({ since, onChange }: { since?: string; onChange: (since?: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(since && "border-primary/40")}>
          Changed
          {since && <Badge className="h-5 px-1 tabular-nums">{since}</Badge>}
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="mb-2 text-xs text-muted-foreground">Docs saved in the last…</p>
        <SinceControl value={since} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}

function FilterBadge({ kind, icon, label, onRemove, className }: { kind: string; icon: React.ReactNode; label: string; onRemove: () => void; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("h-7 max-w-full gap-1 pr-1 font-normal [&>svg]:size-3.5", className)}>
      <span className="text-muted-foreground">{kind}</span>
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        className="shrink-0 rounded-sm p-0.5 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Remove ${kind} ${label}`}
        onClick={onRemove}
      >
        <XIcon className="size-3.5" />
      </button>
    </Badge>
  )
}

function Hits({ hits, label }: { hits: Hit[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col divide-y">
      {hits.map((h) => (
        <li key={`${h.repo}/${h.path}`} data-result={`${h.repo}/${h.path}`} className="flex min-w-0 flex-col gap-1 py-3">
          <h3 className="font-medium text-pretty">{h.title}</h3>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1" translate="no">
              <BoxIcon aria-hidden className="size-3" />
              {h.repo}
            </span>
            <span className="min-w-0 truncate font-mono" translate="no">
              {h.path}
            </span>
            <time dateTime={h.mtime} title={exact(h.mtime)}>
              {ago(h.mtime)}
            </time>
          </p>
          {h.snippet && (
            <p className="line-clamp-3 text-sm break-words text-muted-foreground">
              <Snippet text={h.snippet} />
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

// The server marks each match with \u0002 … \u0003, so the doc's text is never read as HTML.
function Snippet({ text }: { text: string }) {
  return text.split(/(\u0002[^\u0003]*\u0003)/).map((part, n) =>
    part.startsWith("\u0002") ? (
      <mark key={n} className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/25">
        {part.slice(1, -1)}
      </mark>
    ) : (
      <Fragment key={n}>{part}</Fragment>
    ),
  )
}
