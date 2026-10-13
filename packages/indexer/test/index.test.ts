import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cp, mkdtemp, rename, rm, unlink, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DocIndex, ftsPhrase, ftsQuery, htmlText, lowWeight, MATCH_END, MATCH_START, mdText, watchDocs } from "../src/index.ts"

describe("htmlText", () => {
  test("takes the title and tags, drops scripts, styles and svg, and decodes entities", () => {
    const doc = htmlText(
      `<html><head><title>Plan &amp; notes</title><meta name="tags" content="atlas, search"><style>p{color:red}</style></head>
       <body><script>var hidden = 1</script><svg><text>chart label</text></svg><p>First</p><p>second&nbsp;line &lt;ok&gt; &#x2192; done</p></body></html>`,
      "plan.html",
    )
    expect(doc).toEqual({ title: "Plan & notes", tags: "atlas, search", body: "First second line <ok> → done" })
  })

  test("falls back to the file name for a title", () => {
    expect(htmlText("<p>hi</p>", "page.html").title).toBe("page.html")
  })
})

describe("mdText", () => {
  test("reads the title and tags from frontmatter and leaves it out of the body", () => {
    const doc = mdText("---\ntitle: The runbook\ntags: atlas, deploy\n---\n\n# Heading\n\nBody text", "runbook.md")
    expect(doc).toEqual({ title: "The runbook", tags: "atlas, deploy", body: "# Heading\n\nBody text" })
  })

  test("uses the first heading, then the file name", () => {
    expect(mdText("intro\n\n# Real title\n\n## Sub", "a.md").title).toBe("Real title")
    expect(mdText("no heading here", "a.md").title).toBe("a.md")
  })
})

describe("ftsQuery", () => {
  test("quotes every term and makes the last one a prefix", () => {
    expect(ftsQuery('foo OR "bar" NEAR(')).toBe('"foo" "OR" """bar""" "NEAR("*')
    expect(ftsQuery("  ")).toBeNull()
    expect(ftsQuery("- * :")).toBeNull()
  })
})

describe("DocIndex", () => {
  let root: string
  let index: DocIndex
  const write = (path: string, text: string) => Bun.write(join(root, path), text)

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "atlas-index-"))
    index = new DocIndex(root)
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  test("detects added, changed, deleted and renamed files", async () => {
    await write("alpha/plan.md", "# Plan\n\nThe zebra crossing")
    await write("alpha/notes.html", "<title>Notes</title><p>Kept as is</p>")
    expect(await index.sync()).toMatchObject({ docs: 2, md: 1, html: 1, added: 2, changed: 0, removed: 0 })
    expect(await index.sync()).toMatchObject({ added: 0, changed: 0, removed: 0 })

    await write("alpha/plan.md", "# Plan\n\nThe giraffe crossing")
    await utimes(join(root, "alpha/plan.md"), new Date(), new Date(Date.now() + 5000))
    expect(await index.sync()).toMatchObject({ changed: 1 })
    expect(index.search("zebra")).toEqual([])
    expect(index.search("giraffe").map((h) => h.path)).toEqual(["plan.md"])

    await rename(join(root, "alpha/plan.md"), join(root, "alpha/renamed.md"))
    expect(await index.sync()).toMatchObject({ docs: 2, added: 1, removed: 1 })
    expect(index.search("giraffe").map((h) => h.path)).toEqual(["renamed.md"])

    await unlink(join(root, "alpha/notes.html"))
    expect(await index.sync()).toMatchObject({ docs: 1, md: 1, html: 0, removed: 1 })
  })

  test("ranks a title match first, filters by repo and marks matches in the snippet", async () => {
    await write("alpha/body.md", "# Other\n\nA long note that mentions kestrel once among many other words.")
    await write("beta/title.md", "# Kestrel field guide\n\nBirds.")
    await index.sync()
    const hits = index.search("kestrel")
    expect(hits.map((h) => `${h.repo}/${h.path}`)).toEqual(["beta/title.md", "alpha/body.md"])
    expect(hits[1]!.snippet).toContain(`${MATCH_START}kestrel${MATCH_END}`)
    expect(index.search("kestrel", { repo: ["alpha"] }).map((h) => h.repo)).toEqual(["alpha"])
  })

  test("puts docs holding the exact phrase before docs holding the words apart", async () => {
    await write("alpha/apart.md", "# Steps\n\nYou can do ten things, only steps matter. Ten steps, only you, can do.")
    await write("alpha/phrase.md", "# Runbook\n\nTen steps only you can do, most of them in Phase 1.")
    await index.sync()
    expect(index.search("ten steps only you can do").map((h) => h.path)).toEqual(["phrase.md", "apart.md"])
    expect(ftsPhrase('say "hi" there')).toBe('"say ""hi"" there"*')
  })

  test("a doc whose title or path holds every word beats docs that only link to it", async () => {
    // The 2026-10-13 case: "web v1 spec" ranked the spec 7th, behind docs linking atlas-web-v1-spec.html.
    await write("atlas/atlas-web-v1-spec.html", "<title>Atlas Web v1: build spec</title><p>Data model and API.</p>")
    await write("atlas/atlas-web-v1/report.md", "# Run report\n\nRead [the spec](../atlas-web-v1-spec.html) and the web v1 spec again.")
    await write("atlas/notes/paths.md", "# Notes\n\nNothing here.")
    await index.sync()
    expect(index.search("web v1 spec").map((h) => h.path)).toEqual(["atlas-web-v1-spec.html", "atlas-web-v1/report.md"])
    expect(index.search("notes paths").map((h) => h.path)).toEqual(["notes/paths.md"])
  })

  test("docs in evidence, trash, legacy and similar folders rank after the rest in each tier", async () => {
    await write("alpha/evidence/phase-5/plover.md", "# Plover plan\n\nthe plover")
    await write("alpha/legacy-notes/plover.md", "# Plover plan\n\nthe plover")
    await write("alpha/plans/plover.md", "# Plover plan\n\nthe plover")
    await index.sync()
    const paths = index.search("plover plan").map((h) => h.path)
    expect(paths[0]).toBe("plans/plover.md")
    expect(paths.slice(1).sort()).toEqual(["evidence/phase-5/plover.md", "legacy-notes/plover.md"])
    expect(lowWeight("trash/notes/a.md")).toBe(true)
    expect(lowWeight("evidence.md")).toBe(false)
  })

  test("matches the last word as a prefix and never errors on FTS syntax", async () => {
    await write("alpha/a.md", "# Indexer\n\nWatches the folder")
    await index.sync()
    expect(index.search("watch fold").map((h) => h.path)).toEqual(["a.md"])
    expect(index.search('AND OR NOT "( NEAR')).toEqual([])
  })

  test("rebuild reads every file again and repos counts per folder", async () => {
    await write("alpha/a.md", "# A\n\nthe osprey")
    await write("beta/b.md", "# B")
    await index.sync()
    expect(await index.rebuild()).toMatchObject({ docs: 2, added: 2, removed: 0 })
    expect(index.search("osprey")).toHaveLength(1)
    expect(index.repos()).toEqual([{ name: "alpha", docs: 1 }, { name: "beta", docs: 1 }])
  })

  test("shows a doc kept as both md and html once", async () => {
    await write("alpha/plan.md", "# Plan\n\nthe heron")
    await write("alpha/plan.html", "<title>Plan</title><p>the heron</p>")
    await index.sync()
    expect(index.counts()).toEqual({ docs: 2, md: 1, html: 1 })
    expect(index.search("heron")).toHaveLength(1)
  })

  test("a doc kept as both md and html shows as the html, even when the md ranks higher", async () => {
    // The md holds the words in its title, the html only in its text, so the md ranks first.
    await write("alpha/heron-notes.md", "# Heron survey\n\nCounts by month.")
    await write("alpha/heron-notes.html", "<title>Wading birds</title><p>heron survey counts</p>")
    await write("alpha/other.md", "# Other\n\nheron survey mentioned once")
    await index.sync()
    const hits = index.search("heron survey")
    expect(hits.map((h) => [h.path, h.kind, h.title])).toEqual([["heron-notes.html", "html", "Wading birds"], ["other.md", "md", "Other"]])
    expect(index.htmlTwin("alpha", "heron-notes.md")?.path).toBe("heron-notes.html")
    expect(index.htmlTwin("alpha", "other.md")).toBeNull()
  })

  test("recent lists the newest docs first, filters by repo and shows twins once", async () => {
    await write("alpha/old.md", "# Old")
    await write("alpha/new.md", "# New")
    await write("alpha/new.html", "<title>New</title>")
    await write("beta/mid.md", "# Mid")
    const at = (s: number) => new Date(Date.now() - s * 1000)
    await utimes(join(root, "alpha/old.md"), at(300), at(300))
    await utimes(join(root, "beta/mid.md"), at(200), at(200))
    // Same time for both twins, so the tie falls to path order and html is kept.
    await utimes(join(root, "alpha/new.md"), at(100), at(100))
    await utimes(join(root, "alpha/new.html"), at(100), at(100))
    await index.sync()
    expect(index.recent().map((h) => `${h.repo}/${h.path}`)).toEqual(["alpha/new.html", "beta/mid.md", "alpha/old.md"])
    expect(index.recent({ repo: ["alpha"], limit: 1 }).map((h) => h.title)).toEqual(["New"])
    expect(index.recent()[0]!.snippet).toBe("")
  })

  test("filters by folder and change time, and counts matches per repo and folder", async () => {
    await write("alpha/plans/a.md", "# A\n\nthe ibis")
    await write("alpha/plans/a.html", "<title>A</title><p>the ibis</p>")
    await write("alpha/top.md", "# Top\n\nthe ibis")
    await write("beta/notes/old.md", "# Old\n\nthe ibis")
    const old = new Date(Date.now() - 3 * 86_400_000)
    await utimes(join(root, "beta/notes/old.md"), old, old)
    await index.sync()
    expect(index.facets("ibis")).toEqual({ total: 3, repo: { alpha: 2, beta: 1 }, folder: { plans: 1, ".": 1, notes: 1 } })
    // Each facet is counted with the other filters, so a picked repo still shows the other repo's count.
    expect(index.facets("ibis", { repo: ["alpha"] })).toEqual({ total: 2, repo: { alpha: 2, beta: 1 }, folder: { plans: 1, ".": 1 } })
    expect(index.search("ibis", { folder: ["."] }).map((h) => h.path)).toEqual(["top.md"])
    const day = Date.now() - 86_400_000
    expect(index.search("ibis", { after: day }).map((h) => h.repo)).toEqual(["alpha", "alpha"])
    expect(index.recent({ folder: ["notes"] }).map((h) => h.path)).toEqual(["notes/old.md"])
    expect(index.facets("", { after: day }).total).toBe(2)
    expect(index.facets("- *")).toEqual({ total: 0, repo: {}, folder: {} })
  })

  test("overview counts per repo, twins once, and calls onSync after each sync", async () => {
    const synced: number[] = []
    index.onSync = (r) => synced.push(r.added)
    await write("alpha/plans/a.md", "# A")
    await write("alpha/plans/a.html", "<title>A</title>")
    await write("alpha/plans/b.md", "# B")
    await write("alpha/top.md", "# Top")
    const old = new Date(Date.now() - 90 * 86_400_000)
    await utimes(join(root, "alpha/top.md"), old, old)
    await index.sync()
    expect(synced).toEqual([4])
    expect(index.files()).toHaveLength(4)
    const [alpha] = index.overview()
    expect(alpha).toMatchObject({ repo: "alpha", docs: 3, md: 3, html: 1, week: 2, stale: 1, folders: [{ folder: "plans", docs: 2 }, { folder: ".", docs: 1 }] })
  })

  test("moveTo indexes another folder in place and keeps unchanged files", async () => {
    await write("alpha/same.md", "# Same\n\nthe heron")
    await write("alpha/only-mega.md", "# Mega\n\nthe stork")
    await index.sync()
    const other = await mkdtemp(join(tmpdir(), "atlas-index-"))
    try {
      await cp(root, other, { recursive: true, preserveTimestamps: true })
      await unlink(join(other, "alpha/only-mega.md"))
      await Bun.write(join(other, "alpha/only-pushed.md"), "# Pushed\n\nthe crane")
      expect(await index.moveTo(other)).toMatchObject({ docs: 2, added: 1, changed: 0, removed: 1 })
      expect(index.root).toBe(other)
      expect(index.search("crane").map((h) => h.path)).toEqual(["only-pushed.md"])
      expect(index.search("stork")).toEqual([])
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  test("the watcher picks up a new file", async () => {
    await index.sync()
    const stop = watchDocs(index, { debounceMs: 50 })
    try {
      await write("alpha/deep/new.md", "# New\n\nthe pelican")
      for (let i = 0; i < 40 && !index.search("pelican").length; i++) await Bun.sleep(50)
      expect(index.search("pelican").map((h) => h.path)).toEqual(["deep/new.md"])
    } finally {
      stop()
    }
  })
})
