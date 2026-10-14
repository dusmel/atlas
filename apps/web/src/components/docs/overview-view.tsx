import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { folderLabel, type RepoOverview } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

/**
 * One row per repo, the most recently changed first. The bar splits its docs into changed this
 * week, in between, and untouched for 60 days, so stale repos stand out.
 */
export function DocOverview({ repos }: { repos: string[] }) {
  const q = useQuery({ queryKey: ["doc-overview"], queryFn: () => api<{ repos: RepoOverview[] }>("/docs/overview") })
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the overview">
        {[0, 1, 2, 3, 4].map((n) => (
          <Skeleton key={n} className="h-11" />
        ))}
      </div>
    )
  if (q.isError) return <p className="text-sm text-destructive">{q.error.message}</p>
  const rows = q.data.repos.filter((r) => !repos.length || repos.includes(r.repo)).sort((a, b) => b.last.localeCompare(a.last))
  const max = Math.max(1, ...rows.map((r) => r.docs))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <Key className="bg-primary" label="Changed this week" />
        <Key className="bg-primary/35" label="Changed in the last 60 days" />
        <Key className="bg-muted-foreground/20" label="Untouched for 60 days" />
      </div>
      <table className="w-full text-sm" aria-label="Docs per repo">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-2 pr-3 font-medium">
              Repo
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Docs
            </th>
            <th scope="col" className="w-[40%] py-2 pr-3 font-medium max-sm:sr-only">
              Freshness
            </th>
            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">
              Last change
            </th>
            <th scope="col" className="py-2 font-medium max-lg:hidden">
              Main folders
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const middle = r.docs - r.week - r.stale
            return (
              <tr key={r.repo} data-repo={r.repo} className="border-b last:border-b-0">
                <th scope="row" className="max-w-48 py-2.5 pr-3 text-left font-medium">
                  <Link to="/docs" search={{ repo: r.repo }} className="block truncate rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" translate="no">
                    {r.repo}
                  </Link>
                </th>
                <td className="py-2.5 pr-3 text-right tabular-nums" title={`${r.md} markdown, ${r.html} html files`}>
                  {r.docs}
                </td>
                <td className="py-2.5 pr-3 max-sm:hidden">
                  <div className="flex h-2 overflow-hidden rounded-full" style={{ width: `${Math.max(4, (r.docs / max) * 100)}%` }} title={`${r.week} this week, ${middle} in between, ${r.stale} untouched for 60 days`}>
                    <span className="bg-primary" style={{ flexGrow: r.week }} />
                    <span className="bg-primary/35" style={{ flexGrow: middle }} />
                    <span className="bg-muted-foreground/20" style={{ flexGrow: r.stale }} />
                  </div>
                  <span className="sr-only">
                    {r.week} changed this week, {r.stale} untouched for 60 days
                  </span>
                </td>
                <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground tabular-nums">
                  <time dateTime={r.last} title={exact(r.last)}>
                    {ago(r.last)}
                  </time>
                </td>
                <td className="py-2.5 text-muted-foreground max-lg:hidden">
                  <span className="line-clamp-1">
                    {r.folders
                      .slice(0, 3)
                      .map((f) => `${folderLabel(f.folder)} ${f.docs}`)
                      .join(", ")}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const Key = ({ className, label }: { className: string; label: string }) => (
  <span className="flex items-center gap-1.5">
    <span className={cn("size-2 rounded-full", className)} />
    {label}
  </span>
)
