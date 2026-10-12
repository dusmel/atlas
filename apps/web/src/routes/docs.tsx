import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { BoxIcon, SearchIcon } from "lucide-react"
import { Fragment, useEffect, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { ago, exact } from "@/lib/format"

type Search = { q?: string; repo?: string }
type Hit = { repo: string; path: string; kind: "md" | "html"; title: string; snippet: string; mtime: string; tags: string }
type Summary = { docs: number; md: number; html: number; repos: { name: string; docs: number }[] }

const text = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v))

export const Route = createFileRoute("/docs")({
  validateSearch: (s: Record<string, unknown>): Search => ({ q: text(s.q), repo: text(s.repo) }),
  component: DocsPage,
})

const ALL = "all"

function DocsPage() {
  const { q = "", repo } = Route.useSearch()
  const navigate = useNavigate({ from: "/docs" })
  const [typed, setTyped] = useState(q)

  // The URL follows the box after a short pause, so a search can be linked and the back button works.
  useEffect(() => {
    if (typed === q) return
    const t = setTimeout(() => void navigate({ search: (s) => ({ ...s, q: typed || undefined }), replace: true }), 200)
    return () => clearTimeout(t)
  }, [typed, q, navigate])

  const summary = useQuery({ queryKey: ["docs"], queryFn: () => api<Summary>("/docs"), staleTime: 60_000 })
  const params = new URLSearchParams({ q, ...(repo ? { repo } : {}) })
  const results = useQuery({
    queryKey: ["search", q, repo],
    queryFn: () => api<{ results: Hit[] }>(`/search?${params}`),
    enabled: q.trim() !== "",
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
        <h1 className="sr-only">Search the docs</h1>
        <form role="search" className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => e.preventDefault()}>
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
          <Select value={repo ?? ALL} onValueChange={(v) => void navigate({ search: (s) => ({ ...s, repo: v === ALL ? undefined : v }), replace: true })}>
            <SelectTrigger className="sm:w-56" aria-label="Repo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All repos</SelectItem>
              {summary.data?.repos.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {r.name} <span className="text-muted-foreground tabular-nums">{r.docs}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </form>

        {!q.trim() ? (
          <p className="text-sm text-muted-foreground" data-testid="docs-summary">
            {summary.data ? `${summary.data.docs} docs (${summary.data.md} markdown, ${summary.data.html} html) in ${summary.data.repos.length} repos.` : "Loading the docs…"}
          </p>
        ) : results.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : results.isError ? (
          <p className="text-sm text-destructive">{results.error.message}</p>
        ) : results.data.results.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No doc matches “{q}”</EmptyTitle>
              <EmptyDescription>{repo ? "Try all repos, or fewer words." : "Try fewer words. The last word matches the start of a word."}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol aria-label="Results" className="flex flex-col divide-y">
            {results.data.results.map((h) => (
              <li key={`${h.repo}/${h.path}`} data-result={`${h.repo}/${h.path}`} className="flex min-w-0 flex-col gap-1 py-3">
                <h2 className="font-medium text-pretty">{h.title}</h2>
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
                <p className="line-clamp-3 text-sm break-words text-muted-foreground">
                  <Snippet text={h.snippet} />
                </p>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
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
