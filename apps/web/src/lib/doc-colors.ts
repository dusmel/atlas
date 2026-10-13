import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { api } from "@/lib/api"
import type { Summary } from "@/lib/docs"

// Twelve colours that stay apart from each other, in light and dark: --palette-0 to 11 in styles.css.
const PALETTE = 12
const swatch = (slot: number) => `var(--palette-${slot})`
function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/** Each repo starts at its name's slot and takes the next free one, so up to twelve repos never share a colour. */
export function paletteSlots(names: string[]): Map<string, number> {
  const slots = new Map<string, number>()
  const taken = new Set<number>()
  for (const name of [...new Set(names)].sort()) {
    let slot = hash(name) % PALETTE
    for (let i = 0; i < PALETTE && taken.has(slot); i++) slot = (slot + 1) % PALETTE
    slots.set(name, slot)
    taken.add(slot)
  }
  return slots
}

/** A repo's colour, from the docs summary every page shares. Before it loads, a repo gets its name's slot. */
export function useRepoColor(): (repo: string) => string {
  const repos = useQuery({ queryKey: ["docs"], queryFn: () => api<Summary>("/docs"), staleTime: 60_000 }).data?.repos
  return useMemo(() => {
    const slots = paletteSlots((repos ?? []).map((r) => r.name))
    return (repo: string) => swatch(slots.get(repo) ?? hash(repo) % PALETTE)
  }, [repos])
}

/** A tag keeps one colour on every doc. */
export const tagColor = (tag: string) => swatch(hash(tag.toLowerCase()) % PALETTE)

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
