import type { Status } from "../rules.ts"

// The same shape comes from a parsed file and from the server, so one renderer checks both.
export type RenderGroup = { id: number; name: string; note: string }
export type RenderItem = { id: number; group_id: number | null; parent_id: number | null; section: string | null; title: string; body: string; status: Status }

const MARK: Record<Status, string> = { todo: " ", doing: "-", done: "x" }
export const squash = (line: string) => line.trim().replace(/\s+/g, " ")

// Headings render as `## Name`: priority lives on each item now, so the round trip
// compares headings without their `P1 — ` prefix.
export function renderTodo(groups: RenderGroup[], items: RenderItem[]): string {
  const out: string[] = []
  const byId = (a: { id: number }, b: { id: number }) => a.id - b.id
  const sorted = [...items].sort(byId)
  const children = (id: number) => sorted.filter((i) => i.parent_id === id)
  const tops = sorted.filter((i) => i.parent_id === null)

  const emit = (item: RenderItem, depth: number) => {
    const pad = "  ".repeat(depth)
    out.push(`${pad}- [${MARK[item.status]}] ${item.title}`)
    for (const line of item.body ? item.body.split("\n") : []) out.push(line.trim() ? `${pad}  ${line}` : "")
    for (const c of children(item.id)) emit(c, depth + 1)
  }

  for (const item of tops.filter((i) => i.group_id === null)) emit(item, 0)
  for (const g of [...groups].sort(byId)) {
    out.push("", `## ${g.name}`)
    if (g.note) out.push("", ...g.note.split("\n"))
    const inNote = new Set(g.note.split("\n").map(squash))
    const shown = new Set<string>()
    let current: string | null = null
    for (const item of tops.filter((i) => i.group_id === g.id)) {
      if (item.section !== current) {
        current = item.section
        const heading = `### ${current}`
        if (current !== null && !inNote.has(squash(heading)) && !shown.has(current)) {
          out.push("", heading)
          shown.add(current)
        }
        out.push("")
      }
      emit(item, 0)
    }
  }
  return `${out.join("\n").trim()}\n`
}
