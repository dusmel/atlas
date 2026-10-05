import { Link } from "@tanstack/react-router"
import { ActivityIcon, ChartColumnIcon, InboxIcon, ListIcon, SquareKanbanIcon } from "lucide-react"
import { cn } from "cn"

export const VIEWS = [
  { id: "board", label: "Board", icon: SquareKanbanIcon },
  { id: "list", label: "List", icon: ListIcon },
  { id: "triage", label: "Triage", icon: InboxIcon },
  { id: "overview", label: "Overview", icon: ChartColumnIcon },
  { id: "activity", label: "Activity", icon: ActivityIcon },
] as const

export type View = (typeof VIEWS)[number]["id"]

/** Links, not buttons, so a view opens in a new tab too. Phones show the icons only. */
export function ViewTabs({ view, inbox }: { view: View; inbox: number }) {
  return (
    <nav aria-label="Views" className="flex items-center gap-1 overflow-x-auto px-4 pt-3 sm:px-6">
      {VIEWS.map((v) => (
        <Link
          key={v.id}
          to="/todos"
          search={(s) => ({ ...s, view: v.id === "board" ? undefined : v.id })}
          aria-current={view === v.id ? "page" : undefined}
          title={v.label}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:min-w-11 max-sm:justify-center",
            view === v.id && "bg-accent font-medium text-foreground",
          )}
        >
          <v.icon className="size-4" aria-hidden />
          <span className="max-sm:sr-only">{v.label}</span>
          {v.id === "triage" && inbox > 0 && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{inbox}</span>}
        </Link>
      ))}
    </nav>
  )
}
