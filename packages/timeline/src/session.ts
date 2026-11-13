// Reads Claude Code transcripts (~/.claude/projects/<slug>/<uuid>.jsonl) into facts per local day.
// Design: atlas/timeline/design.html#sessions. Facts never hold prompt text or tool output; only
// dayText() returns conversation text, redacted, for the digest model, and nothing stores it.

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Digest } from "./digest"
import { redact } from "./redact"

export type DayFacts = {
  day: string
  /** Byte range of the transcript holding this day, so a digest can re-read just the day. */
  start: number
  end: number
  first: string
  last: string
  prompts: number
  commits: string[]
  prs: string[]
  todos: number[]
  files: string[]
  cwds: string[]
}

/** `pending`: ids of commit commands whose result was not read yet, since a result can land in the next read. */
export type SessionState = {
  path: string
  size: number
  offset: number
  title: string | null
  days: Record<string, DayFacts>
  pending?: string[]
  /** Each day's digest, with the day's end byte when it was made: a day that grew past it is digested again. */
  digests?: Record<string, { end: number; digest: Digest }>
}
/** `sent`: per server, a key for what was last posted for each session, so a sync posts only what changed. */
export type SyncState = { version: 1; sessions: Record<string, SessionState>; sent?: Record<string, Record<string, string>> }

type Rec = Record<string, any>

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])
// `git commit` prints "[branch 1a2b3c4] subject". With -q, agents print the hash after it with
// `git log --oneline -1` or `rev-parse --short HEAD`, so a line that starts with a hash counts too.
const COMMIT_CMD = /\bgit(?:\s+-[Cc]\s+\S+)*\s+commit\b/
const COMMIT_OUT = /^\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,12})\] /gm
const HASH_LINE = /^([0-9a-f]{7,12})(?:\s|$)/m
const TODO = /\btodo\s+(?:start|done|move|set|archive)\s+((?:#?\d+[\s,]*)+)/g
const SYSTEM_PROMPT = /^\s*<(?:task-notification|local-command-stdout|local-command-caveat|system-reminder)/

export function dayOf(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((c: Rec) => (c?.type === "text" ? c.text : c?.type === "tool_result" ? textOf(c.content) : ""))
    .filter(Boolean)
    .join("\n")
}

/** A prompt the owner typed, not a tool result, a meta record or a notification the harness injected. */
export function isPrompt(r: Rec): boolean {
  if (r.type !== "user" || r.isMeta || r.isSidechain || r.promptSource === "system") return false
  const c = r.message?.content
  if (Array.isArray(c) && c.some((x: Rec) => x?.type === "tool_result")) return false
  const text = textOf(c)
  return text.trim() !== "" && !SYSTEM_PROMPT.test(text)
}

function emptyDay(day: string, at: number): DayFacts {
  return { day, start: at, end: at, first: "", last: "", prompts: 0, commits: [], prs: [], todos: [], files: [], cwds: [] }
}

const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])]

export function mergeDay(a: DayFacts | undefined, b: DayFacts): DayFacts {
  if (!a) return b
  return {
    day: a.day,
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    first: [a.first, b.first].filter(Boolean).sort()[0] ?? "",
    last: [a.last, b.last].filter(Boolean).sort().at(-1) ?? "",
    prompts: a.prompts + b.prompts,
    commits: union(a.commits, b.commits),
    prs: union(a.prs, b.prs),
    todos: union(a.todos, b.todos).sort((x, y) => x - y),
    files: union(a.files, b.files),
    cwds: union(a.cwds, b.cwds),
  }
}

/** Calls fn for each complete line from byte `from`, with its byte offsets. Returns the offset after the last full line. */
async function eachLine(path: string, from: number, fn: (line: string, start: number, end: number) => void, to?: number): Promise<number> {
  const bytes = new Uint8Array(await Bun.file(path).slice(from, to).arrayBuffer())
  const dec = new TextDecoder()
  let at = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 10) continue
    if (i > at) fn(dec.decode(bytes.subarray(at, i)), from + at, from + i + 1)
    at = i + 1
  }
  // A line still being written has no newline yet: leave it for the next read.
  return from + at
}

/** Facts per day from byte `from` to the last complete line. */
export async function readSession(
  path: string,
  from = 0,
  timeZone?: string,
  pending: string[] = [],
): Promise<{ offset: number; title: string | null; days: Record<string, DayFacts>; pending: string[] }> {
  const days: Record<string, DayFacts> = {}
  const open = new Set(pending)
  let title: string | null = null
  let current: DayFacts | null = null
  const offset = await eachLine(path, from, (line, start, end) => {
    let r: Rec
    try {
      r = JSON.parse(line)
    } catch {
      return
    }
    if (r.type === "ai-title" && r.aiTitle) title = r.aiTitle
    if (r.timestamp) {
      const day = dayOf(r.timestamp, timeZone)
      current = days[day] ??= emptyDay(day, start)
      if (!current.first || r.timestamp < current.first) current.first = r.timestamp
      if (r.timestamp > current.last) current.last = r.timestamp
    }
    const d = current as DayFacts | null
    if (!d) return
    d.end = end
    if (r.isSidechain) return
    if (r.cwd && !d.cwds.includes(r.cwd)) d.cwds.push(r.cwd)
    if (r.type === "pr-link" && r.prUrl && !d.prs.includes(r.prUrl)) d.prs.push(r.prUrl)
    if (r.type === "user") {
      if (isPrompt(r)) d.prompts++
      else if (Array.isArray(r.message?.content)) {
        for (const c of r.message.content as Rec[]) {
          if (c?.type !== "tool_result" || !open.delete(c.tool_use_id)) continue
          const out = textOf(c.content)
          const hashes = [...out.matchAll(COMMIT_OUT)].map((m) => m[1]!)
          if (!hashes.length && HASH_LINE.test(out)) hashes.push(out.match(HASH_LINE)![1]!)
          for (const h of hashes) if (!d.commits.includes(h)) d.commits.push(h)
        }
      }
    }
    if (r.type === "assistant" && Array.isArray(r.message?.content)) {
      for (const c of r.message.content as Rec[]) {
        if (c?.type !== "tool_use") continue
        if (WRITE_TOOLS.has(c.name) && typeof c.input?.file_path === "string" && !d.files.includes(c.input.file_path)) d.files.push(c.input.file_path)
        if (c.name === "Bash" && typeof c.input?.command === "string") {
          if (COMMIT_CMD.test(c.input.command)) open.add(c.id)
          for (const m of c.input.command.matchAll(TODO)) for (const id of m[1]!.match(/\d+/g) ?? []) if (!d.todos.includes(Number(id))) d.todos.push(Number(id))
        }
      }
    }
  })
  for (const d of Object.values(days)) d.todos.sort((a, b) => a - b)
  return { offset, title, days, pending: [...open] }
}

/** Days with a prompt, a commit or a written file. A day of only background records (a re-sent `pr-link`) is not work. */
export function activeDays(days: Record<string, DayFacts>): DayFacts[] {
  return Object.values(days)
    .filter((d) => d.prompts > 0 || d.commits.length > 0 || d.files.length > 0)
    .sort((a, b) => a.day.localeCompare(b.day))
}

const CAP = 1500
const cap = (s: string, n = CAP) => (s.length > n ? `${s.slice(0, n)} [...]` : s)

/**
 * The conversation in a byte range, for the digest model only: the owner's prompts, the agent's replies
 * and the one-line description of each command. No tool output. Every secret-looking line is dropped.
 */
export async function dayText(path: string, start: number, end: number): Promise<{ text: string; dropped: number }> {
  const out: string[] = []
  await eachLine(
    path,
    start,
    (line) => {
      let r: Rec
      try {
        r = JSON.parse(line)
      } catch {
        return
      }
      if (r.isSidechain) return
      if (isPrompt(r)) out.push(`You: ${cap(textOf(r.message.content).trim())}`)
      if (r.type === "assistant" && Array.isArray(r.message?.content)) {
        for (const c of r.message.content as Rec[]) {
          if (c?.type === "text" && c.text.trim()) out.push(`Agent: ${cap(c.text.trim())}`)
          if (c?.type === "tool_use" && c.name === "Bash" && c.input?.description) out.push(`Ran: ${cap(String(c.input.description), 200)}`)
          if (c?.type === "tool_use" && WRITE_TOOLS.has(c.name) && c.input?.file_path) out.push(`Wrote: ${c.input.file_path}`)
        }
      }
    },
    end,
  )
  return redact(out.join("\n"))
}

export const STATE_PATH = join(process.env.HOME ?? "", ".cache/atlas/timeline-sync.json")

export async function loadState(path = STATE_PATH): Promise<SyncState> {
  if (!existsSync(path)) return { version: 1, sessions: {} }
  return (await Bun.file(path).json()) as SyncState
}

export async function saveState(state: SyncState, path = STATE_PATH): Promise<void> {
  mkdirSync(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(state))
}

/** Top-level transcripts only. Subagent transcripts sit one folder deeper and belong to their parent session. */
export function listTranscripts(projectsDir: string): { id: string; path: string; size: number }[] {
  if (!existsSync(projectsDir)) return []
  const out: { id: string; path: string; size: number }[] = []
  for (const slug of readdirSync(projectsDir)) {
    const dir = join(projectsDir, slug)
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue
      const path = join(dir, n)
      out.push({ id: n.slice(0, -".jsonl".length), path, size: statSync(path).size })
    }
  }
  return out
}

/** Reads every transcript's new bytes into the state. Returns the ids of the sessions that changed. */
export async function scanTranscripts(state: SyncState, projectsDir: string, timeZone?: string): Promise<string[]> {
  const changed: string[] = []
  for (const t of listTranscripts(projectsDir)) {
    let s = state.sessions[t.id]
    // A transcript that shrank was rewritten: read it again from the start.
    if (!s || s.path !== t.path || t.size < s.offset) s = { path: t.path, size: 0, offset: 0, title: null, days: {} }
    if (t.size === s.offset) continue
    const read = await readSession(t.path, s.offset, timeZone, s.pending)
    if (read.offset === s.offset) continue
    for (const d of Object.values(read.days)) s.days[d.day] = mergeDay(s.days[d.day], d)
    state.sessions[t.id] = { ...s, size: t.size, offset: read.offset, title: read.title ?? s.title, pending: read.pending }
    changed.push(t.id)
  }
  return changed
}
