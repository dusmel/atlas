import { groupColor } from "@/components/todos/group-color"

/** A repo keeps one colour everywhere, picked the way groups pick theirs. */
export const repoColor = (repo: string) => groupColor(repo)

// html-docs' badge colours (doc-types.ts), with its aliases, so a type looks the same in the app and in the doc.
const TYPES: Record<string, string> = { design: "#7c3aed", plan: "#2563eb", reference: "#0f766e", analysis: "#c2410c", explainer: "#db2777", review: "#b91c1c", report: "#15803d", todo: "#475569" }
const ALIASES: Record<string, string> = { research: "analysis", "deep-dive": "analysis", ref: "reference" }
export const typeColor = (type: string) => TYPES[ALIASES[type] ?? type] ?? "#64748b"

const DAY = 864e5
/** Change age in three steps: this week green, older than 60 days amber, neutral between. */
export function ageTone(at: string, now = Date.now()): string {
  const age = now - new Date(at).getTime()
  if (age < 7 * DAY) return "text-fresh"
  if (age >= 60 * DAY) return "text-old"
  return "text-muted-foreground"
}
