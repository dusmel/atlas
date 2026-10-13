/**
 * `bun run docs:migrate [<repos dir>] [--write]`: adds the doc contract (spec section 9) to existing docs.
 * It adds meta tags, `data-atlas-*` attributes and one frontmatter line, and nothing else. Without
 * `--write` it reports what it would add and writes nothing.
 */
import { mkdirSync, statSync, utimesSync } from "node:fs"
import { dirname, join } from "node:path"
import { htmlText, mdText, scanDocs, tagList, type DocFile } from "../packages/indexer/src/index.ts"

type Element = HTMLRewriterTypes.Element

const DOC_ID = /^d_[a-z0-9]{10}$/

/** An id from the doc's place when migrated, so the dry run shows the ids `--write` will add. */
export function newId(repo: string, stem: string): string {
  const hex = new Bun.CryptoHasher("sha256").update(`${repo}/${stem}`).digest("hex")
  return `d_${BigInt(`0x${hex}`).toString(36).slice(0, 10)}`
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
const squash = (s: string) => s.replace(/\s+/g, " ").trim()
const META_TRAIL = { Repo: "atlas-repo", Branch: "atlas-branch", PR: "atlas-pr", Ticket: "atlas-ticket", Type: "doc-type", Tags: "tags" } as const
type Row = keyof typeof META_TRAIL

/** What one html doc already has: its meta names and the rows of its metadata block. */
function readHtml(html: string) {
  const metas = new Set<string>()
  const rows = new Map<Row, { text: string; href: string | null }>()
  let titled = false
  let headed = false
  // The first top bar, as the marking pass sees it, and whether the doc's h1 sits inside it.
  let bar: "none" | "open" | "closed" = "none"
  let titleInBar = false
  let row: Row | null = null
  let dt: string | null = null
  let dd: { text: string; href: string | null } | null = null
  new HTMLRewriter()
    .on("title", { element: () => void (titled = true) })
    .on("head", { element: () => void (headed = true) })
    .on(".topbar", {
      element(el) {
        if (bar !== "none") return
        bar = "open"
        el.onEndTag(() => void (bar = "closed"))
      },
    })
    .on("h1", { element: () => void (bar === "open" && (titleInBar = true)) })
    .on("meta[name]", { element: (el) => void metas.add(el.getAttribute("name")!.toLowerCase()) })
    .on("details.props dt", {
      element(el) {
        dt = ""
        el.onEndTag(() => {
          const name = squash(dt!) as Row
          row = name in META_TRAIL ? name : null
          dt = null
        })
      },
      text: (t) => void (dt !== null && (dt += t.text)),
    })
    .on("details.props dd", {
      element(el) {
        if (!row || el.getAttribute("class")?.split(/\s+/).includes("empty")) return void (row = null)
        const at = row
        dd = { text: "", href: null }
        rows.set(at, dd)
        row = null
        el.onEndTag(() => void (dd = null))
      },
      text: (t) => void (dd && (dd.text += t.text)),
    })
    .on("details.props dd a[href]", { element: (el) => void (dd && !dd.href && (dd.href = el.getAttribute("href"))) })
    .transform(html)
  return { metas, rows, titled, headed, titleInBar }
}

const MARK = "\u0000atlas-mark-"
const describe = (el: Element) => `<${el.tagName}${["class", "id", "href"].map((a) => (el.getAttribute(a) ? ` ${a}="${el.getAttribute(a)}"` : "")).join("")}>`

/**
 * The html with the contract added: the id and the trail as meta tags after `<title>`, and the markers
 * on the top bar, its index link, the theme toggle, the Related section and the diagrams. Start tags
 * are never re-written: each marker goes in as text right after the tag name.
 */
export function migrateHtml(html: string, id: string | null, twin: { type: string; tags: string } | null = null) {
  if (html.includes(MARK)) throw new Error("the doc holds the migration's marker text")
  const { metas, rows, titled, headed, titleInBar } = readHtml(html)
  const added: string[] = []
  const metaTags: string[] = []
  const meta = (name: string, value: string) => {
    if (metas.has(name) || !value || !(titled || headed)) return
    metaTags.push(`\n<meta name="${name}" content="${attr(value)}">`)
    added.push(`meta ${name} = ${value}`)
  }
  if (id) meta("atlas-id", id)
  for (const [label, name] of Object.entries(META_TRAIL) as [Row, string][]) {
    const r = rows.get(label)
    const value = r && squash((label === "PR" || label === "Ticket" ? r.href : null) ?? r.text)
    if (value && value !== "—") meta(name, value)
  }
  if (twin) {
    meta("doc-type", twin.type)
    meta("tags", twin.tags)
  }

  const marks: string[] = []
  const mark = (el: Element, ...names: string[]) => {
    const missing = names.filter((n) => !el.hasAttribute(n))
    if (!missing.length) return
    el.before(`${MARK}${marks.length}\u0000`, { html: true })
    marks.push(missing.join(" "))
    added.push(`${missing.join(" ")} on ${describe(el)}`)
  }
  let topbar = false
  let inTopbar = false
  let home = false
  let related = false
  let rewriter = new HTMLRewriter()
    .on(".topbar", {
      element(el) {
        if (topbar) return
        topbar = inTopbar = true
        // Hidden in the frame, a bar holding the h1 would take the title with it.
        if (!titleInBar) mark(el, "data-atlas-chrome")
        el.onEndTag(() => void (inTopbar = false))
      },
    })
    .on('a[href$="index.html"]', {
      element(el) {
        if (!inTopbar || home) return
        home = true
        mark(el, "data-atlas-home")
      },
    })
    // The toggle inside the top bar goes with it.
    .on("button#theme, button#themeBtn", { element: (el) => void (!inTopbar && mark(el, "data-atlas-chrome")) })
    .on("section.related, nav.related, div.related, section#related, nav#related, div#related", {
      element(el) {
        if (related) return
        related = true
        mark(el, "data-atlas-chrome", "data-atlas-related")
      },
    })
    .on("figure.diagram", { element: (el) => mark(el, "data-atlas-diagram") })
  if (metaTags.length) {
    rewriter = titled
      ? rewriter.on("title", { element: (el) => void el.after(metaTags.join(""), { html: true }) })
      : rewriter.on("head", { element: (el) => void el.prepend(metaTags.join(""), { html: true }) })
  }
  let text = rewriter.transform(html)
  text = text.replace(new RegExp(`${MARK}(\\d+)\u0000(<[A-Za-z][A-Za-z0-9-]*)`, "g"), (_, n: string, tag: string) => `${tag} ${marks[Number(n)]}`)
  if (text.includes(MARK)) throw new Error("a marker did not land on its tag")
  if (metaTags.length && !text.includes(metaTags[0]!)) throw new Error("the meta tags did not land")
  const problem = !(titled || headed) ? "an html with no <head>, so no id or trail" : titleInBar ? "an html whose top bar holds its h1, so the bar stays in the frame" : null
  return { text, added, problem }
}

/** The md with `atlas-id` as the last frontmatter line. An md with no frontmatter is left alone. */
export function migrateMd(md: string, id: string) {
  const front = /^---(\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md)
  if (!front || /^atlas-id:[ \t]*\S/m.test(front[2]!)) return { text: md, added: [] as string[], problem: null }
  const nl = front[1]!
  const end = 3 + nl.length + front[2]!.length
  return { text: `${md.slice(0, end)}${nl}atlas-id: ${id}${md.slice(end)}`, added: [`frontmatter atlas-id: ${id}`], problem: null }
}

/** The text with every contract addition taken out, for comparing a doc before and after. */
export const withoutContract = (text: string) =>
  text
    .replace(/\n<meta name="(?:atlas-[a-z-]+|doc-type|tags)" content="[^"]*">/g, "")
    .replace(/ data-atlas-(?:chrome|home|related|diagram)(?=[\s>\/])/g, "")
    .replace(/(^---\r?\n[\s\S]*?)\r?\natlas-id: d_[a-z0-9]{10}(?=\r?\n---)/, "$1")

export type Change = { file: DocFile; before: string; text: string; added: string[] }
export type Plan = { changes: Change[]; skipped: { file: DocFile; why: string }[]; conflicts: { files: DocFile[]; ids: string[] }[] }

/** Every addition for the docs under `root`, with twins (`x.md`, `x.html`) sharing one id. */
export async function planMigration(root: string): Promise<Plan> {
  const files = (await scanDocs(root)).filter((f) => f.path !== "index.html" || f.kind !== "html")
  const stems = new Map<string, DocFile[]>()
  for (const f of files) {
    const key = `${f.repo}/${f.path.replace(/\.(md|html)$/, "")}`
    stems.set(key, [...(stems.get(key) ?? []), f])
  }
  const plan: Plan = { changes: [], skipped: [], conflicts: [] }
  for (const [key, twins] of stems) {
    const read = await Promise.all(
      twins.map(async (file) => {
        const before = await Bun.file(join(root, file.repo, file.path)).text()
        return { file, before, doc: file.kind === "md" ? mdText(before, file.path) : htmlText(before, file.path) }
      }),
    )
    const held = [...new Set(read.map((r) => r.doc.contract.id).filter((i): i is string => !!i))]
    if (held.length > 1) {
      plan.conflicts.push({ files: twins, ids: held })
      continue
    }
    const id = held[0] ?? newId(twins[0]!.repo, key.slice(twins[0]!.repo.length + 1))
    const md = read.find((r) => r.file.kind === "md")
    for (const { file, before, doc } of read) {
      let result: { text: string; added: string[]; problem: string | null }
      if (file.kind === "html") {
        result = migrateHtml(before, doc.contract.id ? null : id, md ? { type: md.doc.type, tags: tagList(md.doc.tags).join(", ") } : null)
      } else {
        result = migrateMd(before, id)
        // The html twin holds the id for both when the md has no frontmatter to carry it.
        if (!result.added.length && !doc.contract.id && !/^---\r?\n/.test(before)) {
          plan.skipped.push({ file, why: read.length > 1 ? "an md with no frontmatter; its html twin holds the id" : "an md with no frontmatter, so no id" })
        }
      }
      if (result.problem) plan.skipped.push({ file, why: result.problem })
      if (result.added.length) plan.changes.push({ file, before, text: result.text, added: result.added })
    }
  }
  return plan
}

/** Checks a planned change: nothing but the additions differs, and the indexer reads the id back. */
export function selfCheck(c: Change): string | null {
  if (withoutContract(c.text) !== withoutContract(c.before)) return "changes more than the additions"
  const id = c.added.map((a) => /(?:atlas-id = |atlas-id: )(d_[a-z0-9]{10})/.exec(a)?.[1]).find(Boolean)
  if (!id) return null
  const read = c.file.kind === "md" ? mdText(c.text, c.file.path) : htmlText(c.text, c.file.path)
  return read.contract.id === id ? null : `the indexer reads id ${read.contract.id}, not ${id}`
}

/** Writes each change after copying the file to `backup`, and keeps the file's times, since the doc says the same. */
export async function writePlan(root: string, plan: Plan, backup: string) {
  for (const c of plan.changes) {
    const file = join(root, c.file.repo, c.file.path)
    const { atime, mtime } = statSync(file)
    const copy = join(backup, c.file.repo, c.file.path)
    mkdirSync(dirname(copy), { recursive: true })
    await Bun.write(copy, c.before)
    await Bun.write(file, c.text)
    utimesSync(file, atime, mtime)
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const write = args.includes("--write")
  const root = args.find((a) => !a.startsWith("--")) ?? join(process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`, "repos")
  const plan = await planMigration(root)
  const failed = plan.changes.map((c) => ({ c, why: selfCheck(c) })).filter((x) => x.why)
  const lines: string[] = [write ? `docs:migrate --write over ${root}` : `docs:migrate dry run over ${root}. Nothing was written.`, ""]
  let repo = ""
  for (const c of plan.changes) {
    if (c.file.repo !== repo) lines.push(`${(repo = c.file.repo)}/`)
    lines.push(`  ${c.file.path}`, ...c.added.map((a) => `    + ${a}`))
  }
  const kinds = new Map<string, number>()
  for (const a of plan.changes.flatMap((c) => c.added)) {
    const kind = a.startsWith("meta ") ? a.split(" = ")[0]! : a.startsWith("frontmatter") ? "frontmatter atlas-id" : a.split(" on ")[0]!
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  }
  lines.push("", "Summary", `  ${plan.changes.length} files change`)
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) lines.push(`  ${String(n).padStart(4)}  ${k}`)
  const skips = Map.groupBy(plan.skipped, (s) => s.why)
  for (const [why, list] of skips) lines.push(`  ${String(list.length).padStart(4)}  left out: ${why}`)
  for (const c of plan.conflicts) lines.push(`  twins hold different ids (${c.ids.join(", ")}), left out: ${c.files.map((f) => `${f.repo}/${f.path}`).join(", ")}`)
  lines.push(`  self-check: ${plan.changes.length - failed.length} of ${plan.changes.length} changes add only contract markers and read back`)
  for (const { c, why } of failed) lines.push(`    FAILED ${c.file.repo}/${c.file.path}: ${why}`)
  console.log(lines.join("\n"))
  if (failed.length) process.exit(1)
  if (write) {
    const backup = join(process.env.HOME!, ".cache/atlas/docs-migrate", new Date().toISOString().replace(/[:.]/g, "-"))
    await writePlan(root, plan, backup)
    console.log(`\nWrote ${plan.changes.length} files. The originals are in ${backup}`)
  }
}
