import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useHotkeys, type Hotkeys } from "@/hooks/use-hotkeys"
import { ago, exact } from "@/lib/format"
import { authorOf, byRank, ROWS, rowKey, rowLabel, STATUS_LABEL, STATUSES, useActions, type Group, type Item, type Row, type Status } from "@/lib/todos"
import { AuthorAvatar } from "./author-avatar"
import { CopyId } from "./copy-id"
import { GroupDot } from "./filters"
import { groupColor } from "./group-color"
import { PriorityIcon, StatusIcon } from "./icons"
import { plainTitle, RichTitle } from "./rich-title"

type SortKey = "priority" | "id" | "title" | "status" | "repo" | "group" | "by" | "updated"
const NEWEST_FIRST = new Set<SortKey>(["id", "updated"])

const rowOrder = (i: Item) => ROWS.indexOf(i.priority)
const statusOrder = (i: Item) => STATUSES.indexOf(i.status)
const text = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" })

// The board's order is the default: priority, then lane, then rank.
const COMPARE: Record<SortKey, (a: Item, b: Item) => number> = {
  priority: (a, b) => rowOrder(a) - rowOrder(b) || statusOrder(a) - statusOrder(b) || byRank(a, b),
  id: (a, b) => a.id - b.id,
  title: (a, b) => text(plainTitle(a.title), plainTitle(b.title)),
  status: (a, b) => statusOrder(a) - statusOrder(b) || rowOrder(a) - rowOrder(b) || byRank(a, b),
  repo: (a, b) => text(a.repo_name, b.repo_name) || COMPARE.priority(a, b),
  group: (a, b) => (a.group_name === null ? 1 : 0) - (b.group_name === null ? 1 : 0) || text(a.group_name ?? "", b.group_name ?? "") || COMPARE.priority(a, b),
  by: (a, b) => text(authorOf(a), authorOf(b)) || COMPARE.priority(a, b),
  updated: (a, b) => a.updated_at.localeCompare(b.updated_at) || a.id - b.id,
}

/** `sort` is a column key, with a leading "-" for descending. */
function parseSort(sort?: string): { key: SortKey; desc: boolean } {
  const desc = !!sort?.startsWith("-")
  const key = (sort?.replace(/^-/, "") ?? "priority") as SortKey
  return key in COMPARE ? { key, desc } : { key: "priority", desc: false }
}

type Props = {
  items: Item[]
  groups: Group[]
  showRepo: boolean
  sort?: string
  onSort: (sort: string | undefined) => void
  cursor: number | null
  onCursor: (id: number | null) => void
  onOpen: (id: number) => void
  onMove: (id: number) => void
  keys: Hotkeys
}

const focusRow = (id: number) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus())

export function ListView({ items, groups, showRepo, sort, onSort, cursor, onCursor, onOpen, onMove, keys }: Props) {
  const actions = useActions()
  const { key, desc } = parseSort(sort)
  const rows = useMemo(() => {
    const sorted = [...items].sort(COMPARE[key])
    return desc ? sorted.reverse() : sorted
  }, [items, key, desc])

  const [picked, setPicked] = useState<Set<number>>(() => new Set())
  const anchor = useRef<number | null>(null)
  const selection = useMemo(() => rows.filter((i) => picked.has(i.id)), [rows, picked])
  const current = rows.find((i) => i.id === cursor) ?? null
  // Keys act on the ticked rows, or on the row under the cursor when none is ticked.
  const targets = selection.length ? selection : current ? [current] : []

  const pick = (id: number, range: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev)
      const from = rows.findIndex((i) => i.id === anchor.current)
      const to = rows.findIndex((i) => i.id === id)
      if (range && from >= 0 && to >= 0) {
        const on = !prev.has(id)
        for (const i of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) on ? next.add(i.id) : next.delete(i.id)
      } else if (!next.delete(id)) next.add(id)
      anchor.current = id
      return next
    })
  const clear = () => setPicked(new Set())
  const allPicked = rows.length > 0 && selection.length === rows.length

  const go = (dir: 1 | -1) => {
    const at = rows.findIndex((i) => i.id === cursor)
    const next = rows[at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + dir))]
    if (next) {
      onCursor(next.id)
      focusRow(next.id)
    }
  }
  const setPriority = (p: Row) => targets.length && actions.updateMany(targets, { priority: p })
  const archive = () => {
    if (!targets.length) return
    const after = rows.find((i, n) => n > rows.indexOf(targets.at(-1)!) && !targets.includes(i))
    actions.archive(targets)
    clear()
    onCursor(after?.id ?? null)
    if (after) focusRow(after.id)
  }

  useHotkeys({
    ...keys,
    j: () => go(1),
    k: () => go(-1),
    x: () => current && pick(current.id, false),
    Enter: () => current && onOpen(current.id),
    "0": () => setPriority("P0"),
    "1": () => setPriority("P1"),
    "2": () => setPriority("P2"),
    "3": () => setPriority("P3"),
    i: () => setPriority(null),
    s: () => targets.forEach((i) => actions.update(i, { status: STATUSES[(statusOrder(i) + 1) % STATUSES.length] })),
    m: () => current && onMove(current.id),
    a: archive,
    z: () => actions.undoArchive(),
    Escape: () => {
      if (picked.size) return clear()
      onCursor(null)
      ;(document.activeElement as HTMLElement | null)?.blur()
    },
  })

  // Ticked rows that a filter hides stay hidden from bulk actions, so drop them.
  useEffect(() => {
    if (selection.length !== picked.size) setPicked(new Set(selection.map((i) => i.id)))
  }, [selection, picked.size])

  const header = (k: SortKey, label: string, className?: string) => {
    const on = key === k
    return (
      <th scope="col" aria-sort={on ? (desc ? "descending" : "ascending") : undefined} className={cn("h-10 px-2 text-left font-medium", className)}>
        <button
          type="button"
          onClick={() => onSort(on ? (desc ? k : `-${k}`) : NEWEST_FIRST.has(k) ? `-${k}` : k === "priority" ? undefined : k)}
          className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", on && "text-foreground")}
        >
          {label}
          {on && (desc ? <ArrowDownIcon className="size-3" aria-hidden /> : <ArrowUpIcon className="size-3" aria-hidden />)}
        </button>
      </th>
    )
  }

  return (
    <div className="px-4 pb-24 sm:px-6">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Items, sorted by {key}{desc ? ", descending" : ""}. Tick rows to change several at once.</caption>
        <thead className="sticky top-14 z-10 bg-background text-xs text-muted-foreground [&_th]:border-b">
          <tr>
            <th scope="col" className="w-9 px-2 text-left">
              <input
                type="checkbox"
                aria-label={allPicked ? "Untick all rows" : "Tick all rows"}
                checked={allPicked}
                ref={(el) => {
                  if (el) el.indeterminate = selection.length > 0 && !allPicked
                }}
                onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((i) => i.id)))}
                className="size-4 accent-primary"
              />
            </th>
            {header("priority", "Pri", "w-12")}
            {header("id", "#", "hidden w-24 md:table-cell")}
            {header("title", "Title")}
            {showRepo && header("repo", "Repo", "hidden w-28 md:table-cell")}
            {header("group", "Group", "hidden w-48 lg:table-cell")}
            {header("by", "By", "hidden w-14 md:table-cell")}
            {header("updated", "Changed", "hidden w-28 sm:table-cell")}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr
              key={i.id}
              data-row={i.id}
              tabIndex={-1}
              aria-selected={picked.has(i.id)}
              onClick={() => {
                onCursor(i.id)
                onOpen(i.id)
              }}
              className={cn(
                "group/item cursor-pointer outline-none [&>td]:border-b [&>td]:py-2 hover:bg-accent/40 focus-visible:bg-accent/60",
                picked.has(i.id) && "bg-primary/8",
                cursor === i.id && "[&>td:first-child]:shadow-[inset_2px_0_0_var(--ring)]",
              )}
            >
              <td className="px-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Tick #${i.id}`}
                  checked={picked.has(i.id)}
                  readOnly
                  onClick={(e) => pick(i.id, e.shiftKey)}
                  className="size-4 accent-primary"
                />
              </td>
              <td className="px-2">
                <PriorityIcon row={rowKey(i.priority)} />
                <span className="sr-only">{rowLabel(i.priority)}</span>
              </td>
              <td className="hidden px-1 text-xs text-muted-foreground md:table-cell">
                <CopyId id={i.id} link="hover" />
              </td>
              <td className="px-2">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusIcon status={i.status} />
                  <span className="sr-only">{STATUS_LABEL[i.status]}</span>
                  <span className={cn("min-w-0 truncate", i.status === "done" && "text-muted-foreground")}>
                    <RichTitle text={i.title} />
                  </span>
                </div>
                <div className="mt-0.5 flex min-w-0 gap-1.5 pl-5.5 text-xs text-muted-foreground md:hidden">
                  <CopyId id={i.id} className="-my-0.5 -ml-1" />
                  <span>·</span>
                  <span className="truncate">{[i.repo_name, i.group_name && plainTitle(i.group_name)].filter(Boolean).join(" · ")}</span>
                </div>
              </td>
              {showRepo && <td className="hidden truncate px-2 text-muted-foreground md:table-cell">{i.repo_name}</td>}
              <td className="hidden px-2 lg:table-cell">
                {i.group_name && (
                  <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <GroupDot color={groupColor(i.group_name)} />
                    <span className="truncate">{plainTitle(i.group_name)}</span>
                  </span>
                )}
              </td>
              <td className="hidden px-2 md:table-cell">
                <AuthorAvatar author={authorOf(i)} />
              </td>
              <td className="hidden px-2 text-xs text-muted-foreground tabular-nums sm:table-cell" title={exact(i.updated_at)}>
                {ago(i.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selection.length > 0 && <BulkBar items={selection} groups={groups} onArchive={archive} onClear={clear} />}
    </div>
  )
}

function BulkBar({ items, groups, onArchive, onClear }: { items: Item[]; groups: Group[]; onArchive: () => void; onClear: () => void }) {
  const actions = useActions()
  const repos = new Set(items.map((i) => i.repo_id))
  // A group belongs to one repo, so a mixed selection can't share one.
  const repoGroups = repos.size === 1 ? groups.filter((g) => repos.has(g.repo_id)) : []
  const set = (fields: Parameters<typeof actions.updateMany>[1]) => actions.updateMany(items, fields)
  return (
    <div
      role="toolbar"
      aria-label={`${items.length} selected`}
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-fit flex-wrap items-center gap-1.5 rounded-xl border bg-popover p-1.5 pl-3 text-sm shadow-lg"
    >
      <span className="mr-1 font-medium tabular-nums">{items.length} selected</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Priority
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ROWS.map((r) => (
            <DropdownMenuItem key={rowKey(r)} onSelect={() => set({ priority: r })}>
              <PriorityIcon row={rowKey(r)} />
              {rowLabel(r)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {STATUSES.map((s: Status) => (
            <DropdownMenuItem key={s} onSelect={() => set({ status: s })}>
              <StatusIcon status={s} />
              {STATUS_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={repos.size !== 1} title={repos.size !== 1 ? "Tick items from one repo to set their group" : undefined}>
            Group
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {repoGroups.map((g) => (
            <DropdownMenuItem key={g.id} onSelect={() => set({ group: g.id })}>
              <GroupDot color={groupColor(g.name)} />
              {plainTitle(g.name)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => set({ group: null })}>
            <GroupDot />
            No group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={onArchive}>
        <ArchiveIcon data-icon="inline-start" />
        Archive
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Untick all" onClick={onClear}>
        <XIcon />
      </Button>
    </div>
  )
}
