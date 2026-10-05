import { InboxIcon } from "lucide-react"
import { cn } from "cn"
import type { Status } from "@/lib/todos"

// Linear-style marks. Lucide's signal icons have no dimmed bars, so these are drawn here.

const BAR_COLOR: Record<string, string> = { P1: "text-p1", P2: "text-p2", P3: "text-p3" }
const BARS: Record<string, number> = { P1: 3, P2: 2, P3: 1 }

/** Takes a row key: inbox or P0 to P3. */
export function PriorityIcon({ row, className }: { row: string; className?: string }) {
  if (row === "inbox") return <InboxIcon aria-hidden className={cn("size-4 shrink-0 text-inbox", className)} />
  if (row === "P0")
    return (
      <svg aria-hidden viewBox="0 0 16 16" className={cn("size-4 shrink-0 text-p0", className)}>
        <rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" />
        <path d="M8 4.25v4.5" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="1.05" fill="white" />
      </svg>
    )
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={cn("size-4 shrink-0", BAR_COLOR[row], className)}>
      {[0, 1, 2].map((n) => (
        <rect key={n} x={1.5 + n * 5} y={8 - n * 3} width="3" height={6 + n * 3} rx="1" fill="currentColor" opacity={n < BARS[row]! ? 1 : 0.25} />
      ))}
    </svg>
  )
}

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  if (status === "done")
    return (
      <svg aria-hidden viewBox="0 0 14 14" className={cn("size-3.5 shrink-0 text-done", className)}>
        <circle cx="7" cy="7" r="6.5" fill="currentColor" />
        <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  return (
    <svg aria-hidden viewBox="0 0 14 14" className={cn("size-3.5 shrink-0", status === "doing" ? "text-doing" : "text-muted-foreground", className)}>
      <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {status === "doing" && <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />}
    </svg>
  )
}
