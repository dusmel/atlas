import { Link } from "@tanstack/react-router"
import { BoxIcon, CopyIcon, ListTodoIcon } from "lucide-react"
import { Fragment } from "react"
import { cn } from "cn"
import { copy } from "@/components/todos/copy-id"
import { docKey, docPath, type Hit } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

export const copyPath = (d: { path: string }) => copy(docPath(d), `Copied ${docPath(d)}`)

/** Search results and the recent list. `selected` is the row j and k move and focus; its bar and background are the focus mark. */
export function Hits({ hits, label, selected, onSelect }: { hits: Hit[]; label: string; selected?: string; onSelect: (key: string) => void }) {
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
              on ? "bg-muted before:bg-primary" : "hover:bg-muted/50",
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <h3 className="min-w-0 flex-1 font-medium text-pretty">{h.title}</h3>
              {h.todos && <TodosLink todos={h.todos} />}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1" translate="no">
                <BoxIcon aria-hidden className="size-3" />
                {h.repo}
              </span>
              <CopyPath doc={h} />
              <time dateTime={h.mtime} title={exact(h.mtime)} className="tabular-nums">
                {ago(h.mtime)}
              </time>
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

function TodosLink({ todos }: { todos: NonNullable<Hit["todos"]> }) {
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
