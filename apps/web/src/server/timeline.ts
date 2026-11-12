import type { Database } from "bun:sqlite"
import { now } from "./db"
import { HttpError } from "./http"
import { groupDocs, resolveRepo } from "./todos"

// Design: atlas/timeline/design.html. The CLI sync owns every field but the note, which comes from
// timeline.md and is kept when a sync sends none.

export const STATES = ["done", "doing", "todo", "parked"] as const
export type EntryState = (typeof STATES)[number]
const NOTE_STATES = ["none", "draft", "written"] as const
type NoteState = (typeof NOTE_STATES)[number]

/** One line inside an entry. `source` is git, todo, run, note or session; `ref` is the hash, todo id or session id. */
export type TimelineLine = { day: string | null; text: string; source: string; ref: string | null; kind: string | null }

export type TimelineEntry = {
  entry: string
  position: number
  state: EntryState
  title: string
  note: string
  note_state: NoteState
  merged: boolean
  lines: TimelineLine[]
  started_at: string | null
  ended_at: string | null
  updated_at: string
}

type Row = Omit<TimelineEntry, "merged" | "lines"> & { id: number; group_id: number | null; merged: number; lines: string }

const bad = (code: string, message: string) => new HttpError(400, code, message)
const text = (v: unknown, what: string, max = 2000): string => {
  if (typeof v !== "string" || !v.trim()) throw bad("bad_field", `${what} must be non-empty text`)
  if (v.length > max) throw bad("bad_field", `${what} is longer than ${max} characters`)
  return v
}
const optText = (v: unknown, what: string): string | null => (v === undefined || v === null ? null : text(v, what))
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T => {
  if (!list.includes(v as T)) throw bad("bad_field", `${what} must be one of ${list.join(", ")}`)
  return v as T
}

function parseLine(v: unknown, i: number): TimelineLine {
  if (!v || typeof v !== "object") throw bad("bad_line", `line ${i} must be an object`)
  const l = v as Record<string, unknown>
  return { day: optText(l.day, "line day"), text: text(l.text, "line text"), source: text(l.source, "line source", 20), ref: optText(l.ref, "line ref"), kind: optText(l.kind, "line kind") }
}

type Parsed = Omit<TimelineEntry, "updated_at" | "note" | "note_state"> & { note?: { text: string; state: NoteState } }

function parseEntry(v: unknown, position: number): Parsed {
  if (!v || typeof v !== "object") throw bad("bad_entry", `entry ${position} must be an object`)
  const e = v as Record<string, unknown>
  const lines = e.lines === undefined ? [] : e.lines
  if (!Array.isArray(lines)) throw bad("bad_entry", "lines must be a list")
  const out: Parsed = {
    entry: text(e.entry, "entry", 80),
    position,
    state: oneOf(e.state, STATES, "state"),
    title: text(e.title, "title", 200),
    merged: e.merged === true,
    lines: lines.map(parseLine),
    started_at: optText(e.started_at, "started_at"),
    ended_at: optText(e.ended_at, "ended_at"),
  }
  if (e.note !== undefined) {
    const note = typeof e.note === "string" ? e.note : ""
    const state = e.note_state === undefined ? (note ? "written" : "none") : oneOf(e.note_state, NOTE_STATES, "note_state")
    out.note = { text: note, state }
  }
  return out
}

type Owner = { col: "group_id" | "session"; id: number | string }

function resolveOwner(db: Database, input: Record<string, unknown>): Owner {
  if (input.session !== undefined) return { col: "session", id: text(input.session, "session", 80) }
  if (typeof input.group === "number") {
    if (!db.query("SELECT 1 FROM groups WHERE id = ?").get(input.group)) throw new HttpError(404, "not_found", `No group ${input.group}`)
    return { col: "group_id", id: input.group }
  }
  if (typeof input.group === "string") {
    const repoId = resolveRepo(db, input.repo)
    const row = db.query<{ id: number }, [string, string]>("SELECT id FROM groups WHERE repo_id = ? AND name = ?").get(repoId, input.group)
    if (!row) throw new HttpError(404, "not_found", `No group ${input.group} in ${String(input.repo)}`)
    return { col: "group_id", id: row.id }
  }
  throw bad("bad_owner", "Send a group (id, or name with repo) or a session")
}

const toEntry = (r: Row): TimelineEntry => ({
  entry: r.entry,
  position: r.position,
  state: r.state,
  title: r.title,
  note: r.note,
  note_state: r.note_state,
  merged: r.merged === 1,
  lines: JSON.parse(r.lines),
  started_at: r.started_at,
  ended_at: r.ended_at,
  updated_at: r.updated_at,
})

/**
 * Replaces an owner's entries with the ones sent, in order. Rows that do not change keep their
 * updated_at, so a sync with nothing new changes no row.
 */
export function syncTimeline(db: Database, input: Record<string, unknown>) {
  if (!Array.isArray(input.entries)) throw bad("bad_entries", "entries must be a list")
  const entries = input.entries.map(parseEntry)
  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.entry)) throw bad("bad_entries", `entry ${e.entry} appears twice`)
    seen.add(e.entry)
  }
  return db.transaction(() => {
    const owner = resolveOwner(db, input)
    const existing = new Map(db.query<Row, [number | string]>(`SELECT * FROM timeline_entries WHERE ${owner.col} = ?`).all(owner.id).map((r) => [r.entry, r]))
    const counts = { created: 0, updated: 0, unchanged: 0, removed: 0 }
    const at = now()
    for (const e of entries) {
      const old = existing.get(e.entry)
      const lines = JSON.stringify(e.lines)
      const note = e.note ?? (old ? { text: old.note, state: old.note_state } : { text: "", state: "none" as NoteState })
      const values = [e.position, e.state, e.title, note.text, note.state, e.merged ? 1 : 0, lines, e.started_at, e.ended_at] as const
      if (!old) {
        db.run(
          `INSERT INTO timeline_entries (${owner.col}, entry, position, state, title, note, note_state, merged, lines, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [owner.id, e.entry, ...values, at],
        )
        counts.created++
        continue
      }
      const same = [old.position, old.state, old.title, old.note, old.note_state, old.merged, old.lines, old.started_at, old.ended_at].every((v, i) => v === values[i])
      if (same) {
        counts.unchanged++
        continue
      }
      db.run(
        "UPDATE timeline_entries SET position = ?, state = ?, title = ?, note = ?, note_state = ?, merged = ?, lines = ?, started_at = ?, ended_at = ?, updated_at = ? WHERE id = ?",
        [...values, at, old.id],
      )
      counts.updated++
    }
    for (const [entry, old] of existing) {
      if (seen.has(entry)) continue
      db.run("DELETE FROM timeline_entries WHERE id = ?", [old.id])
      counts.removed++
    }
    return counts
  })()
}

type EffortRow = { id: number; name: string; repo_id: string; repo_name: string; branches: string | null; note: string; open: number; doing_items: number; items_at: string | null }

/** One effort: the group, its docs and its entries in rail order. */
export function getTimeline(db: Database, query: { group?: string | null; repo?: string | null; session?: string | null }) {
  if (query.session) {
    const rows = db.query<Row, [string]>("SELECT * FROM timeline_entries WHERE session = ? ORDER BY position").all(query.session)
    return { session: query.session, entries: rows.map(toEntry) }
  }
  if (!query.group) throw bad("bad_owner", "Send group=<id or name> or session=<id>")
  const id = /^\d+$/.test(query.group) ? Number(query.group) : null
  const group = id !== null
    ? db.query<EffortRow, [number]>(`${EFFORTS} WHERE groups.id = ? GROUP BY groups.id`).get(id)
    : db.query<EffortRow, [string, string, string]>(`${EFFORTS} WHERE groups.name = ? AND (repos.id = ? OR repos.name = ?) GROUP BY groups.id`).get(query.group, query.repo ?? "", query.repo ?? "")
      ?? (query.repo ? null : onlyGroupNamed(db, query.group))
  if (!group) throw new HttpError(404, "not_found", `No group ${query.group}`)
  const rows = db.query<Row, [number]>("SELECT * FROM timeline_entries WHERE group_id = ? ORDER BY position").all(group.id)
  return { group: { ...group, docs: groupDocs(db, [group.id]).get(group.id)! }, entries: rows.map(toEntry) }
}

// A bare name works when exactly one repo has a group by that name.
function onlyGroupNamed(db: Database, name: string): EffortRow | null {
  const rows = db.query<EffortRow, [string]>(`${EFFORTS} WHERE groups.name = ? GROUP BY groups.id`).all(name)
  if (rows.length > 1) throw bad("ambiguous_group", `${rows.length} repos have a group ${name}; add repo=`)
  return rows[0] ?? null
}

const EFFORTS = `SELECT groups.id, groups.name, groups.repo_id, repos.name AS repo_name, groups.branches, groups.note,
    count(items.id) FILTER (WHERE items.status != 'done' AND items.archived_at IS NULL) AS open,
    count(items.id) FILTER (WHERE items.status = 'doing' AND items.archived_at IS NULL) AS doing_items,
    max(items.updated_at) AS items_at
  FROM groups JOIN repos ON repos.id = groups.repo_id LEFT JOIN items ON items.group_id = groups.id`

/** Every effort for the sidebar: its phase bar, last activity and what waits on the owner. */
export function listEfforts(db: Database) {
  const groups = db.query<EffortRow, []>(`${EFFORTS} GROUP BY groups.id ORDER BY repos.name, groups.id`).all()
  const rows = db.query<Row, []>("SELECT * FROM timeline_entries WHERE group_id IS NOT NULL ORDER BY group_id, position").all()
  const byGroup = new Map<number, TimelineEntry[]>()
  for (const r of rows) {
    const list = byGroup.get(r.group_id!) ?? []
    list.push(toEntry(r))
    byGroup.set(r.group_id!, list)
  }
  const docs = groupDocs(db, groups.map((g) => g.id))
  return groups.map((g) => {
    const entries = byGroup.get(g.id) ?? []
    const times = [g.items_at, ...entries.flatMap((e) => [e.ended_at, e.started_at])].filter((t): t is string => !!t)
    const waiting = entries.filter((e) => e.state !== "done").flatMap((e) => e.lines.filter((l) => l.kind === "waiting").map((l) => ({ entry: e.entry, text: l.text, ref: l.ref })))
    return {
      id: g.id,
      name: g.name,
      repo_id: g.repo_id,
      repo_name: g.repo_name,
      branches: g.branches,
      docs: docs.get(g.id)!,
      open: g.open,
      bar: entries.map((e) => ({ entry: e.entry, title: e.title, state: e.state })),
      doing: entries.find((e) => e.state === "doing")?.title ?? null,
      last_at: times.sort().at(-1) ?? null,
      waiting,
    }
  })
}
