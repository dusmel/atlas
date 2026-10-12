import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { DOC_VIEWS, type DocView, type Option, type Summary } from "@/lib/docs"
import { CheckList } from "./filters"

const viewLink = "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** Views on top, then the repos with their counts. Wide screens only; phones get tabs and the Filters drawer. */
export function DocsSidebar({ view, summary, repoOptions, repos, onToggle, onAll }: { view: DocView; summary?: Summary; repoOptions: Option[]; repos: string[]; onToggle: (v: string) => void; onAll: () => void }) {
  return (
    <aside aria-label="Docs views and repos" className="hidden md:block">
      <div className="sticky top-19 flex max-h-[calc(100dvh-6rem)] flex-col gap-3">
        <nav aria-label="Views" className="flex flex-col">
          {DOC_VIEWS.map((v) => (
            <Link key={v.id} to="/docs" search={(s) => ({ ...s, view: v.id === "search" ? undefined : v.id })} aria-current={view === v.id ? "page" : undefined} className={cn(viewLink, view === v.id && "bg-muted font-medium text-foreground")}>
              <v.icon aria-hidden className="size-4" />
              {v.label}
            </Link>
          ))}
        </nav>
        <Separator />
        <div className="-mr-2 min-h-0 overflow-y-auto pr-2">
          <CheckList
            name="repo"
            legend="Repos"
            options={repoOptions}
            picked={repos}
            onToggle={onToggle}
            action={
              repos.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={onAll}>
                  Show all
                </Button>
              )
            }
          />
        </div>
        {summary && (
          <p className="px-2 text-xs text-muted-foreground tabular-nums" data-testid="docs-summary">
            {summary.docs} docs in {summary.repos.length} repos: {summary.md} markdown, {summary.html} html.
          </p>
        )}
      </div>
    </aside>
  )
}
