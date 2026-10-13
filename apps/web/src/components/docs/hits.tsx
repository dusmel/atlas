import { Link } from "@tanstack/react-router"
import { BoxIcon, CopyIcon, ListTodoIcon, ShapesIcon, TagIcon } from "lucide-react"
import { Fragment } from "react"
import { cn } from "cn"
import { copy } from "@/components/todos/copy-id"
import { GroupDot } from "@/components/todos/filters"
import { groupColor } from "@/components/todos/group-color"
import { plainTitle } from "@/components/todos/rich-title"
import { Badge } from "@/components/ui/badge"
import { ageTone, tagColor, typeColor, useRepoColor } from "@/lib/doc-colors"
import { docHref, docKey, docPath, tagList, type Hit } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

export const copyPath = (d: { path: string }) => copy(docPath(d), `Copied ${docPath(d)}`)

/** Search results and the recent list. `selected` is the row j and k move and focus; its bar and background are the focus mark. */
export function Hits({ hits, label, selected, onSelect }: { hits: Hit[]; label: string; selected?: string; onSelect: (key: string) => void }) {
  const repoColor = useRepoColor()
  return (
    <ol aria-label={label} className="flex flex-col">
      {hits.map((h) => {
        const key = docKey(h)
        const on = key === selected
        return (
          <li
            key={key}
            data-result={key}
            data-selected={on || undefined}
            aria-current={on || undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(key)}
            onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && copyPath(h)}
            className={cn(
              "group/hit relative -mx-3 flex min-w-0 flex-col gap-1 rounded-lg px-3 py-3 transition-colors outline-none",
              "before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent",
              on ? "bg-muted before:bg-link" : "hover:bg-muted/50",
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <h3 className="min-w-0 flex-1 font-medium text-pretty">
                {/* A plain link: html docs are served raw, outside the app's router. */}
                <a href={docHref(h)} tabIndex={-1} onClick={(e) => e.stopPropagation()} className="underline-offset-3 hover:text-link hover:underline">
                  {h.title}
                </a>
              </h3>
              {h.todos && <TodosLink todos={h.todos} />}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1" translate="no">
                <BoxIcon aria-hidden className="size-3" style={{ color: repoColor(h.repo) }} />
                {h.repo}
              </span>
              <CopyPath doc={h} />
              <time dateTime={h.mtime} title={exact(h.mtime)} className={cn("tabular-nums", ageTone(h.mtime))}>
                {ago(h.mtime)}
              </time>
              <TypeBadge type={h.type} />
              <Details hit={h} />
            </div>
            {h.snippet && (
              <p className="line-clamp-3 text-sm break-words text-muted-foreground">
                <Snippet text={h.snippet} />
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The path, which copies itself when clicked. The icon shows on hover, on the selected row, and on touch screens. */
export function CopyPath({ doc }: { doc: { path: string } }) {
  return (
    <button
      type="button"
      title={`Copy ${docPath(doc)}`}
      aria-label={`Copy the path ${docPath(doc)}`}
      onClick={(e) => (e.stopPropagation(), copyPath(doc))}
      className="flex min-w-0 cursor-pointer items-center gap-1 rounded font-mono hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      translate="no"
    >
      <span className="min-w-0 truncate">{doc.path}</span>
      <CopyIcon aria-hidden className="size-3 shrink-0 opacity-0 group-hover/hit:opacity-100 group-data-selected/hit:opacity-100 pointer-coarse:opacity-100" />
    </button>
  )
}

/** The doc's tags as pills in their own colours, then the todo groups that link it, each opening its todos. */
function Details({ hit }: { hit: Hit }) {
  const tags = tagList(hit.tags)
  return (
    <>
      <TagPills tags={tags} />
      {hit.groups?.map((g) => (
        <Link
          key={g.id}
          data-group
          to="/todos"
          search={{ view: "list", group: String(g.id) }}
          onClick={(e) => e.stopPropagation()}
          title="Todo group that links this doc"
          className="flex min-w-0 items-center gap-1 rounded-md border bg-background py-px pr-1.5 pl-1 text-[11px] leading-4 text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <GroupDot color={groupColor(g.name)} />
          <span className="sr-only">Group: </span>
          <span className="truncate">{plainTitle(g.name)}</span>
        </Link>
      ))}
    </>
  )
}

/** The doc's type in its html-docs colour, with the Type filter's icon. Nothing for a doc without one. */
export function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  return (
    <Badge data-type className="gap-1 rounded-sm font-mono text-[10.5px] text-white uppercase [&>svg]:size-3" style={{ background: typeColor(type) }}>
      <ShapesIcon aria-hidden />
      <span className="sr-only">Type: </span>
      {type}
    </Badge>
  )
}

/** Tags as pills, each in its own colour, after the Tag filter's icon. */
export function TagPills({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <ul data-tags aria-label="Tags" className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <li
          key={t}
          className="flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10.5px] leading-4 font-medium"
          style={{ background: `color-mix(in oklab, ${tagColor(t)} 15%, transparent)`, color: `color-mix(in oklab, ${tagColor(t)} 75%, var(--foreground))` }}
        >
          <TagIcon aria-hidden className="size-2.5 shrink-0" />
          {t}
        </li>
      ))}
    </ul>
  )
}

export function TodosLink({ todos }: { todos: NonNullable<Hit["todos"]> }) {
  return (
    <Link
      to="/todos"
      search={{ view: "list", group: todos.groups.join(",") }}
      onClick={(e) => e.stopPropagation()}
      title="Open todos in groups that link to this doc"
      className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ListTodoIcon aria-hidden className="size-3.5" />
      {todos.open} open {todos.open === 1 ? "todo" : "todos"}
    </Link>
  )
}

// The server marks each match with \u0002 … \u0003, so the doc's text is never read as HTML.
function Snippet({ text }: { text: string }) {
  return text.split(/(\u0002[^\u0003]*\u0003)/).map((part, n) =>
    part.startsWith("\u0002") ? (
      <mark key={n} className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/25">
        {part.slice(1, -1)}
      </mark>
    ) : (
      <Fragment key={n}>{part}</Fragment>
    ),
  )
}
