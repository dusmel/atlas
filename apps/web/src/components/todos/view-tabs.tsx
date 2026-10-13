import { Link } from "@tanstack/react-router"
import { ActivityIcon, ChartColumnIcon, InboxIcon, ListIcon, SquareKanbanIcon, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "cn"

export const VIEWS = [
  { id: "board", label: "Board", icon: SquareKanbanIcon },
  { id: "list", label: "List", icon: ListIcon },
  { id: "triage", label: "Triage", icon: InboxIcon },
  { id: "overview", label: "Overview", icon: ChartColumnIcon },
  { id: "activity", label: "Activity", icon: ActivityIcon },
] as const

export type View = (typeof VIEWS)[number]["id"]

/**
 * View tabs for Todos and Docs. Links, not buttons, so a view opens in a new tab too. Phones show
 * the icons only. The first view is the page's default and leaves `view` out of the URL.
 */
export function ViewNav<V extends string>({ to, views, view, extra, className }: { to: "/todos" | "/docs"; views: readonly { id: V; label: string; icon: LucideIcon }[]; view: V; extra?: (id: V) => ReactNode; className?: string }) {
  return (
    <nav aria-label="Views" className={cn("flex items-center gap-1 overflow-x-auto", className)}>
      {views.map((v, i) => (
        <Link
          key={v.id}
          to={to}
          // Each page types its own search; both keep the filters and change only `view`.
          search={((s: Record<string, unknown>) => ({ ...s, view: i === 0 ? undefined : v.id })) as never}
          aria-current={view === v.id ? "page" : undefined}
          title={v.label}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:min-w-11 max-sm:justify-center",
            view === v.id && "bg-accent font-medium text-foreground",
          )}
        >
          <v.icon className="size-4" aria-hidden />
          <span className="max-sm:sr-only">{v.label}</span>
          {extra?.(v.id)}
        </Link>
      ))}
    </nav>
  )
}

export function ViewTabs({ view, inbox }: { view: View; inbox: number }) {
  return (
    <ViewNav
      to="/todos"
      views={VIEWS}
      view={view}
      className="px-4 pt-3 sm:px-6"
      extra={(id) => id === "triage" && inbox > 0 && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{inbox}</span>}
    />
  )
}
