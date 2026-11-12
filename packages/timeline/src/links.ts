// Links a session to the efforts it worked on. Design: atlas/timeline/design.html#session-links.
// cwd and branch cannot do it (the lead session ran in another repo while it built Alts); three signals can.

import type { Pr } from "./build"
import type { DayFacts } from "./session"

export type Signal = "todos" | "prs" | "files"
export type SessionLink = { group_id: number; signals: Signal[] }

export type EffortRef = {
  group_id: number
  /** `owner/name` of the checkout's origin, to match `pr-link` records. */
  remote: string | null
  branches: string | null
  prs: Pr[]
  /** The effort folder, under every path that reaches it (the store, and the repo's `atlas/` link). */
  folders: string[]
  /** The checkout, when the repo has only this effort; a write anywhere in it then counts. */
  soloRoot: string | null
}

/** `git@github.com:o/n.git` or `https://github.com/o/n` to `o/n`. */
export function remoteName(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)
  return m ? m[1]! : null
}

// A branch pattern as `git for-each-ref` reads it: `*` matches across `/` too.
const globRe = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  )

const under = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`)

/**
 * Which efforts a session worked on, and by which signals. `todoGroups` are the groups of the todos the
 * server says the session changed.
 */
export function linkSession(days: Record<string, DayFacts>, todoGroups: number[], efforts: EffortRef[]): SessionLink[] {
  const all = Object.values(days)
  const prs = [...new Set(all.flatMap((d) => d.prs))].map((u) => u.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)).filter((m): m is RegExpMatchArray => !!m)
  const files = [...new Set(all.flatMap((d) => d.files))]
  const out: SessionLink[] = []
  for (const e of efforts) {
    const signals: Signal[] = []
    if (todoGroups.includes(e.group_id)) signals.push("todos")
    if (e.remote && e.branches) {
      const re = globRe(e.branches)
      const hit = prs.some(([, repo, n]) => repo === e.remote && e.prs.some((p) => p.number === Number(n) && re.test(p.branch)))
      if (hit) signals.push("prs")
    }
    if (files.some((f) => e.folders.some((d) => under(f, d)) || (e.soloRoot && under(f, e.soloRoot)))) signals.push("files")
    if (signals.length) out.push({ group_id: e.group_id, signals })
  }
  // A group with no branches is not in `efforts`, but its todos still tie the session to it.
  for (const g of new Set(todoGroups)) if (!out.some((l) => l.group_id === g)) out.push({ group_id: g, signals: ["todos"] })
  return out
}
