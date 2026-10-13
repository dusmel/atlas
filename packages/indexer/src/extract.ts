/** `type` is the doc's `doc-type`, "" when it has none. */
export type DocText = { title: string; body: string; tags: string; type: string }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

/** HTMLRewriter hands text over as written, entities and all. */
export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? match
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim()

export function htmlText(html: string, fallbackTitle: string): DocText {
  let title = ""
  let tags = ""
  let type = ""
  let skip = 0
  let inTitle = false
  const parts: string[] = []
  new HTMLRewriter()
    // A space per element keeps words in separate paragraphs and cells apart.
    .on("*", { element: () => void parts.push(" ") })
    .on("script, style, svg, noscript, template", {
      element(el) {
        if (el.selfClosing) return
        skip++
        el.onEndTag(() => void skip--)
      },
    })
    .on("title", {
      element(el) {
        inTitle = true
        el.onEndTag(() => void (inTitle = false))
      },
      text: (t) => void (title += t.text),
    })
    .on('meta[name="tags"]', { element: (el) => void (tags = el.getAttribute("content") ?? "") })
    .on('meta[name="doc-type"]', { element: (el) => void (type = el.getAttribute("content") ?? "") })
    .onDocument({ text: (t) => void (!skip && !inTitle && parts.push(t.text)) })
    .transform(html)
  return { title: squash(decode(title)) || fallbackTitle, body: squash(decode(parts.join(""))), tags: squash(decode(tags)), type: squash(decode(type)).toLowerCase() }
}

/** Title from the frontmatter, else the first `# ` heading. Tags and type from the frontmatter. */
export function mdText(md: string, fallbackTitle: string): DocText {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  const body = front ? md.slice(front[0].length) : md
  const field = (name: string) => (front ? new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(front[1]!)?.[1]?.trim() : undefined)
  const heading = /^#[ \t]+(.+)$/m.exec(body)?.[1]?.trim()
  return { title: field("title") || heading || fallbackTitle, body: body.trim(), tags: field("tags") ?? "", type: (field("doc-type") ?? "").replace(/^["']|["']$/g, "").toLowerCase() }
}

/** Tags as the docs write them: comma-separated, in frontmatter sometimes inside [ ]. Lower-cased, so `Atlas` and `atlas` are one tag. */
export const tagList = (tags: string) => [...new Set(tags.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))]
