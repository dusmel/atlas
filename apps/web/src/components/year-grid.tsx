import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"

const STEP = 13
const CELL = 10
const LEFT = 26
const TOP = 16
const month = new Intl.DateTimeFormat("en-GB", { month: "short" })
const long = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
// Level 0 is an empty day; 1 to 4 deepen the accent.
const FILL = ["color-mix(in oklab, var(--foreground) 7%, transparent)", ...[30, 50, 75, 100].map((p) => `color-mix(in oklab, var(--link) ${p}%, transparent)`)]

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const monday = (d: Date) => (d.getDay() + 6) % 7

/** 53 weeks of local days ending today, each week a column from Monday. */
function weeks(today: Date): Date[][] {
  const out: Date[][] = []
  for (let d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - monday(today) - 52 * 7); d <= today; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (monday(d) === 0) out.push([])
    out.at(-1)!.push(d)
  }
  return out
}

/** Busy days split at the quartiles, so one big day doesn't wash out the rest. */
function leveller(counts: number[]): (n: number) => number {
  const busy = counts.filter(Boolean).sort((a, b) => a - b)
  const cuts = [0.25, 0.5, 0.75].map((p) => busy[Math.floor(p * (busy.length - 1))] ?? 0)
  return (n) => (n ? 1 + cuts.filter((c) => n > c).length : 0)
}

/** A year of days, GitHub style: one square a day, darker for more. Reads `{ days: { "YYYY-MM-DD": count } }` from `source`. */
export function YearGrid({ source, params, noun }: { source: "/events/days" | "/docs/activity/days"; params: URLSearchParams; noun: [string, string] }) {
  const query = new URLSearchParams(params)
  query.set("tz", String(-new Date().getTimezoneOffset()))
  const q = useQuery({
    queryKey: [source === "/events/days" ? "events" : "doc-activity", "days", params.toString()],
    queryFn: () => api<{ days: Record<string, number> }>(`${source}?${query}`),
  })
  const cols = useMemo(() => weeks(new Date()), [])
  const scroller = useRef<HTMLDivElement>(null)
  // On a narrow screen the grid scrolls; start at the recent end.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [q.data])

  const height = TOP + 7 * STEP
  if (q.isPending) return <Skeleton className="w-full" style={{ height: height + 24 }} aria-label="Loading the year" />
  if (q.isError) return null

  const days = q.data.days
  const level = leveller(Object.values(days))
  const total = Object.values(days).reduce((a, b) => a + b, 0)
  const width = LEFT + cols.length * STEP
  const months = cols.flatMap((w, i) => (i > 0 && w[0]!.getMonth() !== cols[i - 1]![0]!.getMonth() ? [{ i, label: month.format(w[0]!) }] : []))
  const summary = `${total.toLocaleString("en-GB")} ${total === 1 ? noun[0] : noun[1]} in the last year`

  return (
    <figure className="flex flex-col gap-2" data-year-grid>
      <figcaption className="text-xs font-medium text-muted-foreground">{summary}</figcaption>
      <div ref={scroller} className="overflow-x-auto">
        <svg role="img" aria-label={summary} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block text-[9px] text-muted-foreground">
          {months.map((m) => (
            <text key={m.i} x={LEFT + m.i * STEP} y={10} fill="currentColor">
              {m.label}
            </text>
          ))}
          {["Mon", "Wed", "Fri"].map((d, i) => (
            <text key={d} x={0} y={TOP + i * 2 * STEP + CELL - 1} fill="currentColor">
              {d}
            </text>
          ))}
          {cols.map((w, i) =>
            w.map((d) => {
              const key = dayKey(d)
              const n = days[key] ?? 0
              return (
                <rect key={key} data-day={key} data-count={n} x={LEFT + i * STEP} y={TOP + monday(d) * STEP} width={CELL} height={CELL} rx={2} style={{ fill: FILL[level(n)] }}>
                  <title>{`${n || "No"} ${n === 1 ? noun[0] : noun[1]} on ${long.format(d)}`}</title>
                </rect>
              )
            }),
          )}
        </svg>
      </div>
      <div aria-hidden className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
        Less
        {FILL.map((f) => (
          <span key={f} className="size-2.5 rounded-[2px]" style={{ background: f }} />
        ))}
        More
      </div>
    </figure>
  )
}
