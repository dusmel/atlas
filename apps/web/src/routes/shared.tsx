import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { GlobeIcon, LinkIcon } from "lucide-react"
import { toast } from "sonner"
import { AppHeader } from "@/components/app-header"
import { shareUrl } from "@/components/docs/share-button"
import { copy } from "@/components/todos/copy-id"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { api, send } from "@/lib/api"
import { docHref, type Share } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

export const Route = createFileRoute("/shared")({ component: Shared })

type Row = Share & { title: string | null }

function Shared() {
  const qc = useQueryClient()
  const shares = useQuery({ queryKey: ["shares"], queryFn: () => api<{ shares: Row[] }>("/shares") })
  const revoke = useMutation({
    mutationFn: (s: Row) => api(`/shares/${encodeURIComponent(s.token)}`, send("DELETE")),
    onSuccess: (_, s) => {
      toast.success("Link revoked", { description: `${s.repo_id}/${s.path} is private again.` })
      void qc.invalidateQueries({ queryKey: ["shares"] })
      void qc.invalidateQueries({ queryKey: ["doc", s.repo_id, s.path] })
    },
    onError: (e) => toast.error("Could not revoke the link", { description: (e as Error).message }),
  })
  const rows = shares.data?.shares ?? []
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium">Shared</h1>
          <p className="text-sm text-muted-foreground">Docs anyone with the link can read, without logging in. A shared doc runs no scripts. Revoking a link turns it into a 404.</p>
        </div>
        {shares.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : !rows.length ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GlobeIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing is public</EmptyTitle>
              <EmptyDescription>Open a doc and press Make public to share it.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul aria-label="Shared docs" className="flex flex-col divide-y rounded-lg border">
            {rows.map((s) => (
              <li key={s.token} data-share={s.token} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <a href={docHref({ repo: s.repo_id, path: s.path })} className="truncate font-medium hover:underline">
                    {s.title ?? `${s.repo_id}/${s.path}`}
                  </a>
                  <p className="truncate text-xs text-muted-foreground">
                    <span translate="no">
                      {s.repo_id}/{s.path}
                    </span>
                    {" · shared "}
                    <time dateTime={s.created_at} title={exact(s.created_at)}>
                      {ago(s.created_at)}
                    </time>
                    {s.title === null && " · not in the served copy"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void copy(shareUrl(s), "Public link copied")}>
                    <LinkIcon data-icon="inline-start" />
                    Copy link
                  </Button>
                  <Button variant="destructive" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(s)}>
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
