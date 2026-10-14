// A time window typed as 30m, 1h, 2d or 1w. Shared by the Todos and Docs filters and the search API.

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const
const UNIT_NAME = { m: "minute", h: "hour", d: "day", w: "week" } as const
const SINCE = /^(\d{1,4})\s*([mhdw])$/

/** "30m", "1h", "2d" or "1w" as milliseconds, or null when it isn't one. */
export function sinceMs(since?: string): number | null {
  const m = since?.trim().toLowerCase().match(SINCE)
  return m && Number(m[1]) > 0 ? Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS] : null
}

/** "2d" as "2 days", "1h" as "hour". */
export function sinceLabel(since: string): string {
  const [, n, u] = since.trim().toLowerCase().match(SINCE)!
  const name = UNIT_NAME[u as keyof typeof UNIT_NAME]
  return n === "1" ? name : `${n} ${name}s`
}
