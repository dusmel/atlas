import { Link } from "@tanstack/react-router"
import { GitMergeIcon } from "lucide-react"
import { Fragment, useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"
import { cn } from "cn"
import { RichTitle } from "@/components/todos/rich-title"
import { docLinks } from "@/lib/docs"
import { commitBase, dayLabel, spanLabel, type EffortView, type TimelineEntry, type TimelineLine } from "@/lib/timeline"

// Design: atlas/timeline/design.html#look-rail. Oldest work first, then now, then what comes next.

const WHEN: Record<TimelineEntry["state"], string> = {
  done: "",
  doing: "now",
  todo: "next",
  parked: "parked",
}

/** The rail of one effort. Compact folds every entry but now to one line. */
export function Rail({ view, compact }: { view: EffortView; compact: boolean }) {
  const nowRef = useRef<HTMLLIElement>(null)
  const base = commitBase(view.entries)
  const notes = docLinks(view.docs_folder)
  const noteLink = (url: string) => (view.effort_dir && !/^([a-z][a-z0-9+.-]*:|[#/?])/i.test(url) ? notes(`${view.effort_dir}/${url}`) : notes(url))

  // The page opens scrolled to now.
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: "center" })
  }, [view.group.id])

  const doingAt = view.entries.findIndex((e) => e.state === "doing")
  const lastDone = view.entries.map((e) => e.state).lastIndexOf("done")
  // The line is solid up to now, dotted after it.
  const solidUntil = doingAt >= 0 ? doingAt : lastDone
  const dotTop = (e: TimelineEntry, open: boolean) => (e.state === "doing" ? 14 : open ? 4 : 5)

  return (
    <ol className="mt-3.5 flex flex-col" aria-label="Timeline">
      {view.entries.map((e, i) => {
        const open = !compact || e.state === "doing"
        const next = view.entries[i + 1]
        const gap = open ? 26 : 10
        const top = dotTop(e, open)
        const nextTop = next ? dotTop(next, !compact || next.state === "doing") : 0
        const doing = e.state === "doing"
        const future = e.state !== "done"
        const when = e.state === "done" ? spanLabel(e) : WHEN[e.state]
        const meta = outcome(e)
        return (
          <li
            key={e.entry}
            ref={doing ? nowRef : undefined}
            data-entry={e.entry}
            data-state={e.state}
            className={cn("relative pl-[42px]", doing && "rounded-r-[10px] bg-[color-mix(in_oklab,var(--doing)_9%,transparent)] py-2.5 pr-4 pb-3", future && !doing && "text-foreground/75")}
            style={{ marginBottom: next ? gap : 0 }}
          >
            {next && (
              <span
                aria-hidden
                className="absolute left-[7px] w-0.5"
                style={{
                  top: top + 22,
                  bottom: -(gap + nextTop - 6),
                  background: i < solidUntil ? "var(--border)" : "repeating-linear-gradient(var(--muted-foreground) 0 5px, transparent 5px 10px)",
                  opacity: i < solidUntil ? 1 : 0.5,
                }}
              />
            )}
            <Dot state={e.state} top={top} />
            {open ? (
              <div className="flex flex-col gap-1">
                {when && <div className={cn("font-mono text-[12.5px]", doing ? "font-medium text-[color-mix(in_oklab,var(--doing)_70%,black)] dark:text-doing" : "text-muted-foreground")}>{when}</div>}
                <h2 className="flex items-center gap-2 text-[17px] font-semibold">
                  {e.title}
                  {e.merged && <Merged size={16} />}
                </h2>
                {e.note && (
                  <div className="text-[14.5px] leading-relaxed text-foreground/85 [&_a]:text-link [&_a]:underline-offset-2 hover:[&_a]:underline [&_p]:my-1">
                    <ReactMarkdown urlTransform={noteLink}>{e.note}</ReactMarkdown>
                  </div>
                )}
                <Lines lines={e.lines.filter((l) => !l.kind?.startsWith("pr"))} base={base} />
                {meta && <div className="mt-1 text-[12.5px] text-muted-foreground">{meta}</div>}
              </div>
            ) : (
              <div className="flex items-baseline gap-3 text-[14.5px]">
                <span className="w-[86px] shrink-0 font-mono text-[12.5px] text-muted-foreground">{when}</span>
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {e.title}
                  {e.merged && <Merged size={14} />}
                </span>
                <span className="grow" />
                <span className="text-[12.5px] whitespace-nowrap text-muted-foreground max-sm:hidden">{meta}</span>
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The grey outcome line at an entry's end: its commits and PRs, or how many items wait. */
function outcome(e: TimelineEntry) {
  const commits = e.lines.filter((l) => l.source === "git" && !l.kind).length
  const prs = e.lines.filter((l) => l.kind?.startsWith("pr")).map((l) => l.text)
  if (e.state === "todo" || e.state === "parked") return e.lines.length ? `${e.lines.length} ${e.lines.length === 1 ? "item" : "items"}` : ""
  return [commits && `${commits} ${commits === 1 ? "commit" : "commits"}`, prs.join(", ")].filter(Boolean).join(" · ")
}

/** An entry's lines, under a day heading when the entry spans more than one day. */
function Lines({ lines, base }: { lines: TimelineLine[]; base: string | null }) {
  if (!lines.length) return null
  const days = new Set(lines.map((l) => l.day).filter(Boolean))
  const split = days.size > 1
  let last: string | null | undefined
  return (
    <ul className="mt-1 flex list-disc flex-col gap-[3px] pl-[18px] text-[14.5px] leading-normal marker:text-muted-foreground">
      {lines.map((l, i) => {
        const head = split && l.day !== last && l.day ? dayLabel(l.day) : null
        last = l.day
        return (
          <Fragment key={i}>
            {head && <li className="-ml-[18px] list-none pt-1 font-mono text-[11.5px] text-muted-foreground">{head}</li>}
            <li>
              {l.kind === "waiting" && <b className="font-semibold text-[color-mix(in_oklab,var(--doing)_60%,black)] dark:text-doing">You: </b>}
              {l.href ? (
                <a href={l.href} className="text-link underline-offset-2 hover:underline">
                  {l.text}
                </a>
              ) : (
                <RichTitle text={l.text} />
              )}{" "}
              <Source line={l} base={base} />
            </li>
          </Fragment>
        )
      })}
    </ul>
  )
}

/** Where a line came from: a commit and a todo link to themselves. */
function Source({ line, base }: { line: TimelineLine; base: string | null }) {
  const cls = "font-mono text-[11px]"
  if (line.source === "todo" && line.ref)
    return (
      <Link to="/todos" search={{ item: Number(line.ref) }} className={cn(cls, "text-link underline-offset-2 hover:underline")}>
        todo #{line.ref}
      </Link>
    )
  if (line.source === "git" && line.ref && base)
    return (
      <a href={`${base}/commit/${line.ref}`} target="_blank" rel="noopener" className={cn(cls, "text-link underline-offset-2 hover:underline")}>
        git {line.ref}
      </a>
    )
  const label = line.source === "git" && line.ref ? `git ${line.ref}` : line.kind === "parked" ? "run · parked" : line.source
  return <span className={cn(cls, "text-muted-foreground")}>{label}</span>
}

const CHECK = (
  <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
    <path d="M4.5 8.5l2.3 2.3L11.5 6" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Green with a check for done, an amber ring for now, a dashed ring for to do. The ring of page colour keeps a gap from the line. */
export function Dot({ state, top, size = 16 }: { state: TimelineEntry["state"]; top?: number; size?: number }) {
  return (
    <span
      aria-label={state}
      role="img"
      className={cn(
        "flex items-center justify-center rounded-full",
        top !== undefined && "absolute left-0 shadow-[0_0_0_5px_var(--background)]",
        state === "done" && "bg-done",
        state === "doing" && "border-[3px] border-doing bg-background",
        (state === "todo" || state === "parked") && "border-2 border-dashed border-muted-foreground bg-background",
      )}
      style={{ top, width: size, height: size }}
    >
      {state === "done" && CHECK}
    </span>
  )
}

export function Merged({ size }: { size: number }) {
  return (
    <span title="Merged" className="inline-flex text-done">
      <GitMergeIcon style={{ width: size, height: size }} strokeWidth={2.2} aria-label="merged" />
    </span>
  )
}
