import { describe, expect, test } from "bun:test"
import type { DocRow } from "@atlas/indexer"
import { folderListing } from "../src/server/doc-folders"

const DAY = 864e5
const now = Date.UTC(2026, 9, 13, 12)
const doc = (repo: string, path: string, daysAgo: number, type = "", created: string | null = null): DocRow => ({ repo, path, kind: path.endsWith(".md") ? "md" : "html", title: `T ${path}`, mtime: now - daysAgo * DAY, size: 1, type, tags: "", created })

describe("folderListing", () => {
  const rows = [doc("web", "plan.md", 1, "plan"), doc("web", "plan.html", 3, "plan"), doc("web", "notes/a.md", 0), doc("web", "notes/deep/b.md", 5), doc("api", "run.html", 10, "reference")]

  test("the root lists the repos, with their doc counts and newest change", () => {
    expect(folderListing(rows, "")).toEqual({
      path: "",
      folders: [
        { name: "api", docs: 1, last: new Date(now - 10 * DAY).toISOString() },
        { name: "web", docs: 3, last: new Date(now).toISOString() },
      ],
      docs: [],
    })
  })

  test("a repo lists its folders first, then its docs, a twin once as the html at its newer time", () => {
    const web = folderListing(rows, "web")
    expect(web.folders).toEqual([{ name: "notes", docs: 2, last: new Date(now).toISOString() }])
    expect(web.docs).toEqual([{ repo: "web", path: "plan.html", kind: "html", title: "T plan.html", type: "plan", tags: "", mtime: new Date(now - DAY).toISOString(), created: null }])
  })

  test("a nested folder lists only what is under it, and a stray slash changes nothing", () => {
    const notes = folderListing(rows, "/web/notes/")
    expect(notes.path).toBe("web/notes")
    expect(notes.folders.map((f) => f.name)).toEqual(["deep"])
    expect(notes.docs.map((d) => [d.path, d.type])).toEqual([["notes/a.md", null]])
    expect(folderListing(rows, "web/nowhere")).toEqual({ path: "web/nowhere", folders: [], docs: [] })
  })

  test("by created, the newest written doc comes first, a bare day as its midnight UTC, and docs without one last", () => {
    const docs = [
      doc("web", "a.md", 0),
      doc("web", "b.md", 0, "", "2026-10-01T08:00:00Z"),
      doc("web", "c.md", 0, "", "2026-10-02"),
      doc("web", "d.html", 0, "", "2026-10-01T23:00:00Z"),
    ]
    expect(folderListing(docs, "web", "created").docs.map((d) => d.path)).toEqual(["c.md", "d.html", "b.md", "a.md"])
    expect(folderListing(docs, "web").docs.map((d) => d.path)).toEqual(["a.md", "b.md", "c.md", "d.html"])
  })

  test("a twin takes the md's created time when the html has none", () => {
    const twins = [doc("web", "x.md", 0, "", "2026-10-01"), doc("web", "x.html", 0)]
    expect(folderListing(twins, "web").docs.map((d) => [d.path, d.created])).toEqual([["x.html", "2026-10-01"]])
  })
})
