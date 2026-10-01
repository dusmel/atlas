import type { Database } from "bun:sqlite"
import {
  checkFile,
  checkGroup,
  checkParent,
  doneAt,
  parsePriority,
  parseStatus,
  parseTitle,
  rankBetween,
  report,
  type Priority,
  type Status,
} from "@atlas/todos"
import { now } from "./db"
import { HttpError } from "./http"

export type Item = {
  id: number
  repo_id: string
  repo_name: string
  group_id: number | null
  group_name: string | null
  parent_id: number | null
  section: string | null
  title: string
  body: string
  status: Status
  priority: Priority | null
  rank: string
  created_at: string
  updated_at: string
  done_at: string | null
  archived_at: string | null
  import_id: number | null
}

const SELECT = `SELECT items.*, repos.name AS repo_name, groups.name AS group_name
  FROM items JOIN repos ON repos.id = items.repo_id LEFT JOIN groups ON groups.id = items.group_id`
// Inbox first, then P0 to P3, then the board's lane order.
const ORDER = `ORDER BY items.priority IS NOT NULL, items.priority,
  CASE items.status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END, items.rank, items.id`

const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`)
const bad = (code: string, message: string) => new HttpError(400, code, message)

function itemRow(db: Database, id: number): Item {
  const item = db.query<Item, [number]>(`${SELECT} WHERE items.id = ?`).get(id)
  if (!item) throw notFound(`#${id}`)
  return item
}

function event(db: Database, itemId: number, actor: string, action: string, data: unknown): void {
  db.run("INSERT INTO events (item_id, actor, action, data, at) VALUES (?, ?, ?, ?, ?)", [itemId, actor, action, JSON.stringify(data), now()])
}

const toInt = (v: unknown, what: string): number => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw bad("bad_id", `${what} must be an item id`)
  return n
}

// ── repos and groups ─────────────────────────────────────────────────────────

// {id, name} from the CLI creates or renames the repo; a plain string must already exist.
export function resolveRepo(db: Database, value: unknown): string {
  if (value && typeof value === "object") {
    const { id, name } = value as Record<string, unknown>
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) throw bad("bad_repo", "repo needs an id and a name")
    db.run("INSERT INTO repos (id, name, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at WHERE name != excluded.name", [id, name, now()])
    return id
  }
  if (typeof value !== "string") throw bad("bad_repo", "repo is required")
  const row = db.query<{ id: string }, [string, string]>("SELECT id FROM repos WHERE id = ? OR name = ?").get(value, value)
  if (!row) throw bad("unknown_repo", `No repo ${value}`)
  return row.id
}

export function listRepos(db: Database) {
  return db
    .query(
      `SELECT repos.id, repos.name, repos.updated_at,
         count(items.id) FILTER (WHERE items.status != 'done' AND items.archived_at IS NULL) AS open
       FROM repos LEFT JOIN items ON items.repo_id = repos.id GROUP BY repos.id ORDER BY repos.name`,
    )
    .all()
}

type Group = { id: number; repo_id: string; name: string; doc_path: string | null; note: string; created_at: string }

// A group is named within its repo; numbers are ids.
function resolveGroup(db: Database, repoId: string, value: unknown): number | null {
  if (value === null) return null
  const row =
    typeof value === "number"
      ? db.query<Group, [number]>("SELECT * FROM groups WHERE id = ?").get(value)
      : typeof value === "string"
        ? db.query<Group, [string, string]>("SELECT * FROM groups WHERE repo_id = ? AND name = ?").get(repoId, value)
        : null
  if (!row) throw bad("unknown_group", `No group ${String(value)} in this repo. Create it with: atlas todo group add "${String(value)}"`)
  checkGroup({ repo_id: repoId }, row)
  return row.id
}

export function listGroups(db: Database, repo?: string) {
  const where = repo ? "WHERE groups.repo_id = ? OR repos.name = ?" : ""
  return db
    .query(
      `SELECT groups.*, repos.name AS repo_name,
         count(items.id) FILTER (WHERE items.status != 'done' AND items.archived_at IS NULL) AS open
       FROM groups JOIN repos ON repos.id = groups.repo_id LEFT JOIN items ON items.group_id = groups.id
       ${where} GROUP BY groups.id ORDER BY repos.name, groups.id`,
    )
    .all(...(repo ? [repo, repo] : []))
}

const optText = (v: unknown, what: string): string | null => {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") throw bad("bad_field", `${what} must be text`)
  return v
}

const groupName = (v: unknown): string => {
  const name = typeof v === "string" ? v.trim() : ""
  if (!name || name.length > 200) throw bad("bad_name", "Group name must be 1 to 200 characters")
  return name
}

export function createGroup(db: Database, input: Record<string, unknown>): Group {
  return db.transaction(() => {
    const repoId = resolveRepo(db, input.repo)
    const name = groupName(input.name)
    if (db.query("SELECT 1 FROM groups WHERE repo_id = ? AND name = ?").get(repoId, name)) throw new HttpError(409, "name_taken", `Group ${name} already exists`)
    return db
      .query<Group, [string, string, string | null, string, string]>("INSERT INTO groups (repo_id, name, doc_path, note, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *")
      .get(repoId, name, optText(input.doc_path, "doc_path"), optText(input.note, "note") ?? "", now())!
  })()
}

export function updateGroup(db: Database, id: number, input: Record<string, unknown>): Group {
  return db.transaction(() => {
    const group = db.query<Group, [number]>("SELECT * FROM groups WHERE id = ?").get(id)
    if (!group) throw notFound(`Group ${id}`)
    const name = input.name === undefined ? group.name : groupName(input.name)
    if (name !== group.name && db.query("SELECT 1 FROM groups WHERE repo_id = ? AND name = ?").get(group.repo_id, name)) {
      throw new HttpError(409, "name_taken", `Group ${name} already exists`)
    }
    const doc = input.doc_path === undefined ? group.doc_path : optText(input.doc_path, "doc_path")
    const note = input.note === undefined ? group.note : (optText(input.note, "note") ?? "")
    return db.query<Group, [string, string | null, string, number]>("UPDATE groups SET name = ?, doc_path = ?, note = ? WHERE id = ? RETURNING *").get(name, doc, note, id)!
  })()
}

// ── ranks ────────────────────────────────────────────────────────────────────

type Lane = { priority: Priority | null; status: Status }

// Only the server computes ranks. A lane spans every repo, like a board row and column.
function edgeRank(db: Database, lane: Lane, edge: "top" | "bottom", except = 0): string {
  const fn = edge === "top" ? "min" : "max"
  const row = db
    .query<{ r: string | null }, [Priority | null, Status, number]>(`SELECT ${fn}(rank) AS r FROM items WHERE priority IS ? AND status = ? AND archived_at IS NULL AND id != ?`)
    .get(lane.priority, lane.status, except)
  return edge === "top" ? rankBetween(null, row?.r ?? null) : rankBetween(row?.r ?? null, null)
}

function nextToRank(db: Database, lane: Lane, neighbourId: number, side: "before" | "after", except: number): string {
  const n = db.query<Item, [number]>("SELECT * FROM items WHERE id = ?").get(neighbourId)
  if (!n || n.archived_at) throw bad("bad_neighbour", `#${neighbourId} is not on the board`)
  if (n.priority !== lane.priority || n.status !== lane.status) throw bad("bad_neighbour", `#${neighbourId} is in another lane`)
  if (n.id === except) throw bad("bad_neighbour", "An item cannot move next to itself")
  const q = side === "before" ? "SELECT max(rank) AS r FROM items WHERE rank < ?" : "SELECT min(rank) AS r FROM items WHERE rank > ?"
  const other = db
    .query<{ r: string | null }, [string, Priority | null, Status, number]>(`${q} AND priority IS ? AND status = ? AND archived_at IS NULL AND id != ?`)
    .get(n.rank, lane.priority, lane.status, except)?.r ?? null
  return side === "before" ? rankBetween(other, n.rank) : rankBetween(n.rank, other)
}

function placeRank(db: Database, lane: Lane, input: Record<string, unknown>, except = 0): string {
  const sides = (["before", "after", "top", "bottom"] as const).filter((k) => input[k] !== undefined && input[k] !== false)
  if (sides.length > 1) throw bad("bad_move", "Give one of before, after, top or bottom")
  const side = sides[0] ?? "bottom"
  if (side === "top" || side === "bottom") return edgeRank(db, lane, side, except)
  return nextToRank(db, lane, toInt(input[side], side), side, except)
}

// ── items ────────────────────────────────────────────────────────────────────

export type ListQuery = { repo: string[]; status: string[]; priority: string[]; group?: string; parent?: string; q?: string; include_archived?: boolean }

export function listTodos(db: Database, query: ListQuery): Item[] {
  const where: string[] = []
  const args: (string | number)[] = []
  const marks = (n: number) => Array(n).fill("?").join(", ")
  if (query.repo.length) {
    where.push(`(items.repo_id IN (${marks(query.repo.length)}) OR repos.name IN (${marks(query.repo.length)}))`)
    args.push(...query.repo, ...query.repo)
  }
  const statuses = (query.status.length ? query.status : ["todo", "doing"]).map(parseStatus)
  where.push(`items.status IN (${marks(statuses.length)})`)
  args.push(...statuses)
  if (query.priority.length) {
    const ps = query.priority.map(parsePriority)
    const set = ps.filter((p) => p !== null)
    const parts = [...(set.length ? [`items.priority IN (${marks(set.length)})`] : []), ...(ps.includes(null) ? ["items.priority IS NULL"] : [])]
    where.push(`(${parts.join(" OR ")})`)
    args.push(...set)
  }
  if (query.group) {
    where.push("groups.name = ?")
    args.push(query.group)
  }
  if (query.parent) {
    where.push("items.parent_id = ?")
    args.push(toInt(query.parent, "parent"))
  }
  if (query.q) {
    where.push("(instr(lower(items.title), lower(?)) > 0 OR instr(lower(items.body), lower(?)) > 0)")
    args.push(query.q, query.q)
  }
  if (!query.include_archived) where.push("items.archived_at IS NULL")
  return db.query<Item, (string | number)[]>(`${SELECT} WHERE ${where.join(" AND ")} ${ORDER}`).all(...args)
}

type Event = { id: number; item_id: number; actor: string; action: string; at: string }

export function getTodo(db: Database, id: number) {
  const item = itemRow(db, id)
  return {
    item,
    children: db.query<Item, [number]>(`${SELECT} WHERE items.parent_id = ? ORDER BY items.id`).all(id),
    group: item.group_id === null ? null : db.query("SELECT * FROM groups WHERE id = ?").get(item.group_id),
    events: db
      .query<Event & { data: string }, [number]>("SELECT * FROM events WHERE item_id = ? ORDER BY id DESC LIMIT 20")
      .all(id)
      .map((e) => ({ ...e, data: JSON.parse(e.data) })),
  }
}

function parentFor(db: Database, item: { id?: number; repo_id: string }, value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parent = db.query<Item, [number]>("SELECT * FROM items WHERE id = ?").get(toInt(value, "parent"))
  if (!parent) throw bad("bad_parent", `No item #${String(value)}`)
  const has_children = item.id !== undefined && !!db.query("SELECT 1 FROM items WHERE parent_id = ?").get(item.id)
  checkParent({ ...item, has_children }, parent)
  return parent.id
}

export function createTodo(db: Database, actor: string, input: Record<string, unknown>): Item {
  return db.transaction(() => {
    const repo_id = resolveRepo(db, input.repo)
    const lane: Lane = {
      priority: input.priority === undefined ? null : parsePriority(input.priority),
      status: input.status === undefined ? "todo" : parseStatus(input.status),
    }
    const at = now()
    const row = {
      repo_id,
      group_id: input.group === undefined ? null : resolveGroup(db, repo_id, input.group),
      parent_id: parentFor(db, { repo_id }, input.parent),
      title: parseTitle(input.title),
      body: optText(input.body, "body") ?? "",
      ...lane,
      rank: placeRank(db, lane, input),
      done_at: lane.status === "done" ? at : null,
    }
    const { id } = db
      .query<{ id: number }, (string | number | null)[]>(
        `INSERT INTO items (repo_id, group_id, parent_id, title, body, status, priority, rank, created_at, updated_at, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(row.repo_id, row.group_id, row.parent_id, row.title, row.body, row.status, row.priority, row.rank, at, at, row.done_at)!
    event(db, id, actor, "create", row)
    return itemRow(db, id)
  })()
}

type Changes = Record<string, [unknown, unknown]>

// Writes the changed fields, the new rank if the lane moved, and one event.
function write(db: Database, actor: string, action: string, item: Item, next: Partial<Item>): Item {
  const changes: Changes = {}
  for (const [k, v] of Object.entries(next)) if (item[k as keyof Item] !== v) changes[k] = [item[k as keyof Item], v]
  if (!Object.keys(changes).length) return item
  const at = now()
  const cols = Object.keys(changes)
  db.run(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...cols.map((c) => changes[c]![1] as string | number | null), at, item.id])
  event(db, item.id, actor, action, changes)
  return itemRow(db, item.id)
}

function laneChange(db: Database, item: Item, lane: Lane): Partial<Item> {
  if (lane.priority === item.priority && lane.status === item.status) return {}
  return { ...lane, rank: edgeRank(db, lane, "bottom", item.id), done_at: doneAt(item.status, lane.status, item.done_at, now()) }
}

export function updateTodo(db: Database, actor: string, id: number, input: Record<string, unknown>): Item {
  return db.transaction(() => {
    const item = itemRow(db, id)
    if (input.if_updated_at !== undefined && input.if_updated_at !== item.updated_at) {
      throw new HttpError(409, "conflict", `#${id} changed since you loaded it`, { item })
    }
    const lane: Lane = {
      priority: input.priority === undefined ? item.priority : parsePriority(input.priority),
      status: input.status === undefined ? item.status : parseStatus(input.status),
    }
    const next: Partial<Item> = laneChange(db, item, lane)
    if (input.title !== undefined) next.title = parseTitle(input.title)
    if (input.body !== undefined) next.body = optText(input.body, "body") ?? ""
    if (input.section !== undefined) next.section = optText(input.section, "section")
    if (input.group !== undefined) next.group_id = resolveGroup(db, item.repo_id, input.group)
    if (input.parent !== undefined) next.parent_id = parentFor(db, item, input.parent)
    return write(db, actor, "update", item, next)
  })()
}

export function moveTodo(db: Database, actor: string, id: number, input: Record<string, unknown>): Item {
  return db.transaction(() => {
    const item = itemRow(db, id)
    const lane: Lane = {
      priority: input.priority === undefined ? item.priority : parsePriority(input.priority),
      status: input.status === undefined ? item.status : parseStatus(input.status),
    }
    const rank = placeRank(db, lane, input, id)
    return write(db, actor, "move", item, { ...lane, rank, done_at: doneAt(item.status, lane.status, item.done_at, now()) })
  })()
}

export function archiveTodo(db: Database, actor: string, id: number, archived: boolean): Item {
  return db.transaction(() => {
    const item = itemRow(db, id)
    if (!!item.archived_at === archived) return item
    // Back at the bottom of its lane: its old rank may now tie with a newer item.
    const next = archived ? { archived_at: now() } : { archived_at: null, rank: edgeRank(db, item, "bottom", id) }
    return write(db, actor, archived ? "archive" : "unarchive", item, next)
  })()
}

// ── imports ──────────────────────────────────────────────────────────────────

type ImportInput = { repo: { id: string; name: string }; path: string; original: string }

function importInput(input: Record<string, unknown>): ImportInput {
  const repo = input.repo as Record<string, unknown> | undefined
  if (typeof repo?.id !== "string" || typeof repo.name !== "string") throw bad("bad_repo", "repo needs an id and a name")
  if (typeof input.path !== "string" || !input.path) throw bad("bad_path", "path is required")
  if (typeof input.original !== "string") throw bad("bad_original", "original must be the file's text")
  return { repo: { id: repo.id, name: repo.name }, path: input.path, original: input.original }
}

// Parses on the server with the same code the CLI uses, so the server never trusts a client's parse.
export function applyImport(db: Database, input: Record<string, unknown>, dryRun: boolean) {
  const { repo, path, original } = importInput(input)
  const { parsed, failures } = checkFile(original)
  const summary = report(path, repo, parsed, failures)
  if (dryRun) return { report: summary }
  if (!summary.ok) throw new HttpError(422, "validation_failed", `${path} failed validation`, { report: summary })

  return db.transaction(() => {
    resolveRepo(db, repo)
    if (db.query("SELECT 1 FROM imports WHERE repo_id = ? AND path = ?").get(repo.id, path)) {
      throw new HttpError(409, "already_imported", `${repo.name}/${path} was already imported`)
    }
    const at = now()
    const sha256 = new Bun.CryptoHasher("sha256").update(original).digest("hex")
    const { id: importId } = db
      .query<{ id: number }, [string, string, string, string, string]>("INSERT INTO imports (repo_id, path, sha256, original, report, at) VALUES (?, ?, ?, ?, '{}', ?) RETURNING id")
      .get(repo.id, path, sha256, original, at)!

    const groupIds = parsed.groups.map((g) => {
      const existing = db.query<Group, [string, string]>("SELECT * FROM groups WHERE repo_id = ? AND name = ?").get(repo.id, g.name)
      if (!existing) {
        return db
          .query<{ id: number }, [string, string, string | null, string, string]>("INSERT INTO groups (repo_id, name, doc_path, note, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
          .get(repo.id, g.name, g.doc_path, g.note, at)!.id
      }
      const note = [existing.note, g.note].filter(Boolean).join("\n\n")
      db.run("UPDATE groups SET note = ?, doc_path = coalesce(doc_path, ?) WHERE id = ?", [note, g.doc_path, existing.id])
      return existing.id
    })

    // Ranks follow file order within each lane, after whatever is already there.
    const last = new Map<string, string | null>()
    const itemIds: number[] = []
    for (const p of parsed.items) {
      const key = `${p.priority}|${p.status}`
      if (!last.has(key)) {
        last.set(key, db.query<{ r: string | null }, [Priority | null, Status]>("SELECT max(rank) AS r FROM items WHERE priority IS ? AND status = ? AND archived_at IS NULL").get(p.priority, p.status)?.r ?? null)
      }
      const rank = rankBetween(last.get(key)!, null)
      last.set(key, rank)
      const { id } = db
        .query<{ id: number }, (string | number | null)[]>(
          `INSERT INTO items (repo_id, group_id, parent_id, section, title, body, status, priority, rank, created_at, updated_at, done_at, import_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          repo.id,
          p.group === null ? null : groupIds[p.group]!,
          p.parent === null ? null : itemIds[p.parent]!,
          p.section,
          p.title,
          p.body,
          p.status,
          p.priority,
          rank,
          at,
          at,
          p.status === "done" ? at : null,
          importId,
        )!
      itemIds.push(id)
      event(db, id, "import", "import", { import_id: importId })
    }
    const stored = { ...summary, group_ids: groupIds }
    db.run("UPDATE imports SET report = ? WHERE id = ?", [JSON.stringify(stored), importId])
    return { import_id: importId, report: stored }
  })()
}

export function getImport(db: Database, id: number) {
  const row = db
    .query<{ id: number; repo_id: string; path: string; sha256: string; original: string; report: string; at: string }, [number]>("SELECT * FROM imports WHERE id = ?")
    .get(id)
  if (!row) throw notFound(`Import ${id}`)
  const report = JSON.parse(row.report) as { group_ids?: number[] }
  const ids = report.group_ids ?? []
  return {
    import: { ...row, report },
    groups: ids.length ? db.query(`SELECT * FROM groups WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`).all(...ids) : [],
    items: db.query<Item, [number]>(`${SELECT} WHERE items.import_id = ? ORDER BY items.id`).all(id),
  }
}
