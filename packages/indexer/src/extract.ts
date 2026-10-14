/** `type` is the doc's `doc-type`, "" when it has none. */
export type DocText = { title: string; body: string; tags: string; type: string; contract: Contract }

/**
 * What a doc says about itself under the doc contract (spec section 9). Each field is null when the doc
 * lacks it or holds a value the contract does not allow. `md` is an html doc's embedded markdown.
 */
export type Contract = {
  version: number | null
  id: string | null
  status: "draft" | "active" | "done" | "superseded" | null
  supersededBy: string | null
  todo: number | null
  repo: string | null
  branch: string | null
  pr: string | null
  ticket: string | null
  md: string | null
}

type Field = Exclude<keyof Contract, "md">

const DOC_ID = /^d_[a-z0-9]{10}$/
const STATUSES = ["draft", "active", "done", "superseded"] as const
/** `atlas-md`, then the ids docs used before the contract named one. */
const MD_IDS = ["atlas-md", "md-source", "md", "source-md", "mdSource"]

/** A contract from raw field values, keeping only the ones it allows. */
function contractOf(f: Partial<Record<Field, string>>, md: string | null): Contract {
  const text = (v?: string) => v?.trim() || null
  const id = (v?: string) => (v && DOC_ID.test(v.trim()) ? v.trim() : null)
  const whole = (v?: string) => (v && /^[1-9]\d*$/.test(v.trim()) ? Number(v.trim()) : null)
  const status = f.status?.trim().toLowerCase()
  return {
    version: whole(f.version),
    id: id(f.id),
    status: STATUSES.find((s) => s === status) ?? null,
    supersededBy: id(f.supersededBy),
    todo: whole(f.todo?.replace(/^#/, "")),
    repo: text(f.repo),
    branch: text(f.branch),
    pr: text(f.pr),
    ticket: text(f.ticket),
    md,
  }
}

const META: Record<string, Field> = {
  "atlas-contract": "version",
  "atlas-id": "id",
  "atlas-status": "status",
  "atlas-superseded-by": "supersededBy",
  "atlas-todo": "todo",
  "atlas-repo": "repo",
  "atlas-branch": "branch",
  "atlas-pr": "pr",
  "atlas-ticket": "ticket",
}

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

/** The text search indexes is the doc's embedded markdown when it has some, else the text of its html. */
export function htmlText(html: string, fallbackTitle: string): DocText {
  let title = ""
  let tags = ""
  let type = ""
  const fields: Partial<Record<Field, string>> = {}
  // The first block found by each id, so `atlas-md` wins over the older ids whatever the order.
  const blocks = new Map<string, string>()
  let block: string | null = null
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
    .on("meta[name]", {
      element(el) {
        const key = META[el.getAttribute("name")!.toLowerCase()]
        if (key && fields[key] === undefined) fields[key] = decode(el.getAttribute("content") ?? "")
      },
    })
    .on(MD_IDS.map((id) => `script[id="${id}"]`).join(", "), {
      element(el) {
        const id = el.getAttribute("id")!
        if (blocks.has(id)) return
        blocks.set(id, "")
        block = id
        el.onEndTag(() => void (block = null))
      },
      // Script text arrives raw, in chunks, with no entities to decode.
      text: (t) => void (block && blocks.set(block, blocks.get(block) + t.text)),
    })
    .onDocument({ text: (t) => void (!skip && !inTitle && parts.push(t.text)) })
    .transform(html)
  // A block can't hold `</script`, so writers put `<\/script` and readers turn it back.
  const md = MD_IDS.map((id) => blocks.get(id)?.trim()).find(Boolean)?.replace(/<\\\/script/gi, "</script") ?? null
  return {
    title: squash(decode(title)) || fallbackTitle,
    body: md ?? squash(decode(parts.join(""))),
    tags: squash(decode(tags)),
    type: squash(decode(type)).toLowerCase(),
    contract: contractOf(fields, md),
  }
}

/** Title from the frontmatter, else the first `# ` heading. Tags and type from the frontmatter. */
export function mdText(md: string, fallbackTitle: string): DocText {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  const body = front ? md.slice(front[0].length) : md
  const field = (name: string) => (front ? new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(front[1]!)?.[1]?.trim() : undefined)
  const heading = /^#[ \t]+(.+)$/m.exec(body)?.[1]?.trim()
  const value = (name: string) => field(name)?.replace(/^(["'])(.*)\1$/, "$2")
  const contract = contractOf(
    { id: value("atlas-id"), status: value("status"), supersededBy: value("superseded-by"), todo: value("todo"), repo: value("repo"), branch: value("branch"), pr: value("pr"), ticket: value("ticket") },
    null,
  )
  return { title: field("title") || heading || fallbackTitle, body: body.trim(), tags: field("tags") ?? "", type: (field("doc-type") ?? "").replace(/^["']|["']$/g, "").toLowerCase(), contract }
}

/** Tags as the docs write them: comma-separated, in frontmatter sometimes inside [ ]. Lower-cased, so `Atlas` and `atlas` are one tag. */
export const tagList = (tags: string) => [...new Set(tags.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))]
