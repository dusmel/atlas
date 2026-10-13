import { describe, expect, test } from "bun:test"
import type { DocMeta } from "@atlas/indexer"
import { docEventDays, listDocEvents, recordDocChanges } from "../src/server/doc-activity"
import { freshDb } from "./helpers"

const doc = (path: string, mtime: number, size = 10, repo = "web"): DocMeta => ({ repo, path, kind: path.endsWith(".html") ? "html" : "md", title: path, mtime, size })
const t = (min: number) => Date.UTC(2026, 9, 12, 9, min)

describe("doc activity", () => {
  test("the first run only records the baseline, later runs log adds, changes and removals", () => {
    const db = freshDb()
    expect(recordDocChanges(db, [doc("plans/a.md", t(0)), doc("b.md", t(0))])).toBe(0)
    expect(listDocEvents(db)).toEqual([])

    const now = new Date(t(30))
    expect(recordDocChanges(db, [doc("plans/a.md", t(10), 12), doc("c.md", t(20))], now)).toBe(3)
    expect(listDocEvents(db).map((e) => [e.change, e.path, e.at])).toEqual([
      ["removed", "b.md", now.toISOString()],
      ["added", "c.md", new Date(t(20)).toISOString()],
      ["changed", "plans/a.md", new Date(t(10)).toISOString()],
    ])
    expect(listDocEvents(db, { folder: ["plans"] }).map((e) => e.path)).toEqual(["plans/a.md"])
    expect(listDocEvents(db, { after: new Date(t(15)).toISOString() }).map((e) => e.path)).toEqual(["b.md", "c.md"])
    expect(recordDocChanges(db, [doc("plans/a.md", t(10), 12), doc("c.md", t(20))])).toBe(0)
  })

  test("an empty index with a baseline logs nothing, and an md and html pair shows once", () => {
    const db = freshDb()
    recordDocChanges(db, [doc("x.md", t(0))])
    expect(recordDocChanges(db, [])).toBe(0)
    recordDocChanges(db, [doc("x.md", t(0)), doc("plan.md", t(40)), doc("plan.html", t(41))])
    expect(listDocEvents(db).map((e) => [e.path, e.kinds])).toEqual([["plan.html", ["html", "md"]]])
    expect(listDocEvents(db, { repo: ["api"] })).toEqual([])
  })

  test("days count docs changed per day in the viewer's timezone, an md and html pair once, and skip what is over a year old", () => {
    const db = freshDb()
    const midnight = Math.floor(Date.now() / 864e5) * 864e5 - 3 * 864e5
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    const late = midnight + 23.5 * 36e5
    recordDocChanges(db, [doc("old.md", 0)])
    recordDocChanges(db, [doc("old.md", midnight - 400 * 864e5), doc("plan.md", late), doc("plan.html", late + 1000), doc("api.md", late, 10, "api")])
    expect(docEventDays(db, {}).days).toEqual({ [day(midnight)]: 2 })
    expect(docEventDays(db, { tz: "120" }).days).toEqual({ [day(midnight + 864e5)]: 2 })
    expect(docEventDays(db, { repo: ["api"], tz: "-60" }).days).toEqual({ [day(midnight)]: 1 })
    expect(() => docEventDays(db, { tz: "1.5" })).toThrow("tz must be")
  })
})
