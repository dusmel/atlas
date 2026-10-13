import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router"
import { ClipboardCopyIcon, ExternalLinkIcon, FileQuestionIcon, LinkIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { DocPalette } from "@/components/docs/doc-palette"
import { copyPath, CopyPath, TodosLink } from "@/components/docs/hits"
import { ShareButton } from "@/components/docs/share-button"
import { copy } from "@/components/todos/copy-id"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { api, ApiError } from "@/lib/api"
import { docHref, rawHref, type DocPage } from "@/lib/docs"
import { getIndex } from "@/server/docs"
import { CSP_DOC, docFile, fileResponse } from "@/server/doc-files"

const DOC = /\.(md|html)$/

// Every doc opens in one frame: this page's toolbar over the doc from /raw in a sandboxed iframe
// (spec section 12). Other files, such as an image a doc links, are sent as they are.
export const Route = createFileRoute("/r/$repo/$")({
  server: {
    handlers: {
      GET: ({ params, request, next }) => {
        const path = params._splat ?? ""
        // When x.md and x.html both exist, the html is the doc (spec D25).
        const html = path.endsWith(".md") ? `${path.slice(0, -3)}.html` : null
        if (html && docFile(getIndex().root, params.repo, html)) return Response.redirect(new URL(docHref({ repo: params.repo, path: html }), request.url), 302)
        // A doc, found or not, is the app's page: it loads the doc from /raw, or says it is missing.
        if (DOC.test(path)) return next()
        const file = docFile(getIndex().root, params.repo, path)
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

function DocView() {
  const { repo, _splat: path = "" } = Route.useParams()
  const navigate = useNavigate()
  const { resolvedTheme } = useTheme()
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

  const raw = () => window.open(rawHref({ repo, path }), "_blank", "noopener")
  const missing = doc.error instanceof ApiError && doc.error.status === 404
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader onCommand={() => setPalette(true)} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-sm text-muted-foreground sm:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <Link to="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <span aria-hidden>/</span>
          <Link to="/docs" search={{ repo }} className="hover:text-foreground" translate="no">
            {repo}
          </Link>
          <span aria-hidden>/</span>
          <span className="min-w-0 text-xs">
            <CopyPath doc={{ path }} />
          </span>
        </nav>
        {doc.data?.type && (
          <Badge variant="secondary" className="font-mono text-[10.5px] uppercase">
            {doc.data.type}
          </Badge>
        )}
        {doc.data && (
          <div className="ml-auto flex items-center gap-1.5">
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
      {doc.isPending || twin || !resolvedTheme ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : doc.error ? (
        <main className="px-4 py-8">
          <Empty className="mx-auto max-w-2xl border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileQuestionIcon />
              </EmptyMedia>
              <EmptyTitle>{missing ? "No doc here" : "Could not load the doc"}</EmptyTitle>
              <EmptyDescription>{missing ? `${repo}/${path} is not in the server's copy of the docs. If it is new, MEGA may not have synced it yet.` : doc.error.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline">
                <Link to="/docs">Search the docs</Link>
              </Button>
            </EmptyContent>
          </Empty>
        </main>
      ) : (
        <DocFrame key={`${repo}/${path}`} repo={repo} path={path} title={doc.data.title} theme={resolvedTheme} onPalette={() => setPalette(true)} onRelated={setRelated} />
      )}
      {doc.data && (
        <DocPalette
          open={palette}
          onOpenChange={setPalette}
          doc={doc.data}
          run={{
            pick: (h) => void navigate({ href: docHref(h) }),
            copy: () => copyPath({ path }),
            raw,
            go: (to) => void navigate({ to }),
          }}
        />
      )}
    </div>
  )
}

async function copyMarkdown(repo: string, path: string) {
  const res = await fetch(`${rawHref({ repo, path })}?format=md`)
  if (res.ok) await copy(await res.text(), "Markdown copied")
}

/** The doc in a sandboxed iframe. It mounts once per doc, so a theme change is a message, not a reload. */
function DocFrame({ repo, path, title, theme, onPalette, onRelated }: { repo: string; path: string; title: string; theme: string; onPalette: () => void; onRelated: (r: Related[]) => void }) {
  const router = useRouter()
  const frame = useRef<HTMLIFrameElement>(null)
  const [loaded] = useState(theme)
  const [src] = useState(() => `${rawHref({ repo, path })}?theme=${loaded}${window.location.hash}`)
  const latest = useRef({ onPalette, onRelated, theme })
  latest.current = { onPalette, onRelated, theme }

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "atlas:theme", theme }, "*")
  }, [theme])

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
      } else if (msg.type === "atlas:key") latest.current.onPalette()
      else if (msg.type === "atlas:hash" && typeof msg.hash === "string") window.history.replaceState(window.history.state, "", msg.hash || window.location.pathname + window.location.search)
      else if (msg.type === "atlas:ready" && Array.isArray(msg.related)) {
        latest.current.onRelated(msg.related.filter((r) => typeof r?.href === "string" && /^(\/[^/]|https?:)/.test(r.href)).map((r) => ({ text: String(r.text ?? ""), href: r.href })))
        // The URL carried the theme; resend only one changed while the doc loaded, so a doc's own toggle stays put.
        if (latest.current.theme !== loaded) frame.current?.contentWindow?.postMessage({ type: "atlas:theme", theme: latest.current.theme }, "*")
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [router, loaded])

  return (
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
  )
}
