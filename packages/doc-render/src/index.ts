import { PAGE_CSS } from "./style.ts"

// A markdown doc as a page in md-render's look (the html-docs skill), for docs with no html twin.
// md-render checks a doc strictly as it writes one. Here every rule is lenient: any md renders.

export type Page = { title: string; html: string }

const MD_OPTS = { autolinks: { url: true, www: true, email: true } }
const FONTS = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Lora:wght@600;700&family=JetBrains+Mono:wght@400&display=swap"
const HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0"
const PROPS: [string, string][] = [
  ["Type", "doc-type"],
  ["Tags", "tags"],
  ["Date", "date"],
  ["Repo", "repo"],
  ["Branch", "branch"],
  ["PR", "pr"],
  ["Ticket", "ticket"],
  ["Source", "source"],
]
const ALERTS: Record<string, string> = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Important", WARNING: "Warning", CAUTION: "Caution" }

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
/** md-render's slug, so #anchors match the docs it wrote. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section"
const inline = (md: string) =>
  Bun.markdown
    .html(md, MD_OPTS)
    .trim()
    .replace(/^<p>([\s\S]*)<\/p>$/, "$1")

/** `key: value` lines between `---` fences. Anything else in them is skipped, not an error. */
export function frontmatter(md: string): { front: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (!m) return { front: {}, body: md }
  const front: Record<string, string> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]!.toLowerCase() === "type" ? "doc-type" : kv[1]!.toLowerCase()
    front[key] = kv[2]!.trim().replace(/^(["'])(.*)\1$/, "$2")
  }
  return { front, body: md.slice(m[0].length) }
}

/** Lines with a flag for "inside a fenced code block", so headings in code are left alone. */
function scan(body: string) {
  let fence = ""
  return body.split("\n").map((line) => {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1]
    const inCode = fence !== "" || !!f
    if (f && !fence) fence = f[0]!.repeat(f.length)
    else if (f && fence && f.startsWith(fence)) fence = ""
    return { line, inCode }
  })
}

type Related = { text: string; href: string; why: string }

// The last "## Related" becomes the footer when every line in it is a link item.
function splitRelated(lines: ReturnType<typeof scan>): { lines: ReturnType<typeof scan>; related: Related[] } {
  const at = lines
    .map((l, i) => (!l.inCode && /^##\s+Related\s*$/i.test(l.line) ? i : -1))
    .filter((i) => i >= 0)
    .pop()
  if (at === undefined) return { lines, related: [] }
  const ITEM = /^\s*[-*]\s+\[(.+?)\]\((\S+?)(?:\s+"[^"]*")?\)\s*(?:(?:—|–|-|:)\s*(.*))?$/
  const items = lines
    .slice(at + 1)
    .filter((l) => l.line.trim())
    .map((l) => l.line.match(ITEM))
  if (!items.length || !items.every(Boolean)) return { lines, related: [] }
  return { lines: lines.slice(0, at), related: items.map((m) => ({ text: m![1]!, href: m![2]!, why: (m![3] ?? "").trim() })) }
}

/** The markdown without the Related footer that the page would lift out, for a share, which names no other doc. */
export const withoutRelated = (md: string) =>
  splitRelated(scan(md))
    .lines.map((l) => l.line)
    .join("\n")

function split(body: string) {
  let lines = scan(body)
  let h1 = ""
  const first = lines.findIndex((l) => l.line.trim() !== "")
  if (first >= 0 && !lines[first]!.inCode && /^#\s/.test(lines[first]!.line)) {
    h1 = lines[first]!.line.replace(/^#\s+/, "").replace(/\s+#+\s*$/, "").trim()
    lines = lines.slice(first + 1)
  }
  let tldr = ""
  const start = lines.findIndex((l) => l.line.trim() !== "")
  const TLDR = /^\s*(?:\*\*|__)?TL;DR(?::(?:\*\*|__)?|(?:\*\*|__)?:)\s*/i
  if (start >= 0 && TLDR.test(lines[start]!.line)) {
    let stop = start
    while (stop < lines.length && lines[stop]!.line.trim() !== "") stop++
    tldr = lines
      .slice(start, stop)
      .map((l) => l.line)
      .join("\n")
      .replace(TLDR, "")
    lines = lines.slice(stop)
  }
  const { lines: rest, related } = splitRelated(lines)
  lines = rest
  return { h1, tldr, content: lines.map((l) => l.line).join("\n"), related }
}

/** GitHub alerts, `> [!WARNING]`, become callout boxes. */
function callouts(html: string): string {
  const OPEN = /<blockquote>\n<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/
  for (let m = html.match(OPEN); m; m = html.match(OPEN)) {
    const start = m.index!
    let depth = 0
    let end = -1
    let after = 0
    for (const t of html.slice(start).matchAll(/<\/?blockquote>/g)) {
      depth += t[0][1] === "/" ? -1 : 1
      if (depth === 0) {
        end = start + t.index!
        after = end + "</blockquote>".length
        break
      }
    }
    if (end < 0) break
    const kind = m[1]!
    const cls = kind === "WARNING" || kind === "CAUTION" ? "callout warn" : "callout"
    const inner = html.slice(start + m[0].length, end).replace(/^<\/p>\n/, "")
    const label = `<strong>${ALERTS[kind]}:</strong> `
    const body = inner.startsWith("<p>") ? `<p>${label}${inner.slice(3)}` : inner.startsWith("<") ? `<p>${label}</p>\n${inner}` : `<p>${label}${inner}`
    html = html.slice(0, start) + `<div class="${cls}">\n${body}</div>` + html.slice(after)
  }
  return html
}

type Heading = { level: number; id: string; text: string }

function content(md: string, reserved: string[]) {
  const seen = new Map<string, number>(reserved.map((id) => [id, 1]))
  const headings: Heading[] = []
  const html = callouts(Bun.markdown.html(md, MD_OPTS))
    .replace(/<!--\s*class:\s*([\w -]+?)\s*-->\s*<table>/g, (_, c: string) => `<table class="${escapeHtml(c)}">`)
    .replace(/(<input type="checkbox" class="task-list-item-checkbox"[^>]*>)\n<p>/g, "<p>$1")
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, lvl: string, inner: string) => {
      let custom = ""
      inner = inner.replace(/\s*\{#([\w-]+)\}\s*$/, (_m, id: string) => ((custom = id), ""))
      const text = textOf(inner)
      let id = custom || slug(text)
      if (seen.has(id)) {
        const n = seen.get(id)!
        seen.set(id, n + 1)
        id = `${id}-${n}`
      }
      seen.set(id, 1)
      headings.push({ level: +lvl, id, text })
      return `<h${lvl} id="${id}">${inner}</h${lvl}>`
    })
  return { html, headings }
}

/** Sections, each followed by its subsections, when there are four sections or more. */
function contents(headings: Heading[]): string {
  if (headings.filter((h) => h.level === 2).length < 4) return ""
  let inSection = false
  const links = headings.flatMap((h) => {
    if (h.level === 2) inSection = true
    if (h.level === 2) return [`<a href="#${h.id}">${escapeHtml(h.text)}</a>`]
    if (h.level === 3 && inSection) return [`<a class="sub" href="#${h.id}">${escapeHtml(h.text)}</a>`]
    return []
  })
  return `<nav class="toc" aria-label="On this page"><div class="h">On this page</div>${links.join("")}</nav>\n`
}

function prop(key: string, v: string): string {
  if (key === "tags")
    return escapeHtml(
      v
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(", "),
    )
  if ((key === "branch" || key === "source") && !/[\s`[*]/.test(v)) return `<code>${escapeHtml(v)}</code>`
  if ((key === "pr" || key === "ticket") && /^https?:\/\/\S+$/.test(v)) return `<a href="${escapeHtml(v)}">${escapeHtml(v.replace(/^https?:\/\//, ""))}</a>`
  return inline(v)
}

/** The page for one md file. `name` is the file name, the title when the md has none. */
export function renderMarkdownPage(md: string, name: string): Page {
  const text = md.replace(/\r\n/g, "\n")
  const { front, body } = frontmatter(text)
  const parts = split(body)
  const title = front.title || parts.h1 || name
  const { html, headings } = content(parts.content, parts.related.length ? ["related"] : [])
  const toc = contents(headings)
  const props = PROPS.filter(([, key]) => front[key]).map(([label, key]) => `<div><dt>${label}</dt><dd>${prop(key, front[key]!)}</dd></div>`)
  const related = parts.related.length
    ? `<section class="related" id="related" data-atlas-chrome>
<h2>Related</h2>
<nav data-atlas-related><ul>
${parts.related.map((r) => `<li><a href="${escapeHtml(r.href)}">${inline(r.text)}</a>${r.why ? `<span class="why">${inline(r.why)}</span>` : ""}</li>`).join("\n")}
</ul></nav>
</section>
`
    : ""
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(textOf(inline(title)))}</title>
${front["doc-type"] ? `<meta name="doc-type" content="${escapeHtml(front["doc-type"])}">\n` : ""}${front.description ? `<meta name="description" content="${escapeHtml(front.description)}">\n` : ""}<meta name="generator" content="atlas doc-render">
<link href="${FONTS}" rel="stylesheet">
<link rel="stylesheet" href="${HLJS}/styles/github-dark.min.css">
<style>
${PAGE_CSS}
</style>
</head>
<body>
<div class="layout${toc ? "" : " no-toc"}">
${toc}<main>
<h1>${inline(title)}</h1>
${props.length ? `<details class="props">\n<summary>Metadata</summary>\n<dl>\n${props.join("\n")}\n</dl>\n</details>\n` : ""}${parts.tldr ? `<div class="tldr"><strong>TL;DR:</strong> ${inline(parts.tldr)}</div>\n` : ""}${html}
${related}</main>
</div>
<script type="text/markdown" id="atlas-md">
${text.replace(/<\/script/gi, "<\\/script")}</script>
<script src="${HLJS}/highlight.min.js"></script>
<script>if (window.hljs) document.querySelectorAll('pre code').forEach(function (el) { hljs.highlightElement(el) })</script>
</body>
</html>
`
  return { title: textOf(inline(title)), html: page }
}
