import { Link } from "@tanstack/react-router"
import { CopyIcon } from "lucide-react"
import { cn } from "cn"
import { copy } from "@/components/todos/copy-id"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { resumeCommand, sessionSpan, sessionTitle, type SessionSummary } from "@/lib/timeline"

// Design: atlas/timeline/design.html#look-rail (the session on an entry) and #look-sidebar (the agent icon).

/** Claude Code's icon, from herdr's icon set (~/.config/herdr-app/icons/claude.svg). The sync reads only Claude Code. */
export function AgentIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn("block shrink-0", className)} aria-label="Claude Code" role="img">
      <path
        fill="#D97757"
        fillRule="evenodd"
        d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
      />
    </svg>
  )
}

/** The resume command with a Copy button. */
export function ResumeCommand({ session }: { session: SessionSummary }) {
  const cmd = resumeCommand(session)
  return (
    <div className="flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5">
      <code className="min-w-0 grow font-mono text-[11.5px] break-all">{cmd}</code>
      <button
        type="button"
        onClick={() => copy(cmd, "Copied the resume command")}
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <CopyIcon className="size-3" aria-hidden />
        Copy
      </button>
    </div>
  )
}

/** A session on an entry's outcome line: its icon and title, or the icon alone. A click opens how to resume it. */
export function SessionMarker({ session, iconOnly }: { session: SessionSummary; iconOnly?: boolean }) {
  const title = sessionTitle(session)
  return (
    <Popover>
      <PopoverTrigger
        title={`${title} · ${sessionSpan(session)}`}
        className="inline-flex max-w-[260px] cursor-pointer items-center gap-1 rounded px-0.5 align-middle hover:bg-muted hover:text-foreground"
        data-session={session.id}
      >
        <AgentIcon size={12} />
        {!iconOnly && <span className="truncate">{title}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] gap-2">
        <div className="flex items-baseline gap-2">
          <AgentIcon size={13} className="self-center" />
          <span className="font-medium">{title}</span>
          <span className="grow" />
          <span className="text-xs whitespace-nowrap text-muted-foreground">{sessionSpan(session)}</span>
        </div>
        <ResumeCommand session={session} />
        <Link to="/timeline" search={{ session: session.id }} className="text-[13px] text-link underline-offset-2 hover:underline">
          Open the session
        </Link>
      </PopoverContent>
    </Popover>
  )
}
