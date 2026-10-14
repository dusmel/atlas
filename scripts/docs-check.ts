/**
 * `bun run docs:check [<repos dir>]`: checks the docs against the doc contract (spec section 9). It
 * exits 1 on a value the contract does not allow, an id two docs hold, twins with different ids, or a
 * `superseded-by` no doc has. How many docs carry each part is reported, not judged.
 */
import { join } from "node:path"
import { htmlText, mdText, scanDocs, type Contract, type DocFile } from "../packages/indexer/src/index.ts"

/** The raw values a doc gives the contract's checked fields, before the reader drops what it does not allow. */
const HTML_FIELDS = { "atlas-contract": "version", "atlas-id": "id", "atlas-status": "status", "atlas-superseded-by": "supersededBy", "atlas-todo": "todo" } as const
const MD_FIELDS = { "atlas-id": "id", status: "status", "superseded-by": "supersededBy", todo: "todo" } as const
type Checked = (typeof HTML_FIELDS)[keyof typeof HTML_FIELDS]

function rawFields(file: DocFile, text: string): [string, Checked, string][] {
  if (file.kind === "md") {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ""
    return Object.entries(MD_FIELDS).flatMap(([key, field]) => {
      const v = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2")
      return v ? [[key, field, v] as [string, Checked, string]] : []
    })
  }
  const found: [string, Checked, string][] = []
  new HTMLRewriter()
    .on("meta[name]", {
      element(el) {
        const name = el.getAttribute("name")!.toLowerCase() as keyof typeof HTML_FIELDS
        const v = el.getAttribute("content")?.trim()
        if (name in HTML_FIELDS && v && !found.some((f) => f[0] === name)) found.push([name, HTML_FIELDS[name], v])
      },
    })
    .transform(text)
  return found
}

export type Report = { errors: string[]; counts: [string, number][] }

export async function checkDocs(root: string): Promise<Report> {
  const files = (await scanDocs(root)).filter((f) => f.path !== "index.html" || f.kind !== "html")
  const errors: string[] = []
  const docs: { file: DocFile; contract: Contract; type: string; text: string }[] = []
  for (const file of files) {
    const text = await Bun.file(join(root, file.repo, file.path)).text()
    const read = file.kind === "md" ? mdText(text, file.path) : htmlText(text, file.path)
    docs.push({ file, contract: read.contract, type: read.type, text })
    for (const [key, field, value] of rawFields(file, text)) {
      if (read.contract[field] === null) errors.push(`${file.repo}/${file.path}: ${key} "${value}" is not allowed`)
    }
    if (file.kind === "html" && read.contract.version !== null && !text.includes("atlas:theme")) {
      errors.push(`${file.repo}/${file.path}: says atlas-contract ${read.contract.version} but never listens for atlas:theme, so the frame can't theme it`)
    }
  }

  // Twins are one doc: one id between them, and an id counts once per stem.
  const stems = new Map<string, Set<string>>()
  for (const d of docs) {
    if (!d.contract.id) continue
    const stem = `${d.file.repo}/${d.file.path.replace(/\.(md|html)$/, "")}`
    stems.set(stem, (stems.get(stem) ?? new Set()).add(d.contract.id))
  }
  const holders = new Map<string, string[]>()
  for (const [stem, ids] of stems) {
    if (ids.size > 1) errors.push(`${stem}: the md and the html hold different ids, ${[...ids].join(" and ")}`)
    for (const id of ids) holders.set(id, [...(holders.get(id) ?? []), stem])
  }
  for (const [id, list] of holders) if (list.length > 1) errors.push(`${id} is held by ${list.length} docs: ${list.join(", ")}`)
  for (const d of docs) {
    const by = d.contract.supersededBy
    if (by && !holders.has(by)) errors.push(`${d.file.repo}/${d.file.path}: superseded by ${by}, which no doc holds`)
  }

  const html = docs.filter((d) => d.file.kind === "html")
  const count = (label: string, list: unknown[]) => [label, list.length] as [string, number]
  const counts = [
    count("docs (md and html files)", docs),
    count("with an id", docs.filter((d) => d.contract.id)),
    count("with a doc type", docs.filter((d) => d.type)),
    count("with a status", docs.filter((d) => d.contract.status)),
    count("html", html),
    count("html with a markdown block", html.filter((d) => d.contract.md)),
    count("html with the block as atlas-md", html.filter((d) => /<script[^>]*\bid="atlas-md"/.test(d.text))),
    count("html at contract version 1", html.filter((d) => d.contract.version === 1)),
    count("html with a marked top bar", html.filter((d) => /<[a-z]+\b(?=[^>]*\sdata-atlas-chrome\b)(?=[^>]*\sclass="[^"]*\btopbar\b)[^>]*>/.test(d.text))),
  ]
  return { errors, counts }
}

if (import.meta.main) {
  const root = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(process.env.ATLAS_ROOT ?? `${process.env.HOME}/MEGA/Documents/atlas`, "repos")
  const { errors, counts } = await checkDocs(root)
  console.log(`docs:check over ${root}\n`)
  for (const [label, n] of counts) console.log(`  ${String(n).padStart(4)}  ${label}`)
  console.log(errors.length ? `\n${errors.length} problems:\n${errors.map((e) => `  ${e}`).join("\n")}` : "\nNo problems.")
  if (errors.length) process.exit(1)
}
