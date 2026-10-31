/**
 * `bun run docs:created [<repos dir>] [--write]`: gives each doc a `created` time (spec section 9). The time
 * is this Mac's creation time for the file, or the day in `date` when that day is earlier. Twins share the
 * earliest. It adds one frontmatter line or one meta tag, and nothing else. Without `--write` it reports
 * what it would add and writes nothing.
 */
import { statSync } from "node:fs"
import { join } from "node:path"
import { createdOf, htmlText, mdText, scanDocs, type DocFile } from "../packages/indexer/src/index.ts"
import { writePlan, type Change } from "./docs-migrate.ts"

export type CreatedChange = Change & { created: string; from: "file" | "date" | "twin" }
export type CreatedPlan = { changes: CreatedChange[]; skipped: { file: DocFile; why: string }[] }

const pad = (n: number) => String(n).padStart(2, "0")

/** A time as `created` writes it: this Mac's local time, to the minute, with the offset. */
export function localStamp(d: Date): string {
  const off = -d.getTimezoneOffset()
  const zone = `${off < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}${zone}`
}

const FRONT = /^---(\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/
const field = (front: string, key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2")

/** What a doc says itself: its own `created`, and the day in `date`. */
function given(file: DocFile, text: string): { created?: string; date?: string } {
  if (file.kind === "md") {
    const front = FRONT.exec(text)?.[2] ?? ""
    return { created: field(front, "created"), date: field(front, "date") }
  }
  const meta = (name: string) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(text)?.[1]
  return { created: meta("created"), date: meta("date") }
}

/** The text with `created` added: after `date` in the frontmatter, last in it, or as a new frontmatter. */
export function addToMd(md: string, created: string): string {
  const front = FRONT.exec(md)
  if (!front) return `---\ncreated: ${created}\n---\n${md}`
  const nl = front[1]!
  const date = new RegExp(`^date:.*$`, "m").exec(front[2]!)
  const at = date ? 3 + nl.length + date.index + date[0].length : 3 + nl.length + front[2]!.length
  return `${md.slice(0, at)}${nl}created: ${created}${md.slice(at)}`
}

/** The page with a `created` meta tag: last in its head, or at its top for a fragment with no head. */
export function addToHtml(html: string, created: string): string {
  const tag = `<meta name="created" content="${created}">`
  const end = html.indexOf("</head>")
  if (end >= 0) return `${html.slice(0, end)}${tag}\n${html.slice(end)}`
  const open = /<head\b[^>]*>|<html\b[^>]*>|<!doctype[^>]*>/i.exec(html)
  const at = open ? open.index + open[0].length : 0
  return at ? `${html.slice(0, at)}\n${tag}${html.slice(at)}` : `${tag}\n${html}`
}

/** Every doc without a valid `created`, with the time it would get. Twins get the same. */
export async function planCreated(root: string): Promise<CreatedPlan> {
  const files = (await scanDocs(root)).filter((f) => f.path !== "index.html" || f.kind !== "html")
  const stems = Map.groupBy(files, (f) => `${f.repo}/${f.path.replace(/\.(md|html)$/, "")}`)
  const plan: CreatedPlan = { changes: [], skipped: [] }
  for (const twins of stems.values()) {
    const read = await Promise.all(
      twins.map(async (file) => {
        const full = join(root, file.repo, file.path)
        const before = await Bun.file(full).text()
        return { file, before, ...given(file, before), born: statSync(full).birthtime }
      }),
    )
    for (const r of read) if (r.created && !createdOf(r.created)) plan.skipped.push({ file: r.file, why: `created "${r.created}" is not a time the contract allows` })
    const own = read.find((r) => r.created && createdOf(r.created))?.created
    const born = localStamp(new Date(Math.min(...read.map((r) => r.born.getTime()))))
    const day = read.map((r) => r.date).find((d) => d && createdOf(undefined, d))
    const [created, from] = own ? [own, "twin" as const] : day && day < born.slice(0, 10) ? [day, "date" as const] : [born, "file" as const]
    for (const r of read) {
      if (r.created) continue
      const text = r.file.kind === "md" ? addToMd(r.before, created) : addToHtml(r.before, created)
      plan.changes.push({ file: r.file, before: r.before, text, added: [`created ${created}`], created, from })
    }
  }
  return plan
}

/** Checks a planned change: taking the added line out gives the file before, and the indexer reads the time back. */
export function selfCheck(c: CreatedChange): string | null {
  const line = c.file.kind === "md" ? `created: ${c.created}` : `<meta name="created" content="${c.created}">`
  // The three ways the line goes in: after a line break, before one, or as a whole new frontmatter.
  const undone = [`\n${line}`, `${line}\n`, `---\n${line}\n---\n`].map((added) => c.text.replace(added, ""))
  if (!undone.includes(c.before)) return "changes more than the added line"
  const read = c.file.kind === "md" ? mdText(c.text, c.file.path) : htmlText(c.text, c.file.path)
  const want = createdOf(c.created)
  return read.created?.ms === want?.ms && read.created?.day === want?.day ? null : `the indexer reads ${JSON.stringify(read.created)}, not ${c.created}`
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const write = args.includes("--write")
  const root = args.find((a) => !a.startsWith("--")) ?? join(process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`, "repos")
  const plan = await planCreated(root)
  const failed = plan.changes.map((c) => ({ c, why: selfCheck(c) })).filter((x) => x.why)
  const lines: string[] = [write ? `docs:created --write over ${root}` : `docs:created dry run over ${root}. Nothing was written.`, ""]
  let repo = ""
  for (const c of plan.changes) {
    if (c.file.repo !== repo) lines.push(`${(repo = c.file.repo)}/`)
    lines.push(`  ${c.created.padEnd(22)} ${c.from.padEnd(4)}  ${c.file.path}`)
  }
  const by = Map.groupBy(plan.changes, (c) => c.from)
  lines.push("", "Summary", `  ${plan.changes.length} files change`)
  lines.push(`  ${String(by.get("file")?.length ?? 0).padStart(4)}  from the file's creation time on this Mac`)
  lines.push(`  ${String(by.get("date")?.length ?? 0).padStart(4)}  from an earlier day in date, so the day only`)
  lines.push(`  ${String(by.get("twin")?.length ?? 0).padStart(4)}  copied from the twin that has one`)
  lines.push(`  ${String(plan.changes.filter((c) => c.file.kind === "md" && !FRONT.test(c.before)).length).padStart(4)}  md files with no frontmatter, which get one holding only created`)
  for (const s of plan.skipped) lines.push(`  left out ${s.file.repo}/${s.file.path}: ${s.why}`)
  lines.push(`  self-check: ${plan.changes.length - failed.length} of ${plan.changes.length} changes add only the created line and read back`)
  for (const { c, why } of failed) lines.push(`    FAILED ${c.file.repo}/${c.file.path}: ${why}`)
  console.log(lines.join("\n"))
  if (failed.length) process.exit(1)
  if (write) {
    const backup = join(process.env.HOME!, ".cache/atlas/docs-created", new Date().toISOString().replace(/[:.]/g, "-"))
    await writePlan(root, { changes: plan.changes, skipped: [], conflicts: [] }, backup)
    console.log(`\nWrote ${plan.changes.length} files. The originals are in ${backup}`)
  }
}
