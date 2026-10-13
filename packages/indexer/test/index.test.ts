import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cp, mkdtemp, rename, rm, unlink, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DocIndex, ftsPhrase, ftsQuery, htmlText, lowWeight, MATCH_END, MATCH_START, mdText, watchDocs } from "../src/index.ts"

const NONE = { version: null, id: null, status: null, supersededBy: null, todo: null, repo: null, branch: null, pr: null, ticket: null, md: null }

describe("htmlText", () => {
  test("takes the title and tags, drops scripts, styles and svg, and decodes entities", () => {
    const doc = htmlText(
      `<html><head><title>Plan &amp; notes</title><meta name="tags" content="atlas, search"><style>p{color:red}</style></head>
       <body><script>var hidden = 1</script><svg><text>chart label</text></svg><p>First</p><p>second&nbsp;line &lt;ok&gt; &#x2192; done</p></body></html>`,
      "plan.html",
    )
    expect(doc).toEqual({ title: "Plan & notes", tags: "atlas, search", type: "", body: "First second line <ok> → done", contract: NONE })
  })

  test("falls back to the file name for a title", () => {
    expect(htmlText("<p>hi</p>", "page.html").title).toBe("page.html")
  })

  test("reads the doc type from its meta tag, lower-cased", () => {
    expect(htmlText('<head><meta name="doc-type" content="Plan"></head><p>hi</p>', "page.html").type).toBe("plan")
  })
})

describe("the doc contract", () => {
  test("an html doc's meta tags and atlas-md block; search reads the block instead of the page text", () => {
    const doc = htmlText(
      `<head><meta name="atlas-contract" content="1"><meta name="atlas-id" content="d_8f3k2q7m1x"><meta name="atlas-status" content="Superseded">
       <meta name="atlas-superseded-by" content="d_aaaaaaaaaa"><meta name="atlas-todo" content="510"><meta name="atlas-repo" content="atlas">
       <meta name="atlas-branch" content="phase-5"><meta name="atlas-pr" content="14"><meta name="atlas-ticket" content="ATL-3"></head>
       <body><p>Rendered words</p><script type="text/markdown" id="atlas-md">
# Plan

Uses </b> & <i> as written
</script></body>`,
      "plan.html",
    )
    expect(doc.contract).toEqual({ version: 1, id: "d_8f3k2q7m1x", status: "superseded", supersededBy: "d_aaaaaaaaaa", todo: 510, repo: "atlas", branch: "phase-5", pr: "14", ticket: "ATL-3", md: "# Plan\n\nUses </b> & <i> as written" })
    expect(doc.body).toBe(doc.contract.md!)
  })

  test("reads the older markdown block ids, and atlas-md wins over them", () => {
    for (const id of ["md-source", "md", "source-md", "mdSource"]) expect(htmlText(`<script type="text/plain" id="${id}"># Old</script>`, "x.html").contract.md).toBe("# Old")
    expect(htmlText(`<script id="md-source"># Old</script><script type="text/markdown" id="atlas-md"># New</script>`, "x.html").contract.md).toBe("# New")
    expect(htmlText(`<script id="other"># Not it</script><p>Page</p>`, "x.html")).toMatchObject({ body: "Page", contract: { md: null } })
  })

  test("drops values the contract does not allow", () => {
    const doc = htmlText(`<meta name="atlas-id" content="d_SHORT"><meta name="atlas-status" content="maybe"><meta name="atlas-todo" content="#0"><meta name="atlas-contract" content="v1">`, "x.html")
    expect(doc.contract).toEqual(NONE)
  })

  test("markdown frontmatter carries the same fields", () => {
    const md = "---\natlas-id: d_harbour001\nstatus: active\nsuperseded-by: 'd_bbbbbbbbbb'\ntodo: \"#42\"\nrepo: atlas\nbranch: main\npr: 7\nticket: ATL-9\n---\n\n# Notes"
    expect(mdText(md, "n.md").contract).toEqual({ version: null, id: "d_harbour001", status: "active", supersededBy: "d_bbbbbbbbbb", todo: 42, repo: "atlas", branch: "main", pr: "7", ticket: "ATL-9", md: null })
  })
})

describe("mdText", () => {
  test("reads the title and tags from frontmatter and leaves it out of the body", () => {
    const doc = mdText("---\ntitle: The runbook\ntags: atlas, deploy\n---\n\n# Heading\n\nBody text", "runbook.md")
    expect(doc).toEqual({ title: "The runbook", tags: "atlas, deploy", type: "", body: "# Heading\n\nBody text", contract: NONE })
    expect(mdText("---\ndoc-type: reference\n---\n\n# R", "r.md").type).toBe("reference")
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
    expect(index.facets("ibis")).toMatchObject({ total: 3, repo: { alpha: 2, beta: 1 }, folder: { plans: 1, ".": 1, notes: 1 } })
    // Each facet is counted with the other filters, so a picked repo still shows the other repo's count.
    expect(index.facets("ibis", { repo: ["alpha"] })).toMatchObject({ total: 2, repo: { alpha: 2, beta: 1 }, folder: { plans: 1, ".": 1 } })
    expect(index.search("ibis", { folder: ["."] }).map((h) => h.path)).toEqual(["top.md"])
    const day = Date.now() - 86_400_000
    expect(index.search("ibis", { after: day }).map((h) => h.repo)).toEqual(["alpha", "alpha"])
    expect(index.recent({ folder: ["notes"] }).map((h) => h.path)).toEqual(["notes/old.md"])
    expect(index.facets("", { after: day }).total).toBe(2)
    expect(index.facets("- *")).toEqual({ total: 0, repo: {}, folder: {}, type: {}, tag: {} })
  })

  test("filters by type and tag, counts both, and keeps tags current when a doc changes", async () => {
    await write("alpha/plan.md", "---\ndoc-type: plan\ntags: Atlas, search\n---\n\n# Plan\n\nthe ibis")
    await write("alpha/plan.html", '<title>Plan</title><meta name="doc-type" content="plan"><meta name="tags" content="atlas, search"><p>the ibis</p>')
    await write("alpha/ref.html", '<title>Ref</title><meta name="doc-type" content="reference"><meta name="tags" content="atlas"><p>the ibis</p>')
    await write("beta/note.md", "# Note\n\nthe ibis")
    await index.sync()
    // Twins count once; a doc without a doc-type counts under "none"; tags are lower-cased.
    expect(index.facets("ibis")).toMatchObject({ total: 3, type: { plan: 1, reference: 1, none: 1 }, tag: { atlas: 2, search: 1 } })
    expect(index.search("ibis", { type: ["reference", "none"] }).map((h) => h.path).sort()).toEqual(["note.md", "ref.html"])
    expect(index.recent({ tag: ["search"] }).map((h) => h.path)).toEqual(["plan.html"])
    // Type and tag together must both match.
    expect(index.recent({ type: ["plan"], tag: ["atlas"] }).map((h) => h.path)).toEqual(["plan.html"])
    expect(index.facets("", { tag: ["atlas"] })).toMatchObject({ total: 2, type: { plan: 1, reference: 1 }, tag: { atlas: 2, search: 1 } })
    expect(index.list({ type: ["plan"] }).map((d) => `${d.path} ${d.type} ${d.tags}`).sort()).toEqual(["plan.html plan atlas, search", "plan.md plan Atlas, search"])
    expect(index.overview(Date.now(), { type: ["reference"] })).toMatchObject([{ repo: "alpha", docs: 1 }])

    await write("alpha/ref.html", '<title>Ref</title><meta name="doc-type" content="reference"><meta name="tags" content="ops"><p>the ibis</p>')
    await utimes(join(root, "alpha/ref.html"), new Date(), new Date(Date.now() + 5000))
    await index.sync()
    expect(index.facets("").tag).toEqual({ atlas: 1, search: 1, ops: 1 })
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

  test("finds a doc by its id after a move, and counts an id two docs hold as none", async () => {
    await write("alpha/plan.html", '<meta name="atlas-id" content="d_aaaaaaaaaa"><title>Plan</title>')
    await write("alpha/plan.md", "---\natlas-id: d_aaaaaaaaaa\n---\n# Plan")
    await write("alpha/notes.md", "---\natlas-id: d_bbbbbbbbbb\n---\n# Notes")
    await index.sync()
    expect(index.byId("d_aaaaaaaaaa")).toMatchObject({ repo: "alpha", path: "plan.html" })
    await rename(join(root, "alpha/notes.md"), join(root, "alpha/kept-notes.md"))
    await index.sync()
    expect(index.byId("d_bbbbbbbbbb")).toMatchObject({ path: "kept-notes.md" })
    expect(index.byId("d_cccccccccc")).toBeNull()
    expect(index.duplicateIds()).toEqual([])

    await write("beta/copy.md", "---\natlas-id: d_bbbbbbbbbb\n---\n# Copy")
    await index.sync()
    expect(index.byId("d_bbbbbbbbbb")).toBeNull()
    expect(index.duplicateIds()).toEqual([{ id: "d_bbbbbbbbbb", docs: [{ repo: "alpha", path: "kept-notes.md", title: "Notes" }, { repo: "beta", path: "copy.md", title: "Copy" }] }])
    expect(index.ids().sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { repo: "alpha", path: "plan.html", id: "d_aaaaaaaaaa" },
      { repo: "alpha", path: "plan.md", id: "d_aaaaaaaaaa" },
    ])
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
