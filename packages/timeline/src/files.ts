// Readers for the effort folder's files. Each takes the file's text and never throws on shape:
// run.md and timeline.md are written by agents, so a line the reader does not know is skipped.

/** The two loose keys the sync reads from run.md (design: #run-md). */
export type RunMd = { now: string | null; parked: { text: string; reason: string | null }[] }

const BULLET = /^\s*[-*]\s+(.+)$/
// A reason follows a dash with spaces round it, or an em or en dash.
const REASON = /\s+(?:-|–|—)\s+/

export function readRunMd(text: string): RunMd {
  const lines = text.split("\n")
  let now: string | null = null
  const parked: RunMd["parked"] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const key = /^\s*(?:Phase|Now):\s*(.+?)\s*$/.exec(line)
    if (key && now === null) now = key[1]!
    if (!/^\s*(?:#+\s*)?Parked:?\s*$/i.test(line)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!
      if (!l.trim()) {
        if (parked.length) break
        continue
      }
      const b = BULLET.exec(l)
      if (!b) break
      const [item, ...reason] = b[1]!.split(REASON)
      parked.push({ text: item!.trim(), reason: reason.length ? reason.join(" - ").trim() : null })
    }
  }
  return { now, parked }
}

/** What timeline.md says about one entry (design: #timeline-md). */
export type FileEntry = {
  id: string
  state: string | null
  title: string | null
  note: string | null
  noteState: "draft" | "written" | null
  waiting: string[]
  next: string[]
}

/** Entries by id, in file order. A note is `note:` plus any plain lines under it. */
export function readTimelineMd(text: string): FileEntry[] {
  const out: FileEntry[] = []
  let cur: FileEntry | null = null
  let inNote = false
  for (const line of text.split("\n")) {
    const head = /^##\s+(\S+)\s*(\{[^}]*\})?\s*$/.exec(line)
    if (head) {
      const attrs = head[2] ?? ""
      cur = {
        id: head[1]!,
        state: /state:\s*([a-z]+)/.exec(attrs)?.[1] ?? null,
        title: /title:\s*"([^"]+)"/.exec(attrs)?.[1] ?? null,
        note: null,
        noteState: null,
        waiting: [],
        next: [],
      }
      out.push(cur)
      inNote = false
      continue
    }
    if (!cur) continue
    const kv = /^(note|waiting|next|title):\s*(.*)$/.exec(line)
    if (kv) {
      const [, key, value] = kv
      inNote = key === "note"
      if (key === "note") {
        if (value!.trim() === "draft") cur.noteState = "draft"
        else {
          cur.note = value!.trim()
          cur.noteState = "written"
        }
      } else if (key === "waiting") cur.waiting.push(value!.trim())
      else if (key === "next") cur.next.push(value!.trim())
      else cur.title = value!.trim()
      continue
    }
    if (inNote && cur.noteState === "written" && line.trim()) cur.note += `\n${line.trim()}`
    else if (!line.trim()) inNote = false
  }
  return out
}

/** The plan's `## Title {#anchor}` headings, so an entry gets the plan's name for its phase. */
export function readPlanHeadings(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of text.matchAll(/^##\s+(.+?)\s*\{#([a-z0-9-]+)\}\s*$/gm)) out.set(m[2]!, m[1]!)
  return out
}
