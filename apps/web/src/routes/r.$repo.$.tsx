import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router"
import { ClipboardCopyIcon, ExternalLinkIcon, FileQuestionIcon, LinkIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { AppHeader } from "@/components/app-header"
import { copyMarkdown, DocPalette } from "@/components/docs/doc-palette"
import { LostDoc } from "@/components/docs/lost-doc"
import { CopyPath, ParentTodo, TodosLink } from "@/components/docs/hits"
import { ShareButton } from "@/components/docs/share-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { api, ApiError } from "@/lib/api"
import { exact, stamp } from "@/lib/format"
import { typeColor, useRepoColor } from "@/lib/doc-colors"
import { docHref, rawHref, type DocPage } from "@/lib/docs"
import { getDb } from "@/server/app-db"
import { movedFrom } from "@/server/doc-ids"
import { getIndex, servedFile } from "@/server/docs"
import { CSP_DOC, fileResponse } from "@/server/doc-files"

const DOC = /\.(md|html)$/
// A doc that never says it painted or is ready, such as one without the bridge, still shows after this long.
const SHOW_TIMEOUT = 5000

// next-themes' inline script sets the class on <html> before the app loads, so the frame need not wait for its hook.
const pageTheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light")
const noSubscribe = () => () => {}

// Every doc opens in one frame: this page's toolbar over the doc from /raw in a sandboxed iframe
// (spec section 12). Other files, such as an image a doc links, are sent as they are.
export const Route = createFileRoute("/r/$repo/$")({
  server: {
    handlers: {
      GET: ({ params, request, next }) => {
        const path = params._splat ?? ""
        // When x.md and x.html both exist, the html is the doc (spec D25).
        const html = path.endsWith(".md") ? `${path.slice(0, -3)}.html` : null
        if (html && servedFile(params.repo, html)) return Response.redirect(new URL(docHref({ repo: params.repo, path: html }), request.url), 302)
        if (DOC.test(path)) {
          // A doc with an id that once lived here moved: go where it is now.
          const moved = !servedFile(params.repo, path) && movedFrom(getDb(), getIndex(), { repo: params.repo, path })
          if (moved) return Response.redirect(new URL(docHref(moved) + new URL(request.url).search, request.url), 302)
          // A doc, found or not, is the app's page: it loads the doc from /raw, or says it is missing.
          return next()
        }
        const file = servedFile(params.repo, path)
        if (!file) return new Response(`No doc ${params.repo}/${path}`, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
        return fileResponse(file, CSP_DOC)
      },
    },
  },
  component: DocView,
})

type Related = { text: string; href: string }
// What the bridge in the iframe may send (src/server/bridge.ts). Anything else is dropped.
type FromDoc =
  | { type: "atlas:navigate"; href: string; tab?: boolean }
  | { type: "atlas:key"; key: "mod+k" | "/" }
  | { type: "atlas:hash"; hash: string }
  | { type: "atlas:ready"; related: Related[] }
  | { type: "atlas:painted" }

function DocView() {
  const repoColor = useRepoColor()
  const { repo, _splat: path = "" } = Route.useParams()
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
  const client = useSyncExternalStore(noSubscribe, () => true, () => false)
  const theme = resolvedTheme ?? (client ? pageTheme() : undefined)
  const [palette, setPalette] = useState(false)
  const [related, setRelated] = useState<Related[]>([])
  const doc = useQuery({
    queryKey: ["doc", repo, path],
    queryFn: () => api<DocPage>(`/docs/view?${new URLSearchParams({ repo, path })}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })
  const twin = doc.data?.twin
  useEffect(() => {
    if (twin) void navigate({ href: docHref({ repo, path: twin }) + window.location.hash, replace: true })
  }, [twin, repo, navigate])
  useEffect(() => {
    if (doc.data) document.title = `${doc.data.title} · Atlas`
  }, [doc.data])
  useEffect(() => setRelated([]), [repo, path])
  useHotkeys({ "mod+k": () => setPalette((o) => !o), "/": () => setPalette(true) })

  // A 404 carries the docs with the closest paths, and where the doc went when it moved.
  const missing = doc.error instanceof ApiError && doc.error.status === 404 ? (doc.error.body as { closest?: { repo: string; path: string; title: string }[]; moved?: { repo: string; path: string } | null } | null) : null
  const moved = missing?.moved
  useEffect(() => {
    if (moved) void navigate({ href: docHref(moved) + window.location.hash, replace: true })
  }, [moved, navigate])
  const lost = missing && !moved ? (missing.closest ?? []) : null
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader onCommand={() => setPalette(true)} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-sm text-muted-foreground sm:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <Link to="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <span aria-hidden>/</span>
          <Link to="/docs" search={{ repo }} className="flex items-center gap-1.5 hover:text-foreground" translate="no">
            <span aria-hidden className="size-2 rounded-full" style={{ background: repoColor(repo) }} />
            {repo}
          </Link>
          <span aria-hidden>/</span>
          <span className="min-w-0 text-xs">
            <CopyPath doc={{ path }} />
          </span>
        </nav>
        {doc.data?.type && (
          <Badge className="rounded-sm font-mono text-[10.5px] text-white uppercase" style={{ background: typeColor(doc.data.type) }}>
            {doc.data.type}
          </Badge>
        )}
        {doc.data && (
          <span className="text-xs whitespace-nowrap">
            Updated{" "}
            <time dateTime={doc.data.mtime} title={exact(doc.data.mtime)} className="tabular-nums">
              {stamp(doc.data.mtime)}
            </time>
          </span>
        )}
        {doc.data && (
          <div className="ml-auto flex items-center gap-1.5">
            {doc.data.todo && <ParentTodo todo={doc.data.todo} />}
            {doc.data.todos && <TodosLink todos={doc.data.todos} />}
            {related.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <LinkIcon data-icon="inline-start" />
                    Related
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-80">
                  {related.map((r) => (
                    <DropdownMenuItem key={r.href} asChild>
                      <a href={r.href} {...(r.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener" })}>
                        <span className="truncate">{r.text || r.href}</span>
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {doc.data.markdown && (
              <Button variant="ghost" size="sm" onClick={() => void copyMarkdown(repo, path)} title="Copy the doc's markdown">
                <ClipboardCopyIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Copy as Markdown</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <a href={rawHref({ repo, path })} target="_blank" rel="noopener" title="Open the doc on its own in a new tab">
                <ExternalLinkIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Open raw</span>
              </a>
            </Button>
            <ShareButton repo={repo} path={path} share={doc.data.share} />
          </div>
        )}
      </div>
      {/* The frame starts with the page, not after the doc's details: on a far server that is a round trip sooner. */}
      {lost ? (
        <LostDoc repo={repo} path={path} closest={lost} />
      ) : doc.error && !moved ? (
        <main className="px-4 py-8">
          <Empty className="mx-auto max-w-2xl border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileQuestionIcon />
              </EmptyMedia>
              <EmptyTitle>Could not load the doc</EmptyTitle>
              <EmptyDescription>{doc.error.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline">
                <Link to="/docs">Search the docs</Link>
              </Button>
            </EmptyContent>
          </Empty>
        </main>
      ) : twin || moved || !theme ? (
        <DocSkeleton />
      ) : (
        <DocFrame key={`${repo}/${path}`} repo={repo} path={path} title={doc.data?.title ?? path.split("/").pop()!} theme={theme} onPalette={() => setPalette(true)} onRelated={setRelated} />
      )}
      <DocPalette open={palette} onOpenChange={setPalette} doc={doc.data} />
    </div>
  )
}

const DocSkeleton = () => (
  <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8">
    <Skeleton className="h-8 w-2/3" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-5/6" />
  </div>
)

/**
 * The doc in a sandboxed iframe. It mounts once per doc, so a theme change is a message, not a reload.
 * The loader covers it until the doc first paints, so the reader never sees a blank frame.
 */
function DocFrame({ repo, path, title, theme, onPalette, onRelated }: { repo: string; path: string; title: string; theme: string; onPalette: () => void; onRelated: (r: Related[]) => void }) {
  const router = useRouter()
  const frame = useRef<HTMLIFrameElement>(null)
  const [loaded] = useState(theme)
  const [src] = useState(() => `${rawHref({ repo, path })}?theme=${loaded}${window.location.hash}`)
  const [shown, setShown] = useState(false)
  const latest = useRef({ onPalette, onRelated, theme })
  latest.current = { onPalette, onRelated, theme }

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "atlas:theme", theme }, "*")
  }, [theme])

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_TIMEOUT)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this page's own iframe, and only the known shapes.
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== "object") return
      const msg = e.data as FromDoc
      if (msg.type === "atlas:navigate" && typeof msg.href === "string" && msg.href.startsWith("/") && !msg.href.startsWith("//")) {
        if (msg.tab) window.open(msg.href, "_blank", "noopener")
        // A file that is not a doc, such as a screenshot, comes from the server as itself.
        else if (msg.href.startsWith("/r/") && !DOC.test(msg.href.split(/[?#]/)[0]!)) window.location.assign(msg.href)
        else router.history.push(msg.href)
      } else if (msg.type === "atlas:painted") setShown(true)
      else if (msg.type === "atlas:key") latest.current.onPalette()
      else if (msg.type === "atlas:hash" && typeof msg.hash === "string") window.history.replaceState(window.history.state, "", msg.hash || window.location.pathname + window.location.search)
      else if (msg.type === "atlas:ready" && Array.isArray(msg.related)) {
        setShown(true)
        latest.current.onRelated(msg.related.filter((r) => typeof r?.href === "string" && /^(\/[^/]|https?:)/.test(r.href)).map((r) => ({ text: String(r.text ?? ""), href: r.href })))
        // The URL carried the theme; resend only one changed while the doc loaded, so a doc's own toggle stays put.
        if (latest.current.theme !== loaded) frame.current?.contentWindow?.postMessage({ type: "atlas:theme", theme: latest.current.theme }, "*")
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [router, loaded])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <iframe
        ref={frame}
        title={title}
        src={src}
        // No allow-same-origin: the doc runs in an opaque origin, without the session or the API (spec section 8).
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        // Copy buttons inside docs, such as on code blocks.
        allow="clipboard-write"
        className="block min-h-0 w-full flex-1 border-0"
        style={{ colorScheme: theme === "dark" ? "dark" : "light" }}
      />
      {!shown && (
        <div data-doc-loading className="absolute inset-0 bg-background">
          <DocSkeleton />
        </div>
      )}
    </div>
  )
}
