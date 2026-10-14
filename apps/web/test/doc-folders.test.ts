import { describe, expect, test } from "bun:test"
import type { DocRow } from "@atlas/indexer"
import { folderListing } from "../src/server/doc-folders"

const DAY = 864e5
const now = Date.UTC(2026, 9, 13, 12)
const doc = (repo: string, path: string, daysAgo: number, type = ""): DocRow => ({ repo, path, kind: path.endsWith(".md") ? "md" : "html", title: `T ${path}`, mtime: now - daysAgo * DAY, size: 1, type, tags: "" })

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
    expect(web.docs).toEqual([{ repo: "web", path: "plan.html", kind: "html", title: "T plan.html", type: "plan", tags: "", mtime: new Date(now - DAY).toISOString() }])
  })

  test("a nested folder lists only what is under it, and a stray slash changes nothing", () => {
    const notes = folderListing(rows, "/web/notes/")
    expect(notes.path).toBe("web/notes")
    expect(notes.folders.map((f) => f.name)).toEqual(["deep"])
    expect(notes.docs.map((d) => [d.path, d.type])).toEqual([["notes/a.md", null]])
    expect(folderListing(rows, "web/nowhere")).toEqual({ path: "web/nowhere", folders: [], docs: [] })
  })
})
