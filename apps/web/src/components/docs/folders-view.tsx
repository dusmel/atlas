import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { BoxIcon, FileTextIcon, FolderIcon } from "lucide-react"
import { Fragment, useEffect, useState } from "react"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { api } from "@/lib/api"
import { ageTone, typeColor, useRepoColor } from "@/lib/doc-colors"
import { docHref, docKey, tagList, type FolderListing } from "@/lib/docs"
import { ago, exact } from "@/lib/format"
import { TagPills } from "./hits"

const link = "underline-offset-3 hover:text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded"
const up = (path: string) => path.split("/").slice(0, -1).join("/")

/**
 * The docs folders from the root, one level at a time: subfolders first, then docs. `path` is "" for
 * the root, which lists the repos. `params` carries the repo, type and tag filters.
 */
export function DocFolders({ path, params, filtered }: { path: string; params: URLSearchParams; filtered: boolean }) {
  const repoColor = useRepoColor()
  const navigate = useNavigate({ from: "/docs" })
  const q = useQuery({
    queryKey: ["doc-folders", path, params.toString()],
    queryFn: () => api<FolderListing>(`/docs/folders?${new URLSearchParams({ path, ...Object.fromEntries(params) })}`),
    placeholderData: (prev) => prev,
  })
  const [selected, setSelected] = useState<string>()
  const go = (to: string, select?: string) => {
    setSelected(select)
    void navigate({ search: (s) => ({ ...s, path: to || undefined }) })
  }
  const into = (name: string) => (path ? `${path}/${name}` : name)

  const rows = [...(q.data?.folders ?? []).map((f) => `folder:${f.name}`), ...(q.data?.docs ?? []).map((d) => `doc:${docKey(d)}`)]
  const move = (step: 1 | -1) => {
    if (!rows.length) return
    const at = rows.indexOf(selected ?? "")
    const next = rows[at === -1 ? (step === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + step))]!
    setSelected(next)
    const row = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(next)}"]`)
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: "nearest" })
  }
  // After going up, the folder just left is selected; focus it once it shows, so Enter goes back in.
  useEffect(() => {
    if (selected && document.activeElement === document.body) document.querySelector<HTMLElement>(`[data-row="${CSS.escape(selected)}"]`)?.focus({ preventScroll: true })
  }, [q.data, selected])
  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    // Back up a level, with the folder just left selected.
    Backspace: () => path && go(up(path), `folder:${path.split("/").at(-1)}`),
  })

  const crumbs = path ? path.split("/") : []
  const row = (key: string, open: () => void) => ({
    "data-row": key,
    "data-selected": key === selected || undefined,
    "aria-current": key === selected || undefined,
    tabIndex: key === selected ? 0 : -1,
    onClick: () => setSelected(key),
    onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && open(),
    className: cn(
      "group/hit relative -mx-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 transition-colors outline-none",
      "before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent",
      key === selected ? "bg-muted before:bg-link" : "hover:bg-muted/50",
    ),
  })

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm" translate="no">
        <Link from="/docs" to="/docs" search={(s) => ({ ...s, path: undefined })} className={cn(link, crumbs.length ? "text-muted-foreground" : "font-medium")} aria-current={crumbs.length ? undefined : "page"}>
          All repos
        </Link>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            <span aria-hidden className="text-muted-foreground/60">
              /
            </span>
            <Link
              from="/docs"
              to="/docs"
              search={(s) => ({ ...s, path: crumbs.slice(0, i + 1).join("/") })}
              className={cn(link, i === crumbs.length - 1 ? "font-medium" : "text-muted-foreground")}
              aria-current={i === crumbs.length - 1 ? "page" : undefined}
            >
              {c}
            </Link>
          </Fragment>
        ))}
      </nav>

      {q.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{q.error.message}</p>
      ) : !rows.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No docs here</EmptyTitle>
            <EmptyDescription>{filtered ? "No doc in this folder fits the filters." : "This folder holds no doc."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol aria-label={path ? `Folder ${path}` : "Repos"} className="flex flex-col">
          {q.data.folders.map((f) => {
            const key = `folder:${f.name}`
            const Icon = path ? FolderIcon : BoxIcon
            return (
              <li key={key} {...row(key, () => go(into(f.name)))}>
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" style={path ? undefined : { color: repoColor(f.name) }} />
                <Link from="/docs" to="/docs" search={(s) => ({ ...s, path: into(f.name) })} tabIndex={-1} onClick={(e) => e.stopPropagation()} className={cn(link, "min-w-0 flex-1 truncate font-medium")} translate="no">
                  {f.name}
                </Link>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {f.docs} {f.docs === 1 ? "doc" : "docs"}
                </span>
                <time dateTime={f.last} title={exact(f.last)} className={cn("min-w-16 text-right text-xs whitespace-nowrap tabular-nums", ageTone(f.last))}>
                  {ago(f.last)}
                </time>
              </li>
            )
          })}
          {q.data.docs.map((d) => {
            const key = `doc:${docKey(d)}`
            return (
              <li key={key} {...row(key, () => void navigate({ href: docHref(d) }))}>
                <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                {/* The title wraps the rest onto a line of its own when the row is narrower than about 16rem plus them. */}
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <a href={docHref(d)} tabIndex={-1} onClick={(e) => e.stopPropagation()} className={cn(link, "min-w-0 flex-[1_1_16rem] text-pretty")}>
                    {d.title}
                  </a>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    {d.type && (
                      <Badge className="rounded-sm font-mono text-[10.5px] text-white uppercase" style={{ background: typeColor(d.type) }}>
                        {d.type}
                      </Badge>
                    )}
                    <TagPills tags={tagList(d.tags)} />
                    <time dateTime={d.mtime} title={exact(d.mtime)} className={cn("min-w-16 text-right text-xs whitespace-nowrap tabular-nums", ageTone(d.mtime))}>
                      {ago(d.mtime)}
                    </time>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {rows.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground max-md:hidden">
          <span>
            <Kbd>J</Kbd> <Kbd>K</Kbd> to move
          </span>
          <span>
            <Kbd>↵</Kbd> to open
          </span>
          <span>
            <Kbd>⌫</Kbd> to go up a level
          </span>
        </p>
      )}
    </div>
  )
}
