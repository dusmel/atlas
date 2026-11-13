// Merges git, the todo group, run.md, timeline.md and the effort folder into the entries that
// POST /api/timeline takes. Rules and their reasons: atlas/timeline/design.html#entries.
import { readPlanHeadings, readRunMd, readTimelineMd } from "./files"
import { addEvidence, addFlow, firstDay, flowRank, type EffortDoc, type SessionDays } from "./flow"
import type { BranchWork } from "./git"

export type Line = { day: string | null; text: string; source: "git" | "todo" | "run" | "note" | "doc" | "session"; ref: string | null; kind: string | null }
export type State = "done" | "doing" | "todo" | "parked"
export type Entry = {
  entry: string
  state: State
  title: string
  note?: string
  note_state?: "none" | "draft" | "written"
  merged: boolean
  lines: Line[]
  started_at: string | null
  ended_at: string | null
}

export type TodoItem = { id: number; title: string; status: "todo" | "doing" | "done"; parent_id: number | null; done_at: string | null; updated_at: string }
export type Pr = { number: number; branch: string; state: string; url: string; mergedAt: string | null }
export type EffortFiles = {
  plan?: string
  design?: string
  runMd?: string
  timelineMd?: string
  evidence?: { name: string; day: string }[]
  /** Every doc in the folder with its type and created time, for the entries around the build. */
  docs?: EffortDoc[]
  /** How a session's doc line names this folder, such as `atlas/timeline/`. */
  docPrefix?: string
}

const STATES: State[] = ["done", "doing", "todo", "parked"]
const RANK: Record<State, number> = { done: 0, doing: 1, parked: 2, todo: 3 }
const PHASE_TODO = /^Phase (\d+)\b/i
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null)
/** The server takes titles up to 200 characters. A longer plan heading keeps its first sentence, else is cut at a word. */
export const shortTitle = (t: string, max = 200) => {
  if (t.length <= max) return t
  const first = /^(.+?\.)\s/.exec(t)?.[1]
  return first && first.length <= max ? first : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`
}
const humanize = (slug: string) => {
  const s = slug.replace(/[-_]+/g, " ").trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** `v1/1-alternatives` is phase-1, or the plan's own anchor for the slug, such as `polish` for `v1/3-polish`. */
export function entryIdFor(branch: string, anchors: Set<string>): string {
  const leaf = branch.split("/").at(-1)!
  const m = /^(\d+)-(.+)$/.exec(leaf)
  const candidates = m ? [`phase-${m[1]}`, m[2]!] : [leaf]
  return candidates.find((c) => anchors.has(c)) ?? candidates[0]!
}

export function buildEntries(input: { work: BranchWork[]; todos: TodoItem[]; prs?: Pr[]; files?: EffortFiles; sessions?: SessionDays[]; unpushed?: string[] }): Entry[] {
  const files = input.files ?? {}
  const headings = readPlanHeadings(files.plan ?? "")
  const fileEntries = readTimelineMd(files.timelineMd ?? "")
  const run = readRunMd(files.runMd ?? "")
  const entries: Entry[] = []
  const byId = new Map<string, Entry>()
  const add = (e: Entry) => {
    entries.push(e)
    byId.set(e.entry, e)
    return e
  }

  // Git: one entry per branch in the stack. The newest open branch is the work in progress.
  const anchors = new Set(headings.keys())
  input.work.forEach((w, i) => {
    if (!w.commits.length) return
    const id = entryIdFor(w.branch, anchors)
    const pr = input.prs?.find((p) => p.branch === w.branch)
    const merged = pr?.state === "MERGED"
    const lines: Line[] = w.commits.map((c) => ({ day: c.day, text: c.subject, source: "git", ref: c.short, kind: null }))
    if (pr) lines.push({ day: day(pr.mergedAt) ?? w.commits.at(-1)!.day, text: `PR ${pr.number}`, source: "git", ref: pr.url, kind: merged ? "pr-merged" : "pr" })
    add({
      entry: id,
      state: merged || i < input.work.length - 1 ? "done" : "doing",
      title: headings.get(id) ?? humanize(id),
      merged,
      lines,
      started_at: w.commits[0]!.at,
      ended_at: w.commits.at(-1)!.at,
    })
  })

  // Todos: a "Phase N:" todo sets its entry's state; its children become lines on it.
  const phaseOf = new Map<number, string>()
  for (const t of input.todos) {
    const m = PHASE_TODO.exec(t.title)
    if (!m) continue
    const id = `phase-${m[1]}`
    phaseOf.set(t.id, id)
    const e = byId.get(id) ?? add({ entry: id, state: "todo", title: headings.get(id) ?? t.title, merged: false, lines: [], started_at: null, ended_at: null })
    if (!e.merged) e.state = t.status
    if (!headings.has(id)) e.title = t.title
    // A phase with no branch and no boxes still happened on the day it was marked done.
    if (t.status === "done" && t.done_at && !e.started_at) e.ended_at = t.done_at
  }
  const doingEntry = () => entries.find((e) => e.state === "doing")
  const nowEntry = () =>
    doingEntry() ?? add({ entry: "now", state: "doing", title: run.now ?? "In progress", merged: false, lines: [], started_at: null, ended_at: null })
  let next: Entry | null = null
  for (const t of input.todos) {
    if (phaseOf.has(t.id)) continue
    const line: Line = { day: day(t.done_at ?? t.updated_at), text: t.title, source: "todo", ref: String(t.id), kind: t.status === "done" ? null : t.status }
    const parent = t.parent_id !== null ? phaseOf.get(t.parent_id) : undefined
    if (parent) byId.get(parent)!.lines.push(line)
    else if (t.status === "doing") nowEntry().lines.push(line)
    else if (t.status === "todo") {
      next ??= { entry: "next", state: "todo", title: "Next", merged: false, lines: [], started_at: null, ended_at: null }
      next.lines.push({ ...line, day: null, kind: "next" })
    } else {
      // A done todo goes on the entry whose work spans its day, else the last one before it.
      const d = line.day!
      const home = entries.filter((e) => e.started_at && day(e.started_at)! <= d).at(-1) ?? entries[0]
      home?.lines.push(line)
    }
  }

  // run.md: what the agent says is open now, and what it parked.
  if (run.now && doingEntry()) doingEntry()!.lines.unshift({ day: null, text: run.now, source: "run", ref: null, kind: "now" })
  for (const p of run.parked) nowEntry().lines.push({ day: null, text: p.reason ? `${p.text} - ${p.reason}` : p.text, source: "run", ref: null, kind: "parked" })

  // timeline.md: the why, items that are not todos, and what waits on the owner. It overrides state and title.
  for (const f of fileEntries) {
    const e = byId.get(f.id) ?? add({ entry: f.id, state: "todo", title: humanize(f.id), merged: false, lines: [], started_at: null, ended_at: null })
    if (f.state && STATES.includes(f.state as State)) e.state = f.state as State
    if (f.title) e.title = f.title
    if (f.noteState === "draft") Object.assign(e, { note: "", note_state: "draft" })
    if (f.noteState === "written") Object.assign(e, { note: f.note!, note_state: "written" })
    for (const w of f.waiting) e.lines.push({ day: null, text: w, source: "note", ref: null, kind: "waiting" })
    for (const n of f.next) e.lines.push({ day: null, text: n, source: "note", ref: null, kind: "next" })
    for (const d of f.done) e.lines.push({ day: d.day, text: d.text, source: "note", ref: null, kind: "done" })
    if (f.done.length && !f.state && !byId.get(f.id)?.lines.some((l) => l.source !== "note")) e.state = "done"
  }
  // A `## next` section in timeline.md already made the Next entry; open todos join it.
  const fromFile = byId.get("next")
  if (next && fromFile) fromFile.lines.unshift(...next.lines)
  else if (next) add(next)

  addFlow(entries, {
    work: input.work,
    todos: input.todos,
    prs: input.prs ?? [],
    design: files.design ?? "",
    runMd: files.runMd ?? "",
    docs: files.docs ?? [],
    sessions: input.sessions ?? [],
    unpushed: input.unpushed ?? [],
    docPrefix: files.docPrefix ?? null,
  })
  addEvidence(entries, files.evidence ?? [])

  for (const e of entries) {
    // Days in order; lines with no day (what is open now, what comes next) after them.
    const key = (l: Line) => l.day ?? "9999"
    e.lines = e.lines.map((l, i) => [l, i] as const).sort(([a, i], [b, j]) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : i - j)).map(([l]) => l)
    const days = e.lines.map((l) => l.day).filter((d): d is string => !!d)
    e.started_at ??= days[0] ?? e.ended_at
    e.ended_at ??= days.at(-1) ?? null
  }
  // Done work by its first day, then in the order of the flow (brief before planning before the phases),
  // then by time. The rest by state, in the order it was added.
  const done = (a: Entry, b: Entry) =>
    firstDay(a).localeCompare(firstDay(b)) || flowRank(a.entry) - flowRank(b.entry) || Date.parse(a.started_at ?? "") - Date.parse(b.started_at ?? "") || 0
  return entries
    .map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => RANK[a.state] - RANK[b.state] || (a.state === "done" && b.state === "done" ? done(a, b) : 0) || i - j)
    .map(([e]) => ({ ...e, title: shortTitle(e.title) }))
}
