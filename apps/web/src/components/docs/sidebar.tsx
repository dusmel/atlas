import { Button } from "@/components/ui/button"
import type { Option, Summary } from "@/lib/docs"
import { useRepoColor } from "@/lib/doc-colors"
import { CheckList } from "./filters"

/** The repos with their counts, then `children`: Type and Tags. Wide screens only; phones get the Filters drawer. */
export function DocsSidebar({ summary, repoOptions, repos, onToggle, onAll, children }: { summary?: Summary; repoOptions: Option[]; repos: string[]; onToggle: (v: string) => void; onAll: () => void; children?: React.ReactNode }) {
  const repoColor = useRepoColor()
  return (
    <aside aria-label="Filters" className="hidden md:block">
      <div className="sticky top-19 flex max-h-[calc(100dvh-6rem)] flex-col gap-3">
        <div className="-mr-2 flex min-h-0 flex-col gap-4 overflow-y-auto pr-2">
          <CheckList
            name="repo"
            legend="Repos"
            options={repoOptions}
            picked={repos}
            onToggle={onToggle}
            color={repoColor}
            action={
              repos.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={onAll}>
                  Show all
                </Button>
              )
            }
          />
          {children}
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
