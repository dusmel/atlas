import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { htmlText, mdText } from "../../packages/indexer/src/index.ts"
import { checkDocs } from "../docs-check.ts"
import { localStamp, planCreated, selfCheck as createdCheck } from "../docs-created.ts"
import { planMigration, selfCheck, withoutContract, writePlan } from "../docs-migrate.ts"

// An md-render page: its markdown block holds the same tags as raw html, which must stay as they are.
const RENDERED = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lamp rota</title>
<meta name="doc-type" content="plan">
</head>
<body>
<header class="topbar">
  <span class="name">Lamp rota</span>
  <a href="../index.html" title="Index"><img src="data:," alt=""></a>
  <button id="theme" type="button">☾</button>
</header>
<main>
<details class="props" open>
  <summary>Metadata</summary>
  <dl>
    <div><dt>Repo</dt><dd>web</dd></div>
    <div><dt>Branch</dt><dd><code>lamp/rota</code></dd></div>
    <div><dt>PR</dt><dd><a href="https://example.com/pull/7">PR 7</a></dd></div>
    <div><dt>Ticket</dt><dd class="empty">—</dd></div>
  </dl>
</details>
<figure class="diagram"><svg></svg><figcaption>Rota</figcaption></figure>
<section class="related" id="related"><h2>Related</h2><ul><li><a href="tides.html">Tides</a></li></ul></section>
</main>
<script type="text/plain" id="md-source">
---
title: Lamp rota
doc-type: plan
---

<figure class="diagram"><svg></svg></figure>
<header class="topbar"></header>
</script>
</body>
</html>
`
const RENDERED_MD = "---\ntitle: Lamp rota\ndoc-type: plan\ntags: lamps, ops\n---\n\n# Lamp rota\n"
// Handwritten: unquoted attributes, the toggle outside its bar, Related in a nav, an md twin with no frontmatter.
const HANDWRITTEN = `<html><head><title>Tides</title></head><body>
<div class=topbar  data-x='1'><a href=index.html>home</a></div>
<button class="btn" id="themeBtn" onclick="document.body.classList.toggle('dark')">◐</button>
<nav id=related><a href="lamps.html">Lamps</a></nav>
</body></html>
`
// Some handwritten bars hold the h1: hiding the bar in the frame would hide the title.
const TITLE_IN_BAR = `<html><head><title>Ports</title></head><body><div class="topbar"><h1>Ports</h1><a href="index.html">i</a></div></body></html>`
const OWN_ID = `<html><head><title>Charts</title><meta name="atlas-id" content="d_charts0001"></head><body></body></html>`
const HEADLESS = `<p>Just a fragment</p>`

describe("docs:migrate and docs:check", () => {
  let root: string
  const put = (path: string, text: string) => Bun.write(join(root, path), text)
  const read = (path: string) => readFileSync(join(root, path), "utf8")

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "atlas-migrate-"))
    await put("web/plans/lamps.html", RENDERED)
    await put("web/plans/lamps.md", RENDERED_MD)
    await put("web/tides.html", HANDWRITTEN)
    await put("web/tides.md", "# Tides\n\nNo frontmatter.\n")
    await put("web/charts.html", OWN_ID)
    await put("web/charts.md", "---\ntitle: Charts\n---\n# Charts\n")
    await put("web/fragment.html", HEADLESS)
    await put("web/ports.html", TITLE_IN_BAR)
    await put("web/notes.md", "# Notes\n")
    await put("web/index.html", "<html><head><title>atlas /</title></head></html>")
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test("migrate changes no text, layout or script: each file minus the additions is the file before", async () => {
    const plan = await planMigration(root)
    expect(plan.changes.map((c) => c.file.path).sort()).toEqual(["charts.md", "plans/lamps.html", "plans/lamps.md", "ports.html", "tides.html"])
    for (const c of plan.changes) {
      // Both sides lose the doc's own `doc-type` and `tags` metas, so compare them stripped alike.
      expect(withoutContract(c.text)).toBe(withoutContract(c.before))
      expect(selfCheck(c)).toBeNull()
    }
    expect(withoutContract(plan.changes.find((c) => c.file.path === "tides.html")!.text)).toBe(HANDWRITTEN)
    const lamps = plan.changes.find((c) => c.file.path === "plans/lamps.html")!
    expect(lamps.added).toEqual([
      expect.stringMatching(/^meta atlas-id = d_[a-z0-9]{10}$/),
      "meta atlas-repo = web",
      "meta atlas-branch = lamp/rota",
      "meta atlas-pr = https://example.com/pull/7",
      "meta tags = lamps, ops",
      'data-atlas-chrome on <header class="topbar">',
      'data-atlas-home on <a href="../index.html">',
      'data-atlas-diagram on <figure class="diagram">',
      'data-atlas-chrome data-atlas-related on <section class="related" id="related">',
    ])
    // The markdown block is a script: its raw tags are text and keep no markers.
    const block = (s: string) => s.slice(s.indexOf('<script type="text/plain"'))
    expect(block(lamps.text)).toBe(block(RENDERED))

    const tides = plan.changes.find((c) => c.file.path === "tides.html")!
    expect(tides.text).toContain("<div data-atlas-chrome class=topbar  data-x='1'><a data-atlas-home href=index.html>")
    expect(tides.text).toContain('<button data-atlas-chrome class="btn" id="themeBtn"')
    expect(tides.text).toContain("<nav data-atlas-chrome data-atlas-related id=related>")

    expect(plan.changes.find((c) => c.file.path === "ports.html")!.added).toEqual([expect.stringMatching(/^meta atlas-id = /), 'data-atlas-home on <a href="index.html">'])

    // Twins share one id; a doc's own id goes to its twin.
    const id = (path: string) => htmlText(plan.changes.find((c) => c.file.path === path)?.text ?? read(path), path).contract.id
    expect(plan.changes.find((c) => c.file.path === "plans/lamps.md")!.text).toContain(`atlas-id: ${id("plans/lamps.html")}\n---`)
    expect(plan.changes.find((c) => c.file.path === "charts.md")!.text).toBe("---\ntitle: Charts\natlas-id: d_charts0001\n---\n# Charts\n")
    expect(plan.skipped.map((s) => [s.file.path, s.why])).toEqual([
      ["fragment.html", "an html with no <head>, so no id or trail"],
      ["notes.md", "an md with no frontmatter, so no id"],
      ["ports.html", "an html whose top bar holds its h1, so the bar stays in the frame"],
      ["tides.md", "an md with no frontmatter; its html twin holds the id"],
    ])
  })

  test("--write backs up each file, keeps its times, and a second run finds nothing to add", async () => {
    const old = new Date("2026-01-02T03:04:05Z")
    utimesSync(join(root, "web/tides.html"), old, old)
    const backup = join(root, "..", `${root.split("/").at(-1)}-backup`)
    try {
      const plan = await planMigration(root)
      await writePlan(root, plan, backup)
      expect(readFileSync(join(backup, "web/tides.html"), "utf8")).toBe(HANDWRITTEN)
      expect(read("web/tides.html")).toBe(plan.changes.find((c) => c.file.path === "tides.html")!.text)
      expect(statSync(join(root, "web/tides.html")).mtime.toISOString()).toBe(old.toISOString())
      expect((await planMigration(root)).changes).toEqual([])
      expect((await checkDocs(root)).errors).toEqual([])
    } finally {
      rmSync(backup, { recursive: true, force: true })
    }
  })

  test("check reports values the contract does not allow, shared ids, split twins and a missing successor", async () => {
    await put("web/charts.md", "---\natlas-id: d_other00001\nstatus: wip\nsuperseded-by: d_nowhere001\n---\n")
    await put("web/copy.html", `<html><head><meta name="atlas-id" content="d_charts0001"><meta name="atlas-todo" content="soon"><meta name="atlas-contract" content="1"></head></html>`)
    const { errors } = await checkDocs(root)
    expect(errors.sort()).toEqual([
      "d_charts0001 is held by 2 docs: web/charts, web/copy",
      'web/charts.md: status "wip" is not allowed',
      "web/charts.md: superseded by d_nowhere001, which no doc holds",
      "web/charts: the md and the html hold different ids, d_charts0001 and d_other00001",
      'web/copy.html: atlas-todo "soon" is not allowed',
      "web/copy.html: says atlas-contract 1 but never listens for atlas:theme, so the frame can't theme it",
    ])
    expect((await planMigration(root)).conflicts.map((c) => c.ids.sort())).toEqual([["d_charts0001", "d_other00001"]])
  })
})

describe("docs:created", () => {
  let root: string
  const put = (path: string, text: string) => Bun.write(join(root, path), text)
  const read = (path: string) => readFileSync(join(root, path), "utf8")
  const born = (path: string) => localStamp(statSync(join(root, path)).birthtime)

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "atlas-created-"))
    await put("web/plain.md", "# Plain\n\nNo frontmatter.\n")
    await put("web/fronted.md", "---\ntitle: Fronted\ntags: a, b\n---\n\n# Fronted\n")
    await put("web/old.md", "---\ntitle: Old\ndate: 2020-01-02\nrepo: web\n---\n\n# Old\n")
    await put("web/page.html", "<html><head><title>Page</title><meta name=\"date\" content=\"2020-03-04\"></head><body><p>hi</p></body></html>")
    await put("web/fragment.html", "<title>Fragment</title><p>no head</p>")
    await put("web/twin.md", "---\ntitle: Twin\ncreated: 2026-10-01T09:30+02:00\n---\n# Twin\n")
    await put("web/twin.html", "<html><head><title>Twin</title></head><body></body></html>")
    await put("web/done.md", "---\ncreated: 2026-05-06T07:08+02:00\n---\n# Done\n")
    await put("web/bad.md", "---\ncreated: last tuesday\n---\n# Bad\n")
    await put("web/index.html", "<html><head><title>atlas /</title></head></html>")
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test("each doc gets the file's creation time, an earlier date as the day, or its twin's time", async () => {
    const plan = await planCreated(root)
    const got = Object.fromEntries(plan.changes.map((c) => [c.file.path, [c.created, c.from]]))
    expect(got).toEqual({
      "plain.md": [born("web/plain.md"), "file"],
      "fronted.md": [born("web/fronted.md"), "file"],
      "old.md": ["2020-01-02", "date"],
      "page.html": ["2020-03-04", "date"],
      "fragment.html": [born("web/fragment.html"), "file"],
      "twin.html": ["2026-10-01T09:30+02:00", "twin"],
    })
    expect(plan.skipped.map((s) => s.file.path)).toEqual(["bad.md"])
    expect(born("web/plain.md")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  test("it adds one line and nothing else, where each kind of doc keeps it", async () => {
    const plan = await planCreated(root)
    const text = (path: string) => plan.changes.find((c) => c.file.path === path)!.text
    expect(text("plain.md")).toBe(`---\ncreated: ${born("web/plain.md")}\n---\n# Plain\n\nNo frontmatter.\n`)
    expect(text("fronted.md")).toBe(`---\ntitle: Fronted\ntags: a, b\ncreated: ${born("web/fronted.md")}\n---\n\n# Fronted\n`)
    expect(text("old.md")).toBe("---\ntitle: Old\ndate: 2020-01-02\ncreated: 2020-01-02\nrepo: web\n---\n\n# Old\n")
    expect(text("page.html")).toContain('<meta name="date" content="2020-03-04"><meta name="created" content="2020-03-04">\n</head>')
    expect(text("fragment.html").startsWith(`<meta name="created" content="${born("web/fragment.html")}">\n<title>`)).toBe(true)
    expect(plan.changes.map(createdCheck)).toEqual(plan.changes.map(() => null))
    expect(mdText(text("plain.md"), "plain.md").body).toBe("# Plain\n\nNo frontmatter.")
  })

  test("--write keeps each file's times, and a second run finds nothing to add", async () => {
    const old = new Date("2026-01-02T03:04:05Z")
    utimesSync(join(root, "web/page.html"), old, old)
    const backup = join(root, "..", `${root.split("/").at(-1)}-backup`)
    try {
      const { writePlan } = await import("../docs-migrate.ts")
      const plan = await planCreated(root)
      await writePlan(root, { changes: plan.changes, skipped: [], conflicts: [] }, backup)
      expect(statSync(join(root, "web/page.html")).mtime.toISOString()).toBe(old.toISOString())
      expect(htmlText(read("web/page.html"), "page.html").created).toEqual({ ms: Date.parse("2020-03-04T00:00Z"), day: true })
      expect((await planCreated(root)).changes).toEqual([])
      expect((await checkDocs(root)).errors).toEqual(['web/bad.md: created "last tuesday" is not like 2026-10-26T09:41+02:00'])
    } finally {
      rmSync(backup, { recursive: true, force: true })
    }
  })
})
