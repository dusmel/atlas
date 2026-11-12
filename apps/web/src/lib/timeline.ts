// What GET /api/timeline returns (src/server/timeline.ts, plus doc links from withTimelineLinks).

export type EntryState = "done" | "doing" | "todo" | "parked"

export type TimelineLine = {
  day: string | null
  text: string
  source: string
  ref: string | null
  kind: string | null
  href?: string | null
}

export type TimelineEntry = {
  entry: string
  position: number
  state: EntryState
  title: string
  note: string
  note_state: "none" | "draft" | "written"
  merged: boolean
  lines: TimelineLine[]
  started_at: string | null
  ended_at: string | null
  updated_at: string
}

export type GroupDoc = { label: string; path: string; href: string | null }

export type EffortView = {
  group: {
    id: number
    name: string
    repo_id: string
    repo_name: string
    branches: string | null
    open: number
    docs: GroupDoc[]
  }
  docs_folder: string | null
  effort_dir: string | null
  entries: TimelineEntry[]
}

export type EffortSummary = {
  id: number
  name: string
  repo_id: string
  repo_name: string
  branches: string | null
  docs: { label: string; path: string }[]
  open: number
  bar: { entry: string; title: string; state: EntryState }[]
  doing: string | null
  last_at: string | null
  waiting: { entry: string; text: string; ref: string | null }[]
  sessions: SessionSummary[]
}

/** A Claude Code session, as the sync stored it. `big` passes the size rule for a session with no effort. */
export type SessionSummary = {
  id: string
  agent: string
  title: string | null
  ai_title: string | null
  cwd: string | null
  repo_name: string | null
  started_at: string | null
  ended_at: string | null
  days: number
  prompts: number
  commits: number
  todos: number
  big?: boolean
}

export type TimelineList = { efforts: EffortSummary[]; sessions: SessionSummary[] }

export type SessionView = {
  session: SessionSummary & { efforts: { id: number; name: string; repo_name: string; signals: string[] }[] }
  entries: TimelineEntry[]
}

/** The digest title, else Claude Code's own title, else the short id. */
export const sessionTitle = (s: SessionSummary) => s.title || s.ai_title || s.id.slice(0, 8)

export const resumeCommand = (s: SessionSummary) => `${s.cwd ? `cd ${s.cwd} && ` : ""}claude --resume ${s.id}`

/** "12 Nov", or "5 to 12 Nov". */
export function sessionSpan(s: SessionSummary) {
  const from = s.started_at?.slice(0, 10)
  const to = s.ended_at?.slice(0, 10) ?? from
  if (!from || !to) return ""
  if (from === to) return fmt(from, { day: "numeric", month: "short" })
  return `${fmt(from, from.slice(0, 7) === to.slice(0, 7) ? { day: "numeric" } : { day: "numeric", month: "short" })} to ${fmt(to, { day: "numeric", month: "short" })}`
}

/** "4 days, 66 prompts, 30 commits": a session's size. */
export const sessionSize = (s: SessionSummary) => [count(s.days, "day"), count(s.prompts, "prompt"), count(s.commits, "commit")].filter(Boolean).join(", ")

const count = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? "" : "s"}` : "")

/** The sessions active on the days an entry covers. Sync does not record which session made an entry, so overlap stands in. */
export function entrySessions(e: TimelineEntry, sessions: SessionSummary[]) {
  const days = e.lines
    .map((l) => l.day)
    .filter((d): d is string => !!d)
    .sort()
  const from = (e.started_at ?? days[0])?.slice(0, 10)
  const to = (e.ended_at ?? days.at(-1))?.slice(0, 10)
  if (!from || !to) return []
  return sessions.filter((s) => s.started_at && s.ended_at && s.started_at.slice(0, 10) <= to && s.ended_at.slice(0, 10) >= from)
}

const DAY = 86_400_000

/** Whole days since an ISO date or time; null when there is none. */
export const daysSince = (iso: string | null, now = Date.now()) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) : null)

/** "today", "yesterday", "3d", "2w", "1mo", or "never". */
export const ago = (days: number | null) =>
  days === null ? "never" : days === 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? `${days}d` : days < 30 ? `${Math.floor(days / 7)}w` : `${Math.floor(days / 30)}mo`

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", opts)

/** "Thu 5 Nov" for a day. */
export const dayLabel = (iso: string) => fmt(iso, { weekday: "short", day: "numeric", month: "short" })

/** An entry's date line: one day, or "5 to 8 Nov" when it spans several. */
export function spanLabel(e: TimelineEntry) {
  const days = e.lines
    .map((l) => l.day)
    .filter((d): d is string => !!d)
    .sort()
  const from = (e.started_at ?? days[0])?.slice(0, 10)
  const to = (e.ended_at ?? days.at(-1))?.slice(0, 10)
  if (!from || !to) return null
  if (from === to) return dayLabel(from)
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  return `${fmt(from, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })} to ${fmt(to, { day: "numeric", month: "short" })}`
}

/** Where an effort stands, for its icon colour: doing, done, planned, or quiet when untouched 7+ days. */
export function effortState(e: EffortSummary, days: number | null): "doing" | "done" | "planned" | "quiet" {
  if (e.bar.length && e.bar.every((b) => b.state === "done")) return "done"
  if (days !== null && days >= 7) return "quiet"
  if (e.bar.some((b) => b.state === "doing")) return "doing"
  return "planned"
}

/** The commit page for a hash, from the effort's GitHub repo, which a PR line's url names. */
export function commitBase(entries: TimelineEntry[]) {
  for (const e of entries) for (const l of e.lines) if (l.kind?.startsWith("pr") && l.ref) return l.ref.replace(/\/pull\/\d+.*$/, "")
  return null
}
