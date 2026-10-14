import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, send } from "@/lib/api"
import type { DocsStatus, MegaPair } from "@/lib/docs"
import { ago, exact } from "@/lib/format"

export const useDocsStatus = () => useQuery({ queryKey: ["docs-status"], queryFn: () => api<DocsStatus>("/docs/status"), refetchInterval: 30_000 })

type Tone = "ok" | "busy" | "manual" | "failed" | "idle"
const DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  busy: "bg-sky-500 motion-safe:animate-pulse",
  manual: "bg-violet-500",
  failed: "bg-amber-500",
  idle: "bg-muted-foreground/40",
}

/** The pill's words, from spec section 12. */
export function describeStatus(s: DocsStatus): { label: string; tone: Tone } {
  if (s.source === "manual") return { label: `Docs: manual push${s.since ? ` · ${ago(s.since)}` : ""} (MEGA paused)`, tone: "manual" }
  if (s.mega.state === "failed") return { label: "Docs: pull failed", tone: "failed" }
  const pulled = s.mega.last_pull ? ` · pulled ${ago(s.mega.last_pull)}` : ""
  return { label: `Docs: MEGA${pulled}`, tone: s.mega.state === "ok" ? "ok" : s.mega.state === "syncing" ? "busy" : "idle" }
}

export function DocsSourcePill() {
  const status = useDocsStatus()
  if (!status.data) return null
  const { label, tone } = describeStatus(status.data)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          data-testid="docs-pill"
          data-tone={tone}
          aria-label={label}
          className={cn("h-9 min-w-9 gap-2 rounded-full px-2.5 text-xs font-normal text-muted-foreground", tone === "failed" && "text-amber-700 hover:text-amber-800 dark:text-amber-400")}
        >
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
          <span className="hidden lg:inline">{label}</span>
          <span className="hidden sm:inline lg:hidden">Docs</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <DocsSourceDetails status={status.data} />
      </PopoverContent>
    </Popover>
  )
}

const pairFailed = (p: MegaPair) => p.error !== "NO" || p.run === "Suspended" || p.run === "Disabled"
const pairName = (path: string) => path.split("/").filter(Boolean).pop() ?? path

/** What the server serves and how MEGA is doing. In the pill's popover and on Settings. */
export function DocsSourceDetails({ status: s }: { status: DocsStatus }) {
  const qc = useQueryClient()
  const pull = useMutation({
    mutationFn: () => api<{ requested: string }>("/docs/pull", send("POST")),
    onSuccess: () => {
      toast.success("Asked MEGA to pull", { description: "New docs show up within a minute or so." })
      void qc.invalidateQueries({ queryKey: ["docs-status"] })
    },
    onError: (e) => toast.error("Could not ask MEGA to pull", { description: (e as Error).message }),
  })
  const { label, tone } = describeStatus(s)
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="docs-source">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
        <p className="font-medium">{label}</p>
      </div>
      {s.source === "manual" ? (
        <p className="text-muted-foreground">
          The server shows the copy sent by <code className="font-mono text-xs">atlas push</code>
          {s.since && <> <time dateTime={s.since} title={exact(s.since)}>{ago(s.since)}</time></>}. MEGA keeps syncing in the background but is not shown. To switch back, run{" "}
          <code className="font-mono text-xs">atlas push --resume-mega</code>.
        </p>
      ) : s.mega.state === "unknown" ? (
        <p className="text-muted-foreground">MEGAcmd has not reported yet.</p>
      ) : (
        <>
          {s.mega.detail && !s.mega.pairs.some(pairFailed) && <p className="text-amber-700 dark:text-amber-400">{s.mega.detail}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {s.mega.pairs.map((p) => (
              <div key={p.path} className="contents">
                <dt className="font-mono text-xs leading-5 text-muted-foreground" translate="no">
                  {pairName(p.path)}
                </dt>
                <dd className={cn("text-xs leading-5", pairFailed(p) && "text-amber-700 dark:text-amber-400")}>
                  {p.run === "Running" ? p.status : p.run}
                  {p.error !== "NO" && ` · ${p.error}`}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        {s.count} docs indexed
        {s.mega.checked && s.source === "mega" && (
          <>
            {" · checked "}
            <time dateTime={s.mega.checked} title={exact(s.mega.checked)}>
              {ago(s.mega.checked)}
            </time>
          </>
        )}
      </p>
      {s.source === "mega" && s.mega.state !== "unknown" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="outline" size="sm" disabled={pull.isPending || !!s.mega.pull_requested} onClick={() => pull.mutate()}>
            <RefreshCwIcon data-icon="inline-start" className={cn((pull.isPending || s.mega.pull_requested) && "motion-safe:animate-spin")} />
            Pull now
          </Button>
          {s.mega.pull_requested && <span className="text-xs text-muted-foreground">Waiting for MEGAcmd…</span>}
        </div>
      )}
    </div>
  )
}
