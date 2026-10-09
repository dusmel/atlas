import { BoxIcon } from "lucide-react"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { describe, exact } from "@/lib/format"
import { sinceMs, useEvents, type FeedEvent } from "@/lib/todos"
import { AuthorAvatar } from "./author-avatar"
import { CopyId } from "./copy-id"
import { plainTitle, RichTitle } from "./rich-title"

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

type Props = { repo?: string[]; by?: string[]; since?: string; otherFilters: boolean; onOpen: (id: number) => void }

/** Recent changes across every item, newest first. Only the repo and author filters apply here. */
export function ActivityView({ repo, by, since, otherFilters, onOpen }: Props) {
  const q = useEvents(repo, by)
  const window = sinceMs(since)
  const cutoff = window ? new Date(Date.now() - window).toISOString() : ""
  const loaded = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  // Events come newest first, so once the oldest loaded one is past the window there is nothing more to page.
  const more = q.hasNextPage && !(cutoff && (loaded.at(-1)?.at ?? "") < cutoff)
  const days = useMemo(() => {
    const out: { day: string; events: FeedEvent[] }[] = []
    for (const e of loaded) {
      if (e.at < cutoff) break
      const day = dayLabel(e.at)
      if (out.at(-1)?.day !== day) out.push({ day, events: [] })
      out.at(-1)!.events.push(e)
    }
    return out
  }, [loaded, cutoff])

  if (q.isPending)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6" aria-busy="true" aria-label="Loading activity">
        {[0, 1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-12" />
        ))}
      </div>
    )
  if (q.isError)
    return (
      <Empty className="mx-4 my-10 border sm:mx-6">
        <EmptyHeader>
          <EmptyTitle>Activity didn't load</EmptyTitle>
          <EmptyDescription>{q.error.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => q.refetch()}>Try again</Button>
        </EmptyContent>
      </Empty>
    )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-4 sm:px-6">
      {otherFilters && <p className="text-sm text-muted-foreground">Activity uses the repo, author and changed filters. The others apply to the item views.</p>}
      {days.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No changes yet.</p>}
      {days.map((d) => (
        <section key={d.day} aria-labelledby={`day-${d.day}`} className="flex flex-col gap-1">
          <h2 id={`day-${d.day}`} className="sticky top-14 z-10 bg-background py-1.5 text-xs font-medium text-muted-foreground">
            {d.day}
          </h2>
          <ol className="flex flex-col">
            {d.events.map((e) => {
              const who = e.author ?? e.actor
              return (
                <li key={e.id} data-event={e.id} className="flex items-start gap-3 border-b py-2.5 last:border-b-0">
                  <AuthorAvatar author={who} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm">
                      <span className="font-medium">{who}</span> <span className="text-muted-foreground">{describe(e)}</span>
                    </p>
                    <div className="flex max-w-full min-w-0 items-center gap-1 self-start">
                      <CopyId id={e.item_id} className="-ml-1 text-xs text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => onOpen(e.item_id)}
                        aria-label={`Open #${e.item_id} ${plainTitle(e.title)}`}
                        className="flex min-w-0 items-center gap-2 rounded text-left text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span className="min-w-0 truncate">
                          <RichTitle text={e.title} />
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground max-sm:hidden">
                          <BoxIcon className="size-3" aria-hidden />
                          {e.repo_name}
                        </span>
                      </button>
                    </div>
                  </div>
                  <time dateTime={e.at} title={exact(e.at)} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {time.format(new Date(e.at))}
                  </time>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {more && (
        <Button variant="outline" className="self-center" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {q.isFetchingNextPage ? "Loading…" : "Show older changes"}
        </Button>
      )}
    </div>
  )
}
