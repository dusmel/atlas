import { PRIORITIES, rankBetween, STATUSES, type Priority, type Status } from "@atlas/todos"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Item } from "@/server/todos"
import { api, ApiError, send } from "./api"

export type { Item, Priority, Status }
export { PRIORITIES, STATUSES }

/** A board row: a priority, or null for Inbox. */
export type Row = Priority | null
export const ROWS: Row[] = [null, ...PRIORITIES]
export const rowKey = (p: Row) => p ?? "inbox"
export const rowLabel = (p: Row) => p ?? "Inbox"
export const PRIORITY_NAME: Record<string, string> = { P0: "Urgent", P1: "High", P2: "Medium", P3: "Low" }
export const STATUS_LABEL: Record<Status, string> = { todo: "Todo", doing: "Doing", done: "Done" }

export type Group = { id: number; repo_id: string; repo_name: string; name: string; doc_path: string | null; open: number }
export type Repo = { id: string; name: string; open: number }
export type ItemEvent = { id: number; at: string; actor: string; author: string | null; action: string; data: Record<string, unknown> }
export type ItemDetail = { item: Item; children: Item[]; group: { name: string; doc_path: string | null } | null; events: ItemEvent[] }

const ITEMS = ["items"]

// The whole board is about 400 items, so the browser holds all of them and filters locally.
export const useItems = () =>
  useQuery({ queryKey: ITEMS, queryFn: () => api<Item[]>("/todos?status=todo,doing,done"), refetchInterval: 15_000, refetchOnWindowFocus: true })
export const useRepos = () => useQuery({ queryKey: ["repos"], queryFn: () => api<Repo[]>("/repos"), staleTime: 60_000 })
export const useGroups = () => useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/groups"), staleTime: 60_000 })
export const useItemDetail = (id: number | null) =>
  useQuery({ queryKey: ["item", id], queryFn: () => api<ItemDetail>(`/todos/${id}`), enabled: id !== null })

export const byRank = (a: Item, b: Item) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id - b.id)
export const laneOf = (items: Item[], priority: Row, status: Status, except?: number) =>
  items.filter((i) => i.priority === priority && i.status === status && i.id !== except).sort(byRank)

// ── filters ──────────────────────────────────────────────────────────────────

export type Filters = { repo?: string[]; group?: (number | "none")[]; priority?: string[]; status?: string[]; by?: string[]; q?: string; done?: "all" }
export type Facet = "repo" | "group" | "priority" | "status" | "by"
export const FACETS: Facet[] = ["repo", "group", "priority", "status", "by"]

const NOT_AGENT = new Set(["me", "script", "import"])
export const authorOf = (i: Item) => i.created_by ?? "unknown"
export const isAgent = (author: string) => author !== "unknown" && !NOT_AGENT.has(author)

/** The value an item has for a facet, as the filter stores it. */
export function facetValue(i: Item, facet: Facet): string {
  if (facet === "repo") return i.repo_name
  if (facet === "group") return String(i.group_id ?? "none")
  if (facet === "priority") return rowKey(i.priority)
  if (facet === "status") return i.status
  return authorOf(i)
}

function facetMatches(i: Item, facet: Facet, wanted: (string | number)[]): boolean {
  if (facet === "by") return wanted.some((w) => (w === "agent" ? isAgent(authorOf(i)) : w === authorOf(i)))
  return wanted.map(String).includes(facetValue(i, facet))
}

const DONE_DAYS = 14

export function matches(i: Item, f: Filters, skip?: Facet, now = Date.now()): boolean {
  for (const facet of FACETS) {
    const wanted = f[facet]
    if (facet !== skip && wanted?.length && !facetMatches(i, facet, wanted)) return false
  }
  if (f.q) {
    const q = f.q.trim().toLowerCase()
    const id = q.match(/^#?(\d+)$/)?.[1]
    if (id ? i.id !== Number(id) : !(i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q))) return false
  }
  if (f.done !== "all" && i.status === "done" && i.done_at && now - Date.parse(i.done_at) > DONE_DAYS * 864e5) return false
  return true
}

/** How many items each value of a facet would show, given the other filters. */
export function facetCounts(items: Item[], f: Filters, facet: Facet): Map<string, number> {
  const counts = new Map<string, number>()
  for (const i of items) {
    if (!matches(i, f, facet)) continue
    const v = facetValue(i, facet)
    counts.set(v, (counts.get(v) ?? 0) + 1)
    if (facet === "by" && isAgent(v)) counts.set("agent", (counts.get("agent") ?? 0) + 1)
  }
  return counts
}

export const activeCount = (f: Filters) => FACETS.reduce((n, k) => n + (f[k]?.length ?? 0), 0) + (f.q ? 1 : 0)

// ── changes ──────────────────────────────────────────────────────────────────

const upsert = (items: Item[] | undefined, item: Item) => {
  const rest = (items ?? []).filter((i) => i.id !== item.id)
  return item.archived_at ? rest : [...rest, item]
}
const replace = (items: Item[], id: number, patch: Partial<Item>) => items.map((i) => (i.id === id ? { ...i, ...patch } : i))

type Change = { apply: (items: Item[]) => Item[]; request: () => Promise<Item>; done?: (item: Item) => void; failed?: (latest?: Item) => void }

function useChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Change) => c.request(),
    onMutate: async (c) => {
      await qc.cancelQueries({ queryKey: ITEMS })
      const before = qc.getQueryData<Item[]>(ITEMS)
      if (before) qc.setQueryData(ITEMS, c.apply(before))
      return { before }
    },
    onError: (err, c, ctx) => {
      if (ctx?.before) qc.setQueryData(ITEMS, ctx.before)
      const latest = err instanceof ApiError ? (err.body as { item?: Item } | null)?.item : undefined
      if (latest) qc.setQueryData<Item[]>(ITEMS, (xs) => upsert(xs, latest))
      if (err instanceof ApiError && err.status === 409) toast.error(`#${latest?.id ?? ""} changed somewhere else`, { description: "Your text is still in the editor. Save again to replace the other change." })
      else toast.error(err.message)
      c.failed?.(latest)
    },
    onSuccess: (item, c) => {
      qc.setQueryData<Item[]>(ITEMS, (xs) => upsert(xs, item))
      void qc.invalidateQueries({ queryKey: ["item", item.id] })
      c.done?.(item)
    },
  })
}

export type Place = { priority: Row; status: Status; before?: number; after?: number }
export type Fields = { title?: string; body?: string; priority?: Row; status?: Status; group?: number | null; parent?: number | null }

let lastArchived: Item | null = null

/** Every change the board makes, each shown at once and rolled back if the server says no. */
export function useActions() {
  const qc = useQueryClient()
  const change = useChange()
  const items = () => qc.getQueryData<Item[]>(ITEMS) ?? []
  const groups = () => qc.getQueryData<Group[]>(["groups"]) ?? []
  const stamp = () => new Date().toISOString()

  // The rank the server will give a lane change to the bottom, so the card lands where it will stay.
  const bottomRank = (priority: Row, status: Status, id: number) => rankBetween(laneOf(items(), priority, status, id).at(-1)?.rank ?? null, null)

  const move = (item: Item, to: Place) => {
    const lane = laneOf(items(), to.priority, to.status, item.id)
    let rank: string
    let where: Record<string, unknown>
    if (to.before !== undefined) {
      const at = lane.findIndex((i) => i.id === to.before)
      rank = rankBetween(lane[at - 1]?.rank ?? null, lane[at]!.rank)
      where = { before: to.before }
    } else if (to.after !== undefined) {
      const at = lane.findIndex((i) => i.id === to.after)
      rank = rankBetween(lane[at]!.rank, lane[at + 1]?.rank ?? null)
      where = { after: to.after }
    } else {
      rank = rankBetween(lane.at(-1)?.rank ?? null, null)
      where = { bottom: true }
    }
    const done_at = to.status === "done" ? (item.done_at ?? stamp()) : null
    change.mutate({
      apply: (xs) => replace(xs, item.id, { priority: to.priority, status: to.status, rank, done_at }),
      request: () => api<Item>(`/todos/${item.id}/move`, send("POST", { priority: to.priority, status: to.status, ...where })),
    })
  }

  /** `base` is the updated_at the edit started from; the server answers 409 if the item changed since. */
  const update = (item: Item, fields: Fields, opts: { base?: string; done?: (item: Item) => void; failed?: (latest?: Item) => void } = {}) => {
    const patch: Partial<Item> = {}
    if (fields.title !== undefined) patch.title = fields.title
    if (fields.body !== undefined) patch.body = fields.body
    if (fields.parent !== undefined) patch.parent_id = fields.parent
    if (fields.group !== undefined) {
      const g = groups().find((x) => x.id === fields.group)
      Object.assign(patch, { group_id: fields.group, group_name: g?.name ?? null, group_doc: g?.doc_path ?? null })
    }
    const priority = fields.priority === undefined ? item.priority : fields.priority
    const status = fields.status ?? item.status
    if (priority !== item.priority || status !== item.status) {
      Object.assign(patch, { priority, status, rank: bottomRank(priority, status, item.id) })
      patch.done_at = status === "done" ? (item.done_at ?? stamp()) : null
    }
    change.mutate({
      apply: (xs) => replace(xs, item.id, patch),
      request: () => api<Item>(`/todos/${item.id}`, send("PATCH", { ...fields, if_updated_at: opts.base ?? item.updated_at })),
      done: opts.done,
      failed: opts.failed,
    })
  }

  const unarchive = (id: number) =>
    change.mutate({ apply: (xs) => xs, request: () => api<Item>(`/todos/${id}/unarchive`, send("POST")), done: (i) => toast.success(`Restored #${i.id}`) })

  const archive = (item: Item) => {
    lastArchived = item
    change.mutate({
      apply: (xs) => xs.filter((i) => i.id !== item.id),
      request: () => api<Item>(`/todos/${item.id}/archive`, send("POST")),
      done: () => toast(`Archived #${item.id}`, { description: item.title, duration: 5000, action: { label: "Undo", onClick: () => unarchive(item.id) } }),
    })
  }

  const undoArchive = () => {
    if (!lastArchived) return toast("Nothing to undo")
    unarchive(lastArchived.id)
    lastArchived = null
  }

  const create = (input: { repo: string; title: string; priority: Row; status?: Status; group?: number | null }, done?: (item: Item) => void) =>
    change.mutate({
      apply: (xs) => xs,
      request: () => api<Item>("/todos", send("POST", { ...input, group: input.group ?? undefined })),
      done: (item) => {
        toast.success(`Added #${item.id}`, { description: item.title })
        done?.(item)
      },
    })

  return { move, update, archive, unarchive, undoArchive, create, pending: change.isPending }
}
