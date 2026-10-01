import { parseTitle, RuleError, type Priority, type Status } from "../rules.ts"

// parseTodo is ported from ~/.agents/skills/html-docs/notes-build.ts and keeps its behaviour,
// except that any mark is an item here, so an unknown one fails validation instead of
// quietly becoming prose.
export type Block =
  | { kind: "heading"; level: number; text: string; line: number }
  | { kind: "item"; indent: number; mark: string; text: string; body: string[]; line: number }
  | { kind: "text"; lines: string[]; line: number }

const ITEM_RE = /^(\s*)- \[(.)\] (.*)$/
export const CHECKBOX_RE = /^\s*- \[.\] /

export function parseTodo(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const h = lines[i]!.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      blocks.push({ kind: "heading", level: h[1]!.length, text: h[2]!.trim(), line: i })
      i++
      continue
    }
    const it = lines[i]!.match(ITEM_RE)
    if (it) {
      const start = i
      const body: string[] = []
      i++
      while (i < lines.length) {
        if (/^\s+\S/.test(lines[i]!)) {
          body.push(lines[i]!)
          i++
          continue
        }
        // a blank line still belongs to the item when an indented line follows it
        if (lines[i]!.trim() === "" && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) {
          body.push(lines[i]!)
          i++
          continue
        }
        break
      }
      blocks.push({ kind: "item", indent: it[1]!.length, mark: it[2]!, text: it[3]!, body, line: start })
      continue
    }
    const start = i
    const buf: string[] = []
    while (i < lines.length && !/^#{1,6}\s/.test(lines[i]!) && !ITEM_RE.test(lines[i]!)) buf.push(lines[i++]!)
    blocks.push({ kind: "text", lines: buf, line: start })
  }
  return blocks
}

// The `P1 — Subject` split is sectionOf from notes-build.ts.
export function headingOf(text: string): { label: string; priority: Priority | null; mapping: "P3" | "inbox" | null; bad: boolean } {
  const m = text.match(/^(P\d)\s*[—–-]\s*(.+)$/)
  if (m) {
    const bad = !["P0", "P1", "P2", "P3"].includes(m[1]!)
    return { label: m[2]!, priority: bad ? null : (m[1] as Priority), mapping: null, bad }
  }
  if (/^low priority/i.test(text)) return { label: text, priority: "P3", mapping: "P3", bad: false }
  return { label: text, priority: null, mapping: "inbox", bad: false }
}

export type Line = { line: number; text: string } // line is 1-based
export type Failure = { check: string; line?: number; text?: string; message: string }

export type ParsedGroup = { key: number; name: string; note: string; doc_path: string | null; headings: Line[] }
export type ParsedItem = {
  key: number
  group: number | null
  parent: number | null
  section: string | null
  title: string
  body: string
  status: Status
  priority: Priority | null
  mark: string
  line: number
}

export type Parsed = {
  lines: string[]
  groups: ParsedGroup[]
  items: ParsedItem[]
  preamble: Line[]
  separators: Line[]
  sections: Line[] // ### lines that became item sections
  merged: Line[] // a repeated ## heading, folded into the group of the same name
  mappings: (Line & { to: "P3" | "inbox" })[]
  flattened: Line[]
  errors: Failure[]
}

const STATUS: Record<string, Status> = { " ": "todo", "-": "doing", x: "done", X: "done" }
const SEPARATOR = /^-{3,}$/

type Entry = { kind: "gap" } | { kind: "text"; line: number; raw: string } | { kind: "section"; line: number; raw: string; name: string }
type GroupState = ParsedGroup & { entries: Entry[] }

const indentOf = (s: string) => s.length - s.trimStart().length
const dedent = (s: string, n: number) => s.slice(Math.min(n, indentOf(s)))

// The first relative markdown link in the quote under a heading.
function docPath(lines: string[]): string | null {
  for (const l of lines) {
    if (!l.trimStart().startsWith(">")) continue
    for (const m of l.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (!/^([a-z]+:|#|\/)/i.test(m[1]!)) return m[1]!
    }
  }
  return null
}

export function parseFile(src: string): Parsed {
  const lines = src.replace(/\r\n/g, "\n").split("\n")
  const out: Parsed = { lines, groups: [], items: [], preamble: [], separators: [], sections: [], merged: [], mappings: [], flattened: [], errors: [] }
  const byName = new Map<string, GroupState>()
  const states: GroupState[] = []
  let group: GroupState | null = null
  let priority: Priority | null = null
  let section: string | null = null
  let afterHeading = false
  const at = (i: number): Line => ({ line: i + 1, text: lines[i]!.trim() })

  const addItem = (mark: string, text: string, i: number, parent: number | null): ParsedItem => {
    const status = STATUS[mark]
    if (!status) out.errors.push({ check: "mark", ...at(i), message: `unknown mark [${mark}], use [ ], [-] or [x]` })
    let title = text.trim()
    try {
      title = parseTitle(text)
    } catch (e) {
      if (!(e instanceof RuleError)) throw e
      out.errors.push({ check: "title", ...at(i), message: e.message })
    }
    const item: ParsedItem = { key: out.items.length, group: group?.key ?? null, parent, section, title, body: "", status: status ?? "todo", priority, mark, line: i + 1 }
    out.items.push(item)
    return item
  }

  for (const b of parseTodo(lines)) {
    if (b.kind === "heading") {
      if (b.level === 2) {
        const h = headingOf(b.text)
        if (h.bad) out.errors.push({ check: "priority", ...at(b.line), message: "priority must be P0 to P3" })
        let g = byName.get(h.label)
        if (g) out.merged.push(at(b.line))
        else {
          g = { key: states.length, name: h.label, note: "", doc_path: null, headings: [], entries: [] }
          byName.set(h.label, g)
          states.push(g)
        }
        g.headings.push(at(b.line))
        if (h.mapping) out.mappings.push({ ...at(b.line), to: h.mapping })
        group = g
        priority = h.priority
        section = null
        afterHeading = true
        continue
      }
      afterHeading = false
      if (!group) out.preamble.push(at(b.line))
      else if (b.level === 3) {
        section = b.text
        group.entries.push({ kind: "section", line: b.line, raw: lines[b.line]!, name: b.text })
      } else group.entries.push({ kind: "text", line: b.line, raw: lines[b.line]! })
      continue
    }

    if (b.kind === "item") {
      afterHeading = false
      // Indented checkboxes become children of this item; two or more levels deep are flattened.
      const top = addItem(b.mark, b.text, b.line, null)
      const bodies = new Map<ParsedItem, string[]>([[top, []]])
      let child: { item: ParsedItem; indent: number } | null = null
      let firstChildIndent: number | null = null
      for (let j = 0; j < b.body.length; j++) {
        const raw = b.body[j]!
        const i = b.line + 1 + j
        const m = raw.match(ITEM_RE)
        if (m) {
          const indent = m[1]!.length
          firstChildIndent ??= indent
          if (indent > firstChildIndent) out.flattened.push(at(i))
          child = { item: addItem(m[2]!, m[3]!, i, top.key), indent }
          bodies.set(child.item, [])
        } else if (child && (raw.trim() === "" || indentOf(raw) > child.indent)) {
          bodies.get(child.item)!.push(dedent(raw, child.indent + 2))
        } else {
          child = null
          bodies.get(top)!.push(dedent(raw, b.indent + 2))
        }
      }
      for (const [item, body] of bodies) item.body = trimBlank(body)
      continue
    }

    const kept: Entry[] = []
    b.lines.forEach((raw, j) => {
      const i = b.line + j
      if (raw.trim() && SEPARATOR.test(raw.trim())) out.separators.push(at(i))
      else if (!group) {
        if (raw.trim()) out.preamble.push(at(i))
      } else kept.push({ kind: "text", line: i, raw })
    })
    if (group && kept.some((e) => e.kind === "text" && e.raw.trim())) {
      if (afterHeading && group.doc_path === null) group.doc_path = docPath(kept.map((e) => (e.kind === "text" ? e.raw : "")))
      group.entries.push({ kind: "gap" }, ...kept)
    }
    afterHeading = false
  }

  for (const g of states) finishGroup(g, out)
  out.groups = states.map(({ entries: _, ...g }) => g)
  return out
}

function trimBlank(lines: string[]): string {
  return lines.join("\n").replace(/^\s*\n/, "").trimEnd()
}

// A ### line becomes an item section unless the note needs it: prose under it, no items
// under it, or the same heading twice in the group. The renderer skips a section heading
// that the note already holds, so either way the line comes back once.
function finishGroup(g: GroupState, out: Parsed): void {
  const withItems = new Set(out.items.filter((i) => i.group === g.key).map((i) => i.section))
  const seen = new Map<string, number>()
  const prose = new Set<string>()
  let current: string | null = null
  for (const e of g.entries) {
    if (e.kind === "section") {
      current = e.name
      seen.set(e.name, (seen.get(e.name) ?? 0) + 1)
    } else if (e.kind === "text" && e.raw.trim() && current !== null) prose.add(current)
  }
  const note: string[] = []
  const blank = () => {
    if (note.length && note.at(-1) !== "") note.push("")
  }
  for (const e of g.entries) {
    if (e.kind === "gap") blank()
    else if (e.kind === "text") {
      if (e.raw.trim() || note.at(-1) !== "") note.push(e.raw.trim() ? e.raw : "")
    } else if (prose.has(e.name) || !withItems.has(e.name) || seen.get(e.name)! > 1) {
      blank()
      note.push(e.raw.trim(), "")
    } else out.sections.push({ line: e.line + 1, text: e.raw.trim() })
  }
  g.note = note.join("\n").trim()
}
