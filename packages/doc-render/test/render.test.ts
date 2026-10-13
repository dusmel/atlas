import { describe, expect, test } from "bun:test"
import { frontmatter, renderMarkdownPage } from "../src/index.ts"

const body = (html: string) => html.slice(html.indexOf("<body>"), html.indexOf('<script type="text/markdown"'))

describe("renderMarkdownPage", () => {
  test("a bare note with no frontmatter takes its title from the first heading", () => {
    const { title, html } = renderMarkdownPage("# Harbour notes\n\nShips wait for the tide.", "harbour.md")
    expect(title).toBe("Harbour notes")
    expect(html).toContain("<title>Harbour notes</title>")
    expect(body(html)).toContain("<h1>Harbour notes</h1>")
    expect(body(html)).not.toContain("# Harbour notes")
    expect(html).not.toContain('class="props"')
  })

  test("a note with no heading at all is titled by its file name", () => {
    expect(renderMarkdownPage("Just a line.", "loose.md").title).toBe("loose.md")
  })

  test("frontmatter gives the title, the metadata block and the type; unknown keys and odd lines are ignored", () => {
    const md = "---\ntitle: \"Lighthouse plan\"\ntype: plan\ntags: keeper, lamp\nmood: calm\nnot a key line\n---\n\n# Other heading\n\nText."
    const { title, html } = renderMarkdownPage(md, "x.md")
    expect(title).toBe("Lighthouse plan")
    expect(html).toContain('<meta name="doc-type" content="plan">')
    expect(body(html)).toContain("<dt>Tags</dt><dd>keeper, lamp</dd>")
    expect(body(html)).not.toContain("mood")
    expect(frontmatter(md).front).toEqual({ title: "Lighthouse plan", "doc-type": "plan", tags: "keeper, lamp", mood: "calm" })
  })

  test("TL;DR, callouts and heading ids, including {#id} that starts with a digit", () => {
    const md = "# T\n\nTL;DR: the short version.\n\n## 1. Goal {#1-goal}\n\n> [!WARNING]\n> Mind the rocks.\n\n## Goal\n\n## Goal"
    const page = body(renderMarkdownPage(md, "t.md").html)
    expect(page).toContain('<div class="tldr"><strong>TL;DR:</strong> the short version.</div>')
    expect(page).toContain('<h2 id="1-goal">1. Goal</h2>')
    expect(page).not.toContain("{#")
    expect(page).toContain('<div class="callout warn">')
    expect(page).toContain('<h2 id="goal">Goal</h2>')
    expect(page).toContain('<h2 id="goal-1">Goal</h2>')
  })

  test("four sections or more get a contents list, with each section's subsections under it", () => {
    const md = "# T\n\n## One\n\n### One a\n\n## Two\n\n## Three\n\n### Three a\n\n#### Deep\n\n## Four"
    const toc = /<nav class="toc"[\s\S]*?<\/nav>/.exec(renderMarkdownPage(md, "t.md").html)![0]
    expect([...toc.matchAll(/<a (?:class="(\w+)" )?href="#([\w-]+)">/g)].map((m) => `${m[1] ?? ""}#${m[2]}`)).toEqual(["#one", "sub#one-a", "#two", "#three", "sub#three-a", "#four"])
    expect(renderMarkdownPage("# T\n\n## One\n\n## Two", "t.md").html).not.toContain('class="toc"')
  })

  test("a Related section of links becomes the footer the frame lifts into its toolbar", () => {
    const md = "# T\n\nText.\n\n## Related\n\n- [Plan](plan.html) — the steps\n- [Notes](notes.md)"
    const page = body(renderMarkdownPage(md, "t.md").html)
    expect(page).toContain('<section class="related" id="related" data-atlas-chrome>')
    expect(page).toContain('<nav data-atlas-related><ul>\n<li><a href="plan.html">Plan</a><span class="why">the steps</span></li>')
    // A Related section with prose in it stays a plain section.
    expect(body(renderMarkdownPage("# T\n\n## Related\n\nSee the plan.", "t.md").html)).toContain('<h2 id="related">Related</h2>')
  })

  test("the markdown rides along for agents and Copy as Markdown, with </script> unable to end the block", () => {
    const md = "# T\n\n```html\n</script><b>x</b>\n```"
    const html = renderMarkdownPage(md, "t.md").html
    const block = /<script type="text\/markdown" id="atlas-md">\n([\s\S]*?)<\/script>/.exec(html)![1]
    expect(block).toBe("# T\n\n```html\n<\\/script><b>x</b>\n```")
  })
})
