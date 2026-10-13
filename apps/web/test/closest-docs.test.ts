import { expect, test } from "bun:test"
import type { DocMeta } from "@atlas/indexer"
import { closestDocs } from "../src/server/closest-docs"

const doc = (repo: string, path: string): DocMeta => ({ repo, path, kind: path.endsWith(".md") ? "md" : "html", title: path, mtime: 0, size: 1 })
const files = [doc("web", "plans/lighthouse.md"), doc("web", "plans/lighthouse.html"), doc("web", "notes/harbour.md"), doc("api", "plans/lighthouse.md"), doc("web", "plans/lamp-room.md")]

test("a typo finds its doc first, as the html when it has a twin, and its own repo wins a tie", () => {
  expect(closestDocs(files, "web", "plans/lighthose.html").map((d) => `${d.repo}/${d.path}`)).toEqual(["web/plans/lighthouse.html", "api/plans/lighthouse.md", "web/plans/lamp-room.md"])
})

test("at most n, and fewer when there are fewer docs", () => {
  expect(closestDocs(files, "web", "x.md", 2)).toHaveLength(2)
  expect(closestDocs([], "web", "x.md")).toEqual([])
})
