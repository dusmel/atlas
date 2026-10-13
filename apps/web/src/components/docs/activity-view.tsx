import { useQuery } from "@tanstack/react-query"
import { BoxIcon, FileMinusIcon, FilePenIcon, FilePlusIcon } from "lucide-react"
import { useMemo } from "react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { repoColor } from "@/lib/doc-colors"
import type { DocEvent } from "@/lib/docs"
import { exact } from "@/lib/format"
import { CopyPath } from "./hits"

const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" })
const full = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

function dayLabel(at: string, now = new Date()): string {
  const d = new Date(at)
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return (d.getFullYear() === now.getFullYear() ? weekday : full).format(d)
}

const CHANGE = {
  added: { icon: FilePlusIcon, verb: "Added" },
  changed: { icon: FilePenIcon, verb: "Edited" },
  removed: { icon: FileMinusIcon, verb: "Removed" },
} as const

/** Docs added, edited and removed, newest first, grouped by day. The repo, folder and changed filters apply. */
export function DocActivity({ params }: { params: URLSearchParams }) {
  const q = useQuery({ queryKey: ["doc-activity", params.toString()], queryFn: () => api<{ events: DocEvent[] }>(`/docs/activity?${params}`) })
  const days = useMemo(() => {
    const out: { day: string; events: DocEvent[] }[] = []
    for (const e of q.data?.events ?? []) {
      const day = dayLabel(e.at)
      if (out.at(-1)?.day !== day) out.push({ day, events: [] })
      out.at(-1)!.events.push(e)
    }
    return out
  }, [q.data])

  if (q.isPending)
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading activity">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-12" />
        ))}
      </div>
    )
  if (q.isError)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Activity didn't load</EmptyTitle>
          <EmptyDescription>{q.error.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => q.refetch()}>Try again</Button>
        </EmptyContent>
      </Empty>
    )
  if (!days.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No doc changes yet</EmptyTitle>
          <EmptyDescription>Changes show here from the first one the server sees. Edit a doc, or widen the filters.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )

  return (
    <div className="flex flex-col gap-5">
      {days.map((d) => (
        <section key={d.day} aria-labelledby={`day-${d.day}`} className="flex flex-col">
          <h2 id={`day-${d.day}`} className="sticky top-14 z-10 bg-background py-1.5 text-xs font-medium text-muted-foreground">
            {d.day}
          </h2>
          <ol className="flex flex-col">
            {d.events.map((e) => {
              const { icon: Icon, verb } = CHANGE[e.change]
              return (
                <li key={e.id} data-event={e.change} className="group/hit flex items-start gap-3 border-b py-2.5 last:border-b-0">
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", e.change === "removed" && "bg-destructive/10 text-destructive")}>
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm">
                      <span className="sr-only">{verb} </span>
                      <span className={cn("font-medium", e.change === "removed" && "text-muted-foreground line-through decoration-muted-foreground/50")}>{e.title}</span>
                      {e.kinds.length > 1 && <span className="text-muted-foreground"> (md and html)</span>}
                    </p>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{verb}</span>
                      <span className="flex items-center gap-1" translate="no">
                        <BoxIcon aria-hidden className="size-3" style={{ color: repoColor(e.repo) }} />
                        {e.repo}
                      </span>
                      <CopyPath doc={e} />
                    </div>
                  </div>
                  <time dateTime={e.at} title={exact(e.at)} className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">
                    {time.format(new Date(e.at))}
                  </time>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {(q.data?.events.length ?? 0) >= 100 && <p className="text-center text-xs text-muted-foreground">Showing the latest 100 changes. Narrow the filters to see older ones.</p>}
    </div>
  )
}
