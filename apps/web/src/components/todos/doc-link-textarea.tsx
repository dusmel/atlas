import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState } from "react"
import { cn } from "cn"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { repoColor } from "@/lib/doc-colors"
import { docKey, type Hit } from "@/lib/docs"

type Pick = { start: number; end: number; query: string }
type Props = Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & { value: string; onValueChange: (value: string) => void; folder: string | null }

const TRIGGER = /\[\[([^[\]\n]*)$/
const segments = (path: string) => path.split("/").map(encodeURIComponent).join("/")

/** The link `[[` inserts: `atlas/<path>` for a doc in the item's own repo, as copied paths read, else its /r/ page. */
export function docLink(hit: Hit, folder: string | null): string {
  const title = hit.title.replace(/[[\]\\]/g, "\\$&")
  return `[${title}](${hit.repo === folder ? `atlas/${segments(hit.path)}` : `/r/${encodeURIComponent(hit.repo)}/${segments(hit.path)}`})`
}

/** A textarea where `[[` opens a list of docs to link, the item's repo first. Arrows move, Enter inserts, Esc closes. */
export function DocLinkTextarea({ value, onValueChange, folder, onKeyDown, onBlur, className, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const list = useId()
  const [pick, setPick] = useState<Pick | null>(null)
  const [active, setActive] = useState(0)
  // Esc closes the list until the `[[` it was opened from changes.
  const dismissed = useRef<number | null>(null)

  const [q, setQ] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setQ(pick?.query.trim() ?? ""), 120)
    return () => clearTimeout(t)
  }, [pick?.query])
  const found = useQuery({
    queryKey: ["doc-link", q],
    queryFn: () => api<{ results: Hit[] }>(`/search?${new URLSearchParams({ q, limit: "20" })}`),
    enabled: !!pick,
    placeholderData: keepPreviousData,
  })
  const hits = [...(found.data?.results ?? [])].sort((a, b) => Number(b.repo === folder) - Number(a.repo === folder)).slice(0, 8)
  const open = !!pick && hits.length > 0

  const track = (text: string, caret: number) => {
    const m = TRIGGER.exec(text.slice(0, caret))
    const start = m ? caret - m[0].length : -1
    if (!m) dismissed.current = null
    if (!m || start === dismissed.current) return setPick(null)
    setPick((p) => (p?.start === start && p.query === m[1] ? p : { start, end: caret, query: m[1]! }))
    setActive(0)
  }

  const insert = (hit: Hit) => {
    if (!pick) return
    const link = docLink(hit, folder)
    onValueChange(value.slice(0, pick.start) + link + value.slice(pick.end))
    setPick(null)
    const caret = pick.start + link.length
    requestAnimationFrame(() => ref.current?.setSelectionRange(caret, caret))
  }

  // Sheets and dialogs take Escape on the document in the capture phase, so the list has to catch it first.
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.target !== ref.current) return
      e.preventDefault()
      e.stopPropagation()
      dismissed.current = pick!.start
      setPick(null)
    }
    window.addEventListener("keydown", esc, true)
    return () => window.removeEventListener("keydown", esc, true)
  }, [open, pick])

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={ref}
        value={value}
        className={className}
        aria-controls={open ? list : undefined}
        aria-activedescendant={open ? `${list}-${active}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value)
          track(e.target.value, e.target.selectionStart)
        }}
        onSelect={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={(e) => {
          setPick(null)
          onBlur?.(e)
        }}
        onKeyDown={(e) => {
          if (open && !e.metaKey && !e.ctrlKey) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              return setActive((i) => (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length)
            }
            if (e.key === "Enter") {
              e.preventDefault()
              return insert(hits[active] ?? hits[0]!)
            }
          }
          onKeyDown?.(e)
        }}
      />
      {open && (
        <ul id={list} role="listbox" aria-label="Docs to link" className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {hits.map((h, i) => (
            <li
              key={docKey(h)}
              id={`${list}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), insert(h))}
              onMouseMove={() => setActive(i)}
              className={cn("flex min-w-0 cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm", i === active && "bg-accent text-accent-foreground")}
            >
              <span className="truncate">{h.title}</span>
              <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground" translate="no">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: repoColor(h.repo) }} />
                <span className="truncate">
                  {h.repo}/{h.path}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
