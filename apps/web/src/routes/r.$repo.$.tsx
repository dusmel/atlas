import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { FileQuestionIcon } from "lucide-react"
import { useEffect } from "react"
import { AppHeader } from "@/components/app-header"
import { CopyPath, TodosLink } from "@/components/docs/hits"
import { ShareButton } from "@/components/docs/share-button"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { api, ApiError } from "@/lib/api"
import { docHref, type DocPage } from "@/lib/docs"
import { ago, exact } from "@/lib/format"
import { getIndex } from "@/server/docs"
import { CSP_DOC, docFile, fileResponse } from "@/server/doc-files"

// Markdown renders in the app below. Everything else, html above all, is sent as is under the
// sandbox CSP, so relative links between docs work because the URL keeps the store's paths.
export const Route = createFileRoute("/r/$repo/$")({
  server: {
    handlers: {
      GET: ({ params, request, next }) => {
        const path = params._splat ?? ""
        // When x.md and x.html both exist, the html is the doc (spec D25).
        const html = path.endsWith(".md") ? `${path.slice(0, -3)}.html` : null
        if (html && docFile(getIndex().root, params.repo, html)) return Response.redirect(new URL(docHref({ repo: params.repo, path: html }), request.url), 302)
        if (path.endsWith(".md")) return next()
        const file = docFile(getIndex().root, params.repo, path)
        if (!file) return new Response(`No doc ${params.repo}/${path}`, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
        return fileResponse(file, CSP_DOC)
      },
    },
  },
  component: MarkdownDoc,
})

function MarkdownDoc() {
  const { repo, _splat: path = "" } = Route.useParams()
  const doc = useQuery({
    queryKey: ["doc", repo, path],
    queryFn: () => api<DocPage>(`/docs/view?${new URLSearchParams({ repo, path })}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  })
  useEffect(() => {
    if (doc.data) document.title = `${doc.data.title} · Atlas`
  }, [doc.data])
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
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
          {doc.data && (
            <div className="ml-auto flex items-center gap-2">
              {doc.data.todos && <TodosLink todos={doc.data.todos} />}
              <ShareButton repo={repo} path={path} share={doc.data.share} />
            </div>
          )}
        </div>
        {doc.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : doc.error ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileQuestionIcon />
              </EmptyMedia>
              <EmptyTitle>{doc.error instanceof ApiError && doc.error.status === 404 ? "No doc here" : "Could not load the doc"}</EmptyTitle>
              <EmptyDescription>
                {doc.error instanceof ApiError && doc.error.status === 404 ? `${repo}/${path} is not in the server's copy of the docs. If it is new, MEGA may not have synced it yet.` : doc.error.message}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline">
                <Link to="/docs">Search the docs</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <article className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Saved <time dateTime={doc.data.mtime} title={exact(doc.data.mtime)}>{ago(doc.data.mtime)}</time>
            </p>
            {/* Rendered and cleaned with sanitize-html on the server (spec section 8). */}
            <div className="markdown doc text-[15px] leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: doc.data.html }} />
          </article>
        )}
      </main>
    </>
  )
}
