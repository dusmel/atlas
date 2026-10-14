import { useNavigate } from "@tanstack/react-router"
import { SearchIcon } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { useRepoColor } from "@/lib/doc-colors"
import { docHref } from "@/lib/docs"
import { LOST_MAP_CSS, LOST_MAP_SVG } from "@/lib/lost-map"

type Near = { repo: string; path: string; title: string }

/** The app's 404 for a doc: the map, the docs with the closest paths, and a search for the file name. */
export function LostDoc({ repo, path, closest }: { repo: string; path: string; closest: Near[] }) {
  const repoColor = useRepoColor()
  const navigate = useNavigate()
  const name = path.split("/").pop()!.replace(/\.(md|html)$/, "")
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <DragMap />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-balance">This doc drifted off the map</h1>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono text-xs break-all text-foreground">
            {repo}/{path}
          </code>{" "}
          is not in the server's copy of the docs. If it is new, MEGA may not have synced it yet.
        </p>
      </div>
      {closest.length > 0 && (
        <section aria-labelledby="closest" className="flex flex-col gap-1">
          <h2 id="closest" className="text-xs font-medium text-muted-foreground">
            Closest paths
          </h2>
          <ul className="flex flex-col">
            {closest.map((d) => (
              <li key={`${d.repo}/${d.path}`}>
                <a href={docHref(d)} className="-mx-2 flex min-w-0 flex-col rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <span className="truncate text-sm font-medium hover:text-link">{d.title}</span>
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: repoColor(d.repo) }} />
                    <span className="truncate">
                      {d.repo}/{d.path}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const q = String(new FormData(e.currentTarget).get("q") ?? "").trim()
          void navigate({ to: "/docs", search: q ? { q } : {} })
        }}
      >
        <Input name="q" defaultValue={name} aria-label="Search the docs" />
        <Button type="submit" variant="outline">
          <SearchIcon data-icon="inline-start" />
          Search
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        <Kbd>⌘K</Kbd> finds a doc from anywhere.
      </p>
    </main>
  )
}

/** Drag to look around. Decorative, so it stays out of the tab order and the accessibility tree. */
function DragMap() {
  const [at, setAt] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v))
  return (
    <div
      aria-hidden
      className="relative h-48 cursor-grab touch-none overflow-hidden rounded-xl border bg-muted/30 text-muted-foreground select-none active:cursor-grabbing sm:h-56"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX - at.x, y: e.clientY - at.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => drag.current && setAt({ x: clamp(e.clientX - drag.current.x, 140), y: clamp(e.clientY - drag.current.y, 60) })}
      onPointerUp={() => (drag.current = null)}
    >
      <style>{LOST_MAP_CSS}</style>
      <div className="absolute top-1/2 left-1/2 w-[600px] max-w-none" style={{ transform: `translate(calc(-50% + ${at.x}px), calc(-50% + ${at.y}px))` }} dangerouslySetInnerHTML={{ __html: LOST_MAP_SVG }} />
    </div>
  )
}
