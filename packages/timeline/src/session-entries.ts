// A session's rail: one entry per active day, then "Left open" from the todos it changed that are not done.
// Design: atlas/timeline/design.html#look-orphans. Lines carry digests and facts, never prompt text.

import type { Entry, Line } from "./build"
import type { Digest } from "./digest"
import type { DayFacts } from "./session"

export type SessionTodo = { id: number; title: string; status: string }

/** Big enough to stand alone in the sidebar: 3+ commits, 3+ todos, 30+ prompts or 2+ days (design #look-orphans). */
export function bigEnough(s: { days: number; prompts: number; commits: number; todos: number }): boolean {
  return s.commits >= 3 || s.todos >= 3 || s.prompts >= 30 || s.days >= 2
}

const DOING_MS = 60 * 60 * 1000

export function sessionEntries(input: {
  id: string
  days: DayFacts[]
  digests: Record<string, Digest>
  /** Commit subjects by short hash, from the repos the session worked in. */
  subjects: Record<string, string>
  todos: SessionTodo[]
  /** A written file's label when it is a doc in an effort folder, else null. */
  docLabel: (path: string) => string | null
  now?: number
}): Entry[] {
  const now = input.now ?? Date.now()
  const titles = new Map(input.todos.map((t) => [t.id, t.title]))
  // Claude Code sends a PR's `pr-link` again on later days: show it on the first.
  const shownPrs = new Set<string>()
  const entries: Entry[] = input.days.map((d, i) => {
    const digest = input.digests[d.day]
    const lines: Line[] = []
    const say = (kind: string, texts: string[] | undefined) => {
      for (const text of texts ?? []) lines.push({ day: d.day, text, source: "session", ref: input.id, kind })
    }
    say("asked", digest?.asked)
    say("decided", digest?.decided)
    say("done", digest?.done)
    for (const h of d.commits) lines.push({ day: d.day, text: input.subjects[h] ?? h, source: "git", ref: h, kind: null })
    for (const url of d.prs) {
      if (shownPrs.has(url)) continue
      shownPrs.add(url)
      lines.push({ day: d.day, text: `PR ${url.split("/").at(-1)}`, source: "git", ref: url, kind: "pr" })
    }
    for (const id of d.todos) lines.push({ day: d.day, text: titles.get(id) ?? `Todo #${id}`, source: "todo", ref: String(id), kind: null })
    for (const label of new Set(d.files.map(input.docLabel).filter((l): l is string => !!l))) lines.push({ day: d.day, text: label, source: "doc", ref: null, kind: null })
    const last = i === input.days.length - 1
    const fallback = `${d.prompts} prompt${d.prompts === 1 ? "" : "s"}${d.commits.length ? `, ${d.commits.length} commit${d.commits.length === 1 ? "" : "s"}` : ""}`
    return {
      entry: d.day,
      state: last && now - Date.parse(d.last) < DOING_MS ? "doing" : "done",
      title: digest?.title || fallback,
      merged: false,
      lines,
      started_at: d.first,
      ended_at: d.last,
    }
  })
  const open = input.todos.filter((t) => t.status !== "done")
  if (open.length) {
    entries.push({
      entry: "open",
      state: "todo",
      title: "Left open",
      merged: false,
      lines: open.map((t) => ({ day: null, text: t.title, source: "todo", ref: String(t.id), kind: "next" })),
      started_at: null,
      ended_at: null,
    })
  }
  return entries
}
