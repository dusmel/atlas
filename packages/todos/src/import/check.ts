import type { Priority, Status } from "../rules.ts"
import { CHECKBOX_RE, parseFile, type Failure, type Parsed } from "./parse.ts"
import { renderTodo, squash, type RenderGroup, type RenderItem } from "./render.ts"

// Spec section 11, checks 1 to 3. Any failure stops the file.
export function checkFile(src: string): { parsed: Parsed; failures: Failure[] } {
  const parsed = parseFile(src)
  const failures = [...parsed.errors]
  const checkboxes = parsed.lines.filter((l) => CHECKBOX_RE.test(l)).length
  if (parsed.items.length !== checkboxes) {
    failures.push({ check: "count", message: `${parsed.items.length} items from ${checkboxes} checkbox lines` })
  }
  failures.push(...placed(parsed), ...roundTrip(parsed, asRenderInput(parsed)))
  return { parsed, failures }
}

// Check 2: every non-blank line lands in exactly one place of the parsed structure.
function placed(p: Parsed): Failure[] {
  const out = [
    ...p.preamble,
    ...p.separators,
    ...p.sections,
    ...p.groups.flatMap((g) => [...g.headings, ...textLines(g.note)]),
    ...p.items.flatMap((i) => [{ text: `- [${i.mark}] ${i.title}` }, ...textLines(i.body)]),
  ].map((l) => squash(l.text))
  return compare(p.lines, new Set(), out, squash, "placed")
}

// Check 3, and check 4 when `stored` comes from the server: render and compare the lines.
export function roundTrip(p: Parsed, stored: { groups: RenderGroup[]; items: RenderItem[] }): Failure[] {
  // Kept only in imports.original, and reported, so the renderer never emits them.
  const skip = new Set([...p.preamble, ...p.separators, ...p.merged].map((l) => l.line - 1))
  const rendered = renderTodo(stored.groups, stored.items).split("\n")
  return compare(p.lines, skip, rendered, normal, "round_trip")
}

// Check 4 also compares the stored fields one by one, since the rendered lines don't carry priority.
export type StoredItem = RenderItem & { priority: Priority | null }
export function checkStored(p: Parsed, stored: { groups: RenderGroup[]; items: StoredItem[] }): Failure[] {
  const failures = roundTrip(p, stored)
  const items = [...stored.items].sort((a, b) => a.id - b.id)
  if (items.length !== p.items.length) {
    return [...failures, { check: "stored", message: `server has ${items.length} items, the file has ${p.items.length}` }]
  }
  const groupName = new Map(stored.groups.map((g) => [g.id, g.name]))
  const index = new Map(items.map((s, k) => [s.id, k]))
  p.items.forEach((want, k) => {
    const got = items[k]!
    const wantGroup = want.group === null ? null : p.groups[want.group]!.name
    const diffs = [
      ["title", want.title, got.title],
      ["body", want.body, got.body],
      ["status", want.status, got.status],
      ["priority", want.priority, got.priority],
      ["section", want.section, got.section],
      ["group", wantGroup, got.group_id === null ? null : (groupName.get(got.group_id) ?? "?")],
      ["parent", want.parent, got.parent_id === null ? null : (index.get(got.parent_id) ?? "?")],
    ].filter(([, a, b]) => a !== b)
    for (const [field] of diffs) failures.push({ check: "stored", line: want.line, text: want.title, message: `${field} differs on the server (#${got.id})` })
  })
  return failures
}

export function asRenderInput(p: Parsed): { groups: RenderGroup[]; items: StoredItem[] } {
  return {
    groups: p.groups.map((g) => ({ id: g.key, name: g.name, note: g.note })),
    items: p.items.map((i) => ({ id: i.key, group_id: i.group, parent_id: i.parent, section: i.section, title: i.title, body: i.body, status: i.status, priority: i.priority })),
  }
}

const textLines = (s: string) => s.split("\n").filter((l) => l.trim()).map((text) => ({ text }))

// `## P1 — Name` compares as `## Name`, and [X] as [x].
function normal(line: string): string {
  const t = squash(line).replace(/^(\s*)- \[X\] /, "$1- [x] ")
  const h = t.match(/^## (P\d)\s*[—–-]\s*(.+)$/)
  return h ? `## ${h[2]}` : t
}

// Multiset comparison, reporting original line numbers for anything missing.
function compare(original: string[], skip: Set<number>, got: string[], norm: (s: string) => string, check: string): Failure[] {
  const left = new Map<string, number[]>()
  original.forEach((l, i) => {
    if (!l.trim() || skip.has(i)) return
    const k = norm(l)
    left.set(k, [...(left.get(k) ?? []), i + 1])
  })
  const failures: Failure[] = []
  for (const l of got) {
    if (!l.trim()) continue
    const k = norm(l)
    const lines = left.get(k)
    if (lines?.length) lines.shift()
    else failures.push({ check, text: k, message: check === "placed" ? "placed twice" : "not in the original" })
  }
  for (const [text, lines] of left) for (const line of lines) failures.push({ check, line, text, message: check === "placed" ? "not placed anywhere" : "missing after the round trip" })
  return failures
}

export type Report = {
  path: string
  repo: { id: string; name: string }
  ok: boolean
  items: number
  by_status: Record<Status, number>
  by_priority: Record<Priority | "inbox", number>
  groups: string[]
  children: number
  flattened: { line: number; text: string }[]
  mappings: { line: number; text: string; to: "P3" | "inbox" }[]
  merged: { line: number; text: string }[]
  preamble: { line: number; text: string }[]
  separators: number[]
  failures: Failure[]
}

export function report(path: string, repo: { id: string; name: string }, p: Parsed, failures: Failure[]): Report {
  const by_status = { todo: 0, doing: 0, done: 0 }
  const by_priority = { P0: 0, P1: 0, P2: 0, P3: 0, inbox: 0 }
  for (const i of p.items) {
    by_status[i.status]++
    by_priority[i.priority ?? "inbox"]++
  }
  return {
    path,
    repo,
    ok: failures.length === 0,
    items: p.items.length,
    by_status,
    by_priority,
    groups: p.groups.map((g) => g.name),
    children: p.items.filter((i) => i.parent !== null).length,
    flattened: p.flattened,
    mappings: p.mappings,
    merged: p.merged,
    preamble: p.preamble,
    separators: p.separators.map((s) => s.line),
    failures,
  }
}
