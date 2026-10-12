import { describe, expect, test } from "bun:test"
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { docLinks } from "../src/lib/docs"
import { docFile, renderMarkdown, sharePage } from "../src/server/doc-files"
import { HttpError } from "../src/server/http"
import { createShare, listShares, liveShare, revokeShare } from "../src/server/shares"
import { freshDb, tempDir } from "./helpers"

describe("docFile", () => {
  const root = tempDir()
  mkdirSync(join(root, "app/plans"), { recursive: true })
  mkdirSync(join(root, "other"))
  writeFileSync(join(root, "app/plans/a.html"), "<p>a</p>")
  writeFileSync(join(root, "app/.secret"), "x")
  writeFileSync(join(root, "other/b.md"), "# b")
  symlinkSync(join(root, "other/b.md"), join(root, "app/link.md"))

  test("finds a file inside the repo folder", () => {
    expect(docFile(root, "app", "plans/a.html")).toEndWith("/app/plans/a.html")
  })

  test("refuses .., dot files, empty segments, folders and symlinks out of the repo", () => {
    for (const path of ["../other/b.md", "plans/../../other/b.md", ".secret", "plans//a.html", "./plans/a.html", "plans", "link.md", "missing.md", "plans\\a.html"]) {
      expect([path, docFile(root, "app", path)]).toEqual([path, null])
    }
    expect(docFile(root, "..", "app/plans/a.html")).toBeNull()
  })
})

describe("renderMarkdown", () => {
  test("takes the title from frontmatter, else the first heading, else the fallback", () => {
    expect(renderMarkdown("---\ntitle: 'From front'\n---\n# Heading\n", "f").title).toBe("From front")
    expect(renderMarkdown("Intro\n\n# Heading one\n", "f").title).toBe("Heading one")
    expect(renderMarkdown("No heading", "f.md").title).toBe("f.md")
  })

  test("renders gfm tables and task lists, and keeps relative links", () => {
    const { html } = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n[next](plans/b.md) ![pic](img/p.png)", "f")
    expect(html).toContain("<table>")
    expect(html).toContain('<input checked disabled type="checkbox"')
    expect(html).toContain('<a href="plans/b.md">next</a>')
    expect(html).toContain('<img src="img/p.png" alt="pic"')
  })

  test("strips scripts, handlers, javascript: links and other inputs", () => {
    const { html } = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))\n\n<input type="text" value="hi">\n\n<iframe src="https://e.com"></iframe>', "f")
    expect(html).not.toMatch(/script|onerror|javascript:|type="text"|iframe/i)
  })

  test("a share page escapes the title", () => {
    expect(sharePage("<b>&\"", "<p>x</p>")).toContain("<title>&lt;b&gt;&amp;&quot;</title>")
  })
})

describe("shares", () => {
  test("one live share per doc, listed until revoked, then a 404", () => {
    const db = freshDb()
    const s = createShare(db, "app", "plans/a.md")
    expect(s.token).toMatch(/^[\w-]{24}$/)
    expect(createShare(db, "app", "plans/a.md").token).toBe(s.token)
    expect(listShares(db).map((x) => x.token)).toEqual([s.token])
    revokeShare(db, s.token)
    expect(liveShare(db, s.token)).toBeNull()
    expect(listShares(db)).toEqual([])
    expect(() => revokeShare(db, s.token)).toThrow(HttpError)
    expect(createShare(db, "app", "plans/a.md").token).not.toBe(s.token)
  })
})

describe("docLinks", () => {
  const link = docLinks("app")
  test("a relative link in a todo body opens the doc under /r/, read from atlas/", () => {
    expect(link("plans/a b.html")).toBe("/r/app/plans/a%20b.html")
    expect(link("./atlas/plans/a.md#part")).toBe("/r/app/plans/a.md#part")
    expect(link("plans/../x.md")).toBe("/r/app/x.md")
  })

  test("leaves absolute, anchor and escaping links alone, and every link when the repo has no docs", () => {
    expect(link("https://e.com/a")).toBe("https://e.com/a")
    expect(link("#top")).toBe("#top")
    expect(link("/todos")).toBe("/todos")
    expect(link("../outside.md")).toBe("../outside.md")
    expect(link("javascript:alert(1)")).toBe("")
    expect(docLinks(null)("plans/a.md")).toBe("plans/a.md")
  })
})
