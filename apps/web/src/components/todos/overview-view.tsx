import { Link } from "@tanstack/react-router"
import { BoxIcon } from "lucide-react"
import { useMemo } from "react"
import { cn } from "cn"
import { ago, exact } from "@/lib/format"
import { DONE_DAYS, rowKey, type Item } from "@/lib/todos"
import { GroupDot } from "./filters"
import { groupColor } from "./group-color"
import { PriorityIcon, StatusIcon } from "./icons"
import { plainTitle, RichTitle } from "./rich-title"

type Counts = { todo: number; doing: number; done: number }

const count = (items: Item[]): Counts => {
  const c = { todo: 0, doing: 0, done: 0 }
  for (const i of items) c[i.status]++
  return c
}

function groupBy<K>(items: Item[], key: (i: Item) => K): [K, Item[]][] {
  const m = new Map<K, Item[]>()
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i])
  return [...m]
}

const recent = (i: Item, now: number) => i.status === "done" && !!i.done_at && now - Date.parse(i.done_at) <= DONE_DAYS * 864e5
const SHOWN = 5
const card = "rounded-xl border bg-card transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
const link = "rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** Done, doing and todo as one bar. The numbers beside it carry the same facts for screen readers. */
function Bar({ c, className }: { c: Counts; className?: string }) {
  const total = c.todo + c.doing + c.done
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`
  return (
    <div aria-hidden className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div className="bg-done" style={{ width: pct(c.done) }} />
      <div className="bg-doing" style={{ width: pct(c.doing) }} />
    </div>
  )
}

function Numbers({ c }: { c: Counts }) {
  return (
    <span className="flex items-center justify-end gap-3 text-xs text-muted-foreground tabular-nums">
      {(["todo", "doing", "done"] as const).map((s) => (
        <span key={s} className="flex items-center gap-1">
          <StatusIcon status={s} className="size-3" />
          <span data-count={s}>{c[s]}</span>
          <span className="sr-only">{s}</span>
        </span>
      ))}
    </span>
  )
}

/** Where each repo and group stands: counts by status, what is in progress, and what finished lately. */
export function OverviewView({ items, onOpen }: { items: Item[]; onOpen: (id: number) => void }) {
  const now = Date.now()
  const repos = useMemo(() => {
    const now = Date.now()
    return groupBy(items, (i) => i.repo_name)
      .map(([name, list]) => {
        const groups = groupBy(list, (i) => i.group_id)
          .map(([id, gi]) => ({ id, group: gi[0]!.group_name, c: count(gi) }))
          .sort((a, b) => (a.group === null ? 1 : 0) - (b.group === null ? 1 : 0) || b.c.todo + b.c.doing - (a.c.todo + a.c.doing))
        return { name, c: count(list), groups, doing: list.filter((i) => i.status === "doing"), finished: list.filter((i) => recent(i, now)).sort((a, b) => b.done_at!.localeCompare(a.done_at!)) }
      })
      .sort((a, b) => b.c.todo + b.c.doing - (a.c.todo + a.c.doing))
  }, [items])

  const total = count(items)
  const inbox = items.filter((i) => i.priority === null && i.status !== "done").length
  const finished = items.filter((i) => recent(i, now)).length
  // Each number opens the items behind it, keeping the filters already set.
  const stats = [
    { label: "Open", value: total.todo + total.doing, view: "list" as const, status: "todo,doing" },
    { label: "Doing", value: total.doing, view: "list" as const, status: "doing" },
    { label: "In Inbox", value: inbox, view: "triage" as const, status: undefined },
    { label: `Done in ${DONE_DAYS} days`, value: finished, view: "list" as const, status: "done" },
  ]

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
      <nav aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to="/todos" search={(q) => ({ ...q, view: s.view, status: s.status })} className={cn(card, "flex flex-col px-4 py-3")}>
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{s.value}</span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2">
        {repos.map((r) => (
          <section key={r.name} data-repo={r.name} aria-labelledby={`repo-${r.name}`} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`repo-${r.name}`} className="font-medium">
                  <Link to="/todos" search={(q) => ({ ...q, view: undefined, repo: r.name, group: undefined })} className={cn(link, "flex items-center gap-2")}>
                    <BoxIcon className="size-4 text-muted-foreground" aria-hidden />
                    {r.name}
                  </Link>
                </h2>
                <Numbers c={r.c} />
              </div>
              <Bar c={r.c} />
            </header>

            <ul className="flex flex-col" aria-label={`Groups in ${r.name}`}>
              {r.groups.map((g) => (
                <li key={g.id ?? "none"} className="border-t first:border-t-0">
                  <Link
                    to="/todos"
                    search={(q) => ({ ...q, view: undefined, repo: r.name, group: String(g.id ?? "none") })}
                    className="-mx-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_4rem_8.5rem]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <GroupDot color={g.group ? groupColor(g.group) : undefined} />
                      <span className={cn("truncate", !g.group && "text-muted-foreground")}>{g.group ? plainTitle(g.group) : "No group"}</span>
                    </span>
                    <Bar c={g.c} className="max-sm:hidden" />
                    <Numbers c={g.c} />
                  </Link>
                </li>
              ))}
            </ul>

            <ItemList title="In progress" items={r.doing} repo={r.name} status="doing" onOpen={onOpen} when={(i) => ago(i.updated_at)} />
            <ItemList title={`Finished in the last ${DONE_DAYS} days`} items={r.finished} repo={r.name} status="done" onOpen={onOpen} when={(i) => ago(i.done_at!)} />
          </section>
        ))}
      </div>
    </div>
  )
}

function ItemList({ title, items, repo, status, onOpen, when }: { title: string; items: Item[]; repo: string; status: "doing" | "done"; onOpen: (id: number) => void; when: (i: Item) => string }) {
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">
        {title} <span className="tabular-nums">({items.length})</span>
      </h3>
      <ul className="flex flex-col">
        {items.slice(0, SHOWN).map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onOpen(i.id)} className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <PriorityIcon row={rowKey(i.priority)} />
              <span className="font-mono text-xs text-muted-foreground tabular-nums">#{i.id}</span>
              <span className="min-w-0 flex-1 truncate">
                <RichTitle text={i.title} />
              </span>
              <span className="shrink-0 text-xs text-muted-foreground" title={exact(status === "done" ? i.done_at! : i.updated_at)}>
                {when(i)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > SHOWN && (
        <Link to="/todos" search={(q) => ({ ...q, view: "list", repo, group: undefined, status })} className="self-start px-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          All {items.length} in the List
        </Link>
      )}
    </div>
  )
}
