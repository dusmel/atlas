import { Link } from "@tanstack/react-router"
import { ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, GitMergeIcon } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { cn } from "cn"
import { RichTitle } from "@/components/todos/rich-title"
import { docLinks } from "@/lib/docs"
import { commitBase, dayLabel, entrySessions, spanLabel, type SessionPrompt, type SessionSummary, type TimelineEntry, type TimelineLine } from "@/lib/timeline"
import { Prompts } from "./prompts"
import { SessionMarker } from "./session"

// Design: atlas/timeline/design.html#look-rail. Oldest work first, then now, then what comes next.

const WHEN: Record<TimelineEntry["state"], string> = {
  done: "",
  doing: "now",
  todo: "next",
  parked: "parked",
}

/**
 * The rail of an effort or a session. Compact folds every entry but now to one line. `sessions` are the
 * effort's sessions: each entry's outcome line ends with the ones active on its days. A session's `prompts`
 * lead each of its days, and the digest lines follow in small text.
 */
export function Rail({
  entries,
  owner,
  compact,
  docsFolder = null,
  effortDir = null,
  sessions = [],
  prompts = [],
}: {
  entries: TimelineEntry[]
  /** The effort or session id: the page scrolls to now when it changes. */
  owner: string | number
  compact: boolean
  docsFolder?: string | null
  effortDir?: string | null
  sessions?: SessionSummary[]
  prompts?: SessionPrompt[]
}) {
  const nowRef = useRef<HTMLLIElement>(null)
  // The days opened by hand, per entry. The owner is in the key, since entry ids repeat across efforts.
  const [opened, setOpened] = useState<Record<string, string[]>>({})
  const base = commitBase(entries)
  const notes = docLinks(docsFolder)
  const noteLink = (url: string) => (effortDir && !/^([a-z][a-z0-9+.-]*:|[#/?])/i.test(url) ? notes(`${effortDir}/${url}`) : notes(url))

  // The page opens scrolled to now.
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: "center" })
  }, [owner])

  const doingAt = entries.findIndex((e) => e.state === "doing")
  const lastDone = entries.map((e) => e.state).lastIndexOf("done")
  // The line is solid up to now, dotted after it.
  const solidUntil = doingAt >= 0 ? doingAt : lastDone
  const dotTop = (e: TimelineEntry, open: boolean) => (e.state === "doing" ? 14 : open ? 4 : 5)

  return (
    <ol className="mt-3.5 flex flex-col" aria-label="Timeline">
      {entries.map((e, i) => {
        const open = !compact || e.state === "doing"
        const next = entries[i + 1]
        const gap = open ? 26 : 10
        const top = dotTop(e, open)
        const nextTop = next ? dotTop(next, !compact || next.state === "doing") : 0
        const doing = e.state === "doing"
        const future = e.state !== "done"
        const when = e.state === "done" ? spanLabel(e) : WHEN[e.state]
        const meta = outcome(e)
        const by = e.state === "done" || e.state === "doing" ? entrySessions(e, sessions) : []
        const asked = prompts.filter((p) => p.day === e.entry)
        const lines = e.lines.filter((l) => !l.kind?.startsWith("pr"))
        const fold = doing ? "finished" : e.state === "done" ? "all" : undefined
        const key = `${owner}:${e.entry}`
        const folds = foldableDays(lines, fold)
        const mine = opened[key] ?? []
        const allOpen = folds.length > 0 && folds.every((d) => mine.includes(d))
        const setDays = (days: string[]) => setOpened((o) => ({ ...o, [key]: days }))
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
                  {folds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDays(allOpen ? [] : folds)}
                      aria-label={allOpen ? "Fold every day" : "Open every day"}
                      title={allOpen ? "Fold every day" : "Open every day"}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {allOpen ? <ChevronsDownUpIcon className="size-4" aria-hidden /> : <ChevronsUpDownIcon className="size-4" aria-hidden />}
                    </button>
                  )}
                </h2>
                {e.note && (
                  <div className="text-[14.5px] leading-relaxed text-foreground/85 [&_a]:text-link [&_a]:underline-offset-2 hover:[&_a]:underline [&_p]:my-1">
                    <ReactMarkdown urlTransform={noteLink}>{e.note}</ReactMarkdown>
                  </div>
                )}
                {asked.length > 0 && <Prompts prompts={asked} />}
                <Lines
                  lines={lines}
                  base={base}
                  small={asked.length > 0}
                  marked={doing}
                  folds={folds}
                  opened={mine}
                  onToggle={(d) => setDays(mine.includes(d) ? mine.filter((x) => x !== d) : [...mine, d])}
                />
                {(meta || by.length > 0) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
                    {meta}
                    {by.map((s, j) => (
                      <span key={s.id} className="contents">
                        {(meta || j > 0) && <span aria-hidden>·</span>}
                        <SessionMarker session={s} />
                      </span>
                    ))}
                  </div>
                )}
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
                {by.map((s) => (
                  <SessionMarker key={s.id} session={s} iconOnly />
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The grey outcome line at an entry's end: its commits and PRs, or how many items wait. Each PR links to
 * GitHub, and with one PR the commit count links to its commits.
 */
function outcome(e: TimelineEntry) {
  const commits = e.lines.filter((l) => l.source === "git" && (!l.kind || l.kind === "unpushed")).length
  const prs = e.lines.filter((l) => l.kind?.startsWith("pr"))
  if (e.state === "todo" || e.state === "parked") return e.lines.length ? `${e.lines.length} ${e.lines.length === 1 ? "item" : "items"}` : ""
  if (!commits && !prs.length) return null
  const link = "text-link underline-offset-2 hover:underline"
  const url = (l: TimelineLine) => (l.ref && /^https?:/.test(l.ref) ? l.ref : null)
  const count = commits ? `${commits} ${commits === 1 ? "commit" : "commits"}` : null
  const one = prs.length === 1 ? url(prs[0]!) : null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {count && (one ? <a href={`${one}/commits`} target="_blank" rel="noopener" title="The PR's commits on GitHub" className={link}>{count}</a> : <span>{count}</span>)}
      {prs.map((l, i) => (
        <span key={l.text} className="contents">
          {(count || i > 0) && <span aria-hidden>·</span>}
          {url(l) ? <a href={url(l)!} target="_blank" rel="noopener" title={`${l.text} on GitHub${l.kind === "pr-merged" ? ", merged" : ""}`} className={link}>{l.text}</a> : <span>{l.text}</span>}
        </span>
      ))}
    </span>
  )
}

/** The days of an entry that fold: every day of a done entry, and in the now entry each finished day but the latest. */
export function foldableDays(all: TimelineLine[], fold?: "finished" | "all"): string[] {
  const lines = all.filter((l) => l.kind !== "day")
  const days = [...new Set(lines.map((l) => l.day).filter((d): d is string => !!d))]
  if (!fold || days.length < 2 || all.every((l) => l.kind === "day")) return []
  const finished = (d: string) => lines.every((l) => l.day !== d || (lineState(l) !== "doing" && lineState(l) !== "todo"))
  return fold === "all" ? days : days.filter((d) => d !== days.at(-1) && finished(d))
}

/**
 * An entry's lines, under a day heading when the entry spans more than one day. A `day` line titles its
 * day's heading ("8 Nov: First days in your vault"); an entry with nothing else lists it as a line.
 * Days in `folds` show only their heading until opened. A folded day with no title shows its first line instead.
 */
function Lines({
  lines: all,
  base,
  small,
  marked,
  folds = [],
  opened = [],
  onToggle,
}: {
  lines: TimelineLine[]
  base: string | null
  small?: boolean
  marked?: boolean
  folds?: string[]
  opened?: string[]
  onToggle?: (day: string) => void
}) {
  const onlyDays = all.every((l) => l.kind === "day")
  const titles = new Map(onlyDays ? [] : all.filter((l) => l.kind === "day").map((l) => [l.day, l.text]))
  const lines = onlyDays ? all : all.filter((l) => l.kind !== "day")
  if (!lines.length) return null
  const days = [...new Set(lines.map((l) => l.day).filter((d): d is string => !!d))]
  const split = days.length > 1
  let last: string | null | undefined
  return (
    <ul className={cn("mt-1 flex list-disc flex-col gap-[3px] pl-[18px] leading-normal marker:text-muted-foreground", small ? "text-[13px] text-muted-foreground" : "text-[14.5px]")}>
      {lines.map((l, i) => {
        const first = split && l.day !== last && !!l.day
        last = l.day
        const canFold = !!l.day && folds.includes(l.day)
        const folded = canFold && !opened.includes(l.day!)
        if (folded && !first) return null
        const title = titles.get(l.day) ?? (folded ? l.text.replace(/\*\*|`/g, "") : null)
        const label = first ? `${dayLabel(l.day!)}${title ? `: ${title}` : ""}` : null
        const count = lines.filter((x) => x.day === l.day).length
        const head = !label ? null : canFold ? (
          <button type="button" onClick={() => onToggle?.(l.day!)} aria-expanded={!folded} className="flex max-w-full min-w-0 items-center gap-1 text-left hover:text-foreground">
            <span className="truncate">{label}</span>
            {folded && <span className="shrink-0 text-done">· {count} done</span>}
            <ChevronRightIcon aria-hidden className={cn("size-3 shrink-0 transition-transform", !folded && "rotate-90")} />
          </button>
        ) : (
          label
        )
        const href = l.href ?? (l.source === "doc" && l.ref && /^https?:/.test(l.ref) ? l.ref : null)
        return (
          <Fragment key={i}>
            {head && (
              <li className="-ml-[18px] list-none pt-1 font-mono text-[11.5px] text-muted-foreground" data-day={l.day} data-folded={canFold ? folded : undefined}>
                {head}
              </li>
            )}
            {!folded && (
            <li className={marked ? MARK[lineState(l) ?? "none"] : undefined} data-line-state={marked ? (lineState(l) ?? undefined) : undefined}>
              {l.kind === "waiting" && <b className="font-semibold text-[color-mix(in_oklab,var(--doing)_60%,black)] dark:text-doing">You: </b>}
              {href ? (
                <a href={href} className="text-link underline-offset-2 hover:underline">
                  {l.text}
                </a>
              ) : (
                <RichTitle text={l.text} />
              )}{" "}
              <Source line={l} base={base} />
            </li>
            )}
          </Fragment>
        )
      })}
    </ul>
  )
}

/**
 * In the now entry, where a long list mixes finished and open work, each line's dot takes its state: a pushed
 * commit or a done todo is done, an unpushed commit or a todo in progress is doing, what is next is to do.
 */
export function lineState(l: TimelineLine): "done" | "doing" | "todo" | null {
  if (l.kind === "unpushed" || l.kind === "now" || l.kind === "waiting" || (l.source === "todo" && l.kind === "doing")) return "doing"
  if (l.kind === "next" || l.kind === "parked" || (l.source === "todo" && l.kind === "todo")) return "todo"
  if ((l.source === "git" || l.source === "todo") && !l.kind) return "done"
  if (l.kind === "done") return "done"
  return null
}

// `!` beats the list's own grey marker colour.
const MARK = {
  done: "marker:text-done!",
  doing: "marker:text-doing!",
  todo: "list-[circle] marker:text-muted-foreground!",
  none: "",
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
  // A commit on no remote branch is not on GitHub yet, so it gets no link.
  if (line.kind === "unpushed") return <span className={cn(cls, "text-muted-foreground")}>git {line.ref} · not pushed</span>
  if (line.source === "git" && line.ref && base && !line.ref.startsWith("http"))
    return (
      <a href={`${base}/commit/${line.ref}`} target="_blank" rel="noopener" className={cn(cls, "text-link underline-offset-2 hover:underline")}>
        git {line.ref}
      </a>
    )
  const label =
    line.source === "git" && line.ref && !line.ref.startsWith("http")
      ? `git ${line.ref}`
      : line.kind === "parked"
        ? "run · parked"
        : line.kind === "decision" || line.kind === "defaults"
          ? line.kind
          : line.source === "session" && line.kind
            ? line.kind
            : line.source
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
