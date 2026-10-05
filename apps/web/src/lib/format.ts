import type { ItemEvent } from "./todos"

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" })
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" })

export function ago(at: string, now = Date.now()): string {
  const s = (Date.parse(at) - now) / 1000
  const a = Math.abs(s)
  if (a < 60) return "just now"
  if (a < 3600) return relative.format(Math.round(s / 60), "minute")
  if (a < 86400) return relative.format(Math.round(s / 3600), "hour")
  if (a < 7 * 86400) return relative.format(Math.round(s / 86400), "day")
  return date.format(new Date(at))
}

export const exact = (at: string) => dateTime.format(new Date(at))

const QUIET = new Set(["rank", "done_at", "updated_at", "archived_at"])
const label = (p: unknown) => (p === null ? "Inbox" : String(p))

/** One line per event, in the same words as `atlas todo show`. */
export function describe(e: ItemEvent): string {
  if (e.action === "create") return "created it"
  if (e.action === "import") return "imported it"
  if (e.action === "archive") return "archived it"
  if (e.action === "unarchive") return "restored it"
  const parts: string[] = []
  for (const [k, v] of Object.entries(e.data ?? {})) {
    if (QUIET.has(k) || !Array.isArray(v) || v.length !== 2) continue
    const [from, to] = v as [unknown, unknown]
    if (k === "status") parts.push(`${from} → ${to}`)
    else if (k === "priority") parts.push(`${label(from)} → ${label(to)}`)
    else if (k === "parent_id") parts.push(to === null ? "removed the parent" : `made it a child of #${to}`)
    else parts.push(`changed the ${k.replace(/_id$/, "")}`)
  }
  if (parts.length) return parts.join(", ")
  return e.action === "move" || "rank" in (e.data ?? {}) ? "moved it" : e.action
}
