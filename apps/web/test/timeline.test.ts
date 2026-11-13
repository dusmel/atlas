import { beforeEach, describe, expect, test } from "bun:test"
import type { Database } from "bun:sqlite"
import { HttpError } from "../src/server/http"
import { adoptSession, getTimeline, listEfforts, listTimeline, syncTimeline } from "../src/server/timeline"
import { createGroup, createTodo, updateGroup } from "../src/server/todos"
import { freshDb } from "./helpers"

let db: Database
const repo = { id: "github.com-me-app", name: "app" }
let groupId = 0

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  entry: id,
  state: "done",
  title: id,
  lines: [{ day: "2026-11-05", text: `work on ${id}`, source: "git", ref: "abc1234" }],
  ...extra,
})
const sync = (entries: unknown[], extra: Record<string, unknown> = {}) => syncTimeline(db, { group: groupId, entries, ...extra })
const rows = () => getTimeline(db, { group: String(groupId) }).entries

beforeEach(() => {
  db = freshDb()
  groupId = (createGroup(db, { repo, name: "v1" }) as { id: number }).id
})

describe("syncTimeline", () => {
  test("creates entries in the order sent", () => {
    expect(sync([entry("phase-1"), entry("phase-2", { state: "doing" })])).toEqual({ created: 2, updated: 0, unchanged: 0, removed: 0 })
    expect(rows().map((e) => [e.entry, e.position, e.state])).toEqual([["phase-1", 0, "done"], ["phase-2", 1, "doing"]])
    expect(rows()[0]!.lines[0]).toEqual({ day: "2026-11-05", text: "work on phase-1", source: "git", ref: "abc1234", kind: null })
  })

  test("a second sync with nothing new changes no row", () => {
    sync([entry("phase-1"), entry("phase-2")])
    const before = rows().map((e) => e.updated_at)
    expect(sync([entry("phase-1"), entry("phase-2")])).toEqual({ created: 0, updated: 0, unchanged: 2, removed: 0 })
    expect(rows().map((e) => e.updated_at)).toEqual(before)
  })

  test("a sync never overwrites a written note", () => {
    sync([entry("phase-1", { note: "Records are never deleted now." })])
    expect(rows()[0]).toMatchObject({ note: "Records are never deleted now.", note_state: "written" })
    // A sync from git alone sends no note: the note stays.
    sync([entry("phase-1", { title: "Phase 1: marks" })])
    expect(rows()[0]).toMatchObject({ title: "Phase 1: marks", note: "Records are never deleted now.", note_state: "written" })
  })

  test("a note the file sends replaces the stored one, and a draft is marked", () => {
    sync([entry("phase-1", { note: "", note_state: "draft" })])
    expect(rows()[0]).toMatchObject({ note: "", note_state: "draft" })
    sync([entry("phase-1", { note: "Written later." })])
    expect(rows()[0]).toMatchObject({ note: "Written later.", note_state: "written" })
  })

  test("removes entries the sync no longer sends", () => {
    sync([entry("2026-11-04"), entry("2026-11-05")])
    expect(sync([entry("phase-1")])).toEqual({ created: 1, updated: 0, unchanged: 0, removed: 2 })
    expect(rows().map((e) => e.entry)).toEqual(["phase-1"])
  })

  test("finds the group by name and repo", () => {
    syncTimeline(db, { group: "v1", repo: "app", entries: [entry("phase-1")] })
    expect(getTimeline(db, { group: "v1", repo: "app" }).entries).toHaveLength(1)
    expect(getTimeline(db, { group: "v1" }).group?.name).toBe("v1")
  })

  test("keeps session entries apart from group entries", () => {
    syncTimeline(db, { session: "8e1e13cd", entries: [entry("2026-11-05")] })
    sync([entry("2026-11-05")])
    expect(getTimeline(db, { session: "8e1e13cd" }).entries).toHaveLength(1)
    expect(rows()).toHaveLength(1)
  })

  test("rejects bad input", () => {
    const code = (fn: () => unknown) => {
      try {
        fn()
      } catch (e) {
        return (e as HttpError).code
      }
      return "no error"
    }
    expect(code(() => sync([entry("a", { state: "maybe" })]))).toBe("bad_field")
    expect(code(() => sync([entry("a"), entry("a")]))).toBe("bad_entries")
    expect(code(() => sync([entry("a", { lines: [{ text: "x" }] })]))).toBe("bad_field")
    expect(code(() => syncTimeline(db, { entries: [] }))).toBe("bad_owner")
    expect(code(() => syncTimeline(db, { group: 999, entries: [] }))).toBe("not_found")
  })
})

describe("listEfforts", () => {
  test("gives each effort its bar, doing entry, waiting items and last activity", () => {
    updateGroup(db, groupId, { branches: "v1/*" })
    createTodo(db, { actor: "test", author: "me" }, { repo, title: "polish", group: "v1", status: "doing" })
    sync([
      entry("phase-1", { ended_at: "2026-11-05T18:00:00Z" }),
      entry("polish", { state: "doing", lines: [{ text: "pick a target", source: "note", kind: "waiting" }] }),
    ])
    const [e] = listEfforts(db)
    expect(e).toMatchObject({ name: "v1", repo_name: "app", branches: "v1/*", open: 1, doing: "polish" })
    expect(e!.bar.map((b) => b.state)).toEqual(["done", "doing"])
    expect(e!.waiting).toEqual([{ entry: "polish", text: "pick a target", ref: null }])
    expect(e!.last_at).not.toBeNull()
  })

  test("deleting a group deletes its entries", () => {
    sync([entry("phase-1")])
    db.run("DELETE FROM groups WHERE id = ?", [groupId])
    expect(db.query("SELECT count(*) AS n FROM timeline_entries").get()).toEqual({ n: 0 })
  })
})

describe("sessions", () => {
  const SID = "11111111-2222-3333-4444-555555555555"
  const meta = {
    title: "Lamp rota",
    ai_title: "First prompt title",
    cwd: "/w/app",
    repo_id: repo.id,
    started_at: "2026-11-03T08:00:00Z",
    ended_at: "2026-11-04T09:00:00Z",
    days: 2,
    prompts: 31,
    commits: 3,
    todos: 2,
  }
  const day = (d: string) => ({ entry: d, state: "done", title: `Day ${d}`, lines: [{ day: d, text: "Asked for the rota", source: "session", ref: SID, kind: "asked" }] })
  const syncSession = (extra: Record<string, unknown> = {}) =>
    syncTimeline(db, { session: SID, entries: [day("2026-11-03"), day("2026-11-04")], meta, links: [{ group_id: groupId, signals: ["todos", "files"] }], ...extra })

  test("stores the facts, the links and one entry per day", () => {
    expect(syncSession()).toEqual({ created: 2, updated: 0, unchanged: 0, removed: 0 })
    const view = getTimeline(db, { session: SID }) as { session: Record<string, unknown>; entries: { entry: string }[] }
    expect(view.entries.map((e) => e.entry)).toEqual(["2026-11-03", "2026-11-04"])
    expect(view.session).toMatchObject({ id: SID, title: "Lamp rota", repo_name: "app", prompts: 31, efforts: [{ id: groupId, name: "v1", repo_name: "app", signals: ["todos", "files"] }] })
  })

  test("stores prompts per day and replaces only the days sent", () => {
    const p = (day: string, at: string, text: string) => ({ day, at, text, dropped: 0 })
    syncSession({ prompts: { days: ["2026-11-03", "2026-11-04"], items: [p("2026-11-03", "2026-11-03T08:00:00Z", "Plan the rota"), p("2026-11-04", "2026-11-04T08:00:00Z", "Paint the lamp")] } })
    syncSession({ prompts: { days: ["2026-11-04"], items: [p("2026-11-04", "2026-11-04T08:00:00Z", "Paint the lamp"), p("2026-11-04", "2026-11-04T09:00:00Z", "Then the rail")] } })
    const view = getTimeline(db, { session: SID }) as { prompts: { text: string }[] }
    expect(view.prompts.map((x) => x.text)).toEqual(["Plan the rota", "Paint the lamp", "Then the rail"])
    expect(() => syncSession({ prompts: { days: ["2026-11-03"], items: [p("2026-11-04", "2026-11-04T10:00:00Z", "x")] } })).toThrow("not in days")
    // Empty text is only for a prompt the filter emptied.
    expect(() => syncSession({ prompts: { days: ["2026-11-03"], items: [p("2026-11-03", "2026-11-03T10:00:00Z", "")] } })).toThrow("non-empty")
    syncSession({ prompts: { days: ["2026-11-03"], items: [{ ...p("2026-11-03", "2026-11-03T10:00:00Z", ""), dropped: 1 }] } })
    expect((getTimeline(db, { session: SID }) as { prompts: { text: string; dropped: number }[] }).prompts[0]).toMatchObject({ text: "", dropped: 1 })
    expect(() => syncTimeline(db, { group: groupId, entries: [], prompts: { days: [], items: [] } })).toThrow("belong to a session")
  })

  test("a second sync with nothing new keeps updated_at", () => {
    syncSession()
    const at = () => db.query<{ updated_at: string }, []>("SELECT updated_at FROM timeline_sessions").get()!.updated_at
    const before = at()
    Bun.sleepSync(5)
    syncSession()
    expect(at()).toBe(before)
  })

  test("the sidebar lists linked sessions under their effort and the rest apart", () => {
    syncSession()
    syncTimeline(db, { session: "loose", entries: [], meta: { ...meta, title: "Loose one", days: 1, prompts: 3, commits: 0, todos: 0 }, links: [] })
    const t = listTimeline(db)
    expect(t.efforts.find((e) => e.id === groupId)!.sessions.map((s) => [s.id, s.big])).toEqual([[SID, true]])
    expect(t.sessions.map((s) => [s.title, s.big])).toEqual([["Loose one", false]])
  })

  test("a link to a group this server lacks is skipped; a bad signal is refused", () => {
    syncSession({ links: [{ group_id: 9999, signals: ["prs"] }] })
    expect((getTimeline(db, { session: SID }) as { session: { efforts: unknown[] } }).session.efforts).toEqual([])
    expect(() => syncSession({ links: [{ group_id: groupId, signals: ["cwd"] }] })).toThrow(HttpError)
    expect(() => syncTimeline(db, { group: groupId, entries: [], meta })).toThrow(HttpError)
  })

  test("an adopted session stays linked through later syncs, which still replace the other signals", () => {
    syncSession({ links: [] })
    const efforts = () => (getTimeline(db, { session: SID }) as { session: { efforts: { id: number; signals: string[] }[] } }).session.efforts.map((e) => [e.id, e.signals])
    expect(adoptSession(db, { session: SID, group_id: groupId })).toEqual({ session: SID, group_id: groupId, signals: ["adopted"] })
    syncSession({ links: [] })
    expect(efforts()).toEqual([[groupId, ["adopted"]]])
    syncSession()
    expect(efforts()).toEqual([[groupId, ["todos", "files", "adopted"]]])
    expect(listTimeline(db).efforts.find((e) => e.id === groupId)!.sessions.map((s) => s.id)).toEqual([SID])
    expect(() => adoptSession(db, { session: "nope", group_id: groupId })).toThrow(HttpError)
    expect(() => adoptSession(db, { session: SID, group_id: 9999 })).toThrow(HttpError)
  })

  test("an unknown session is a 404, and deleting a group drops its links", () => {
    expect(() => getTimeline(db, { session: "nope" })).toThrow(HttpError)
    syncSession()
    db.run("DELETE FROM groups WHERE id = ?", [groupId])
    expect(db.query("SELECT count(*) AS n FROM timeline_session_links").get()).toEqual({ n: 0 })
  })
})
