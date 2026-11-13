import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CopyIcon } from "lucide-react"
import { useState } from "react"
import { copy } from "@/components/todos/copy-id"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, send } from "@/lib/api"
import { adoptPrompt, sessionTitle, type SessionSummary } from "@/lib/timeline"
import { useRepos } from "@/lib/todos"

// Design: atlas/timeline/design.html#look-sidebar. Make it an effort asks for a name, creates the todo group,
// links the session and copies the prompt; Copy prompt leaves the naming to `/mel adopt`.

/** The two ways to turn a session with no effort into one. */
export function AdoptSession({ session }: { session: SessionSummary }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(sessionTitle(session))
  const [repo, setRepo] = useState(session.repo_id ?? "")
  const repos = useRepos()
  const make = useMutation({
    mutationFn: async () => {
      const group = await api<{ id: number; name: string }>("/groups", send("POST", { repo, name: name.trim() }))
      await api("/timeline/adopt", send("POST", { session: session.id, group_id: group.id }))
      return group
    },
    onSuccess: (group) => {
      setOpen(false)
      copy(adoptPrompt(session, group.name), "Made the effort. Copied the prompt that writes its docs")
      qc.invalidateQueries({ queryKey: ["timeline"] })
    },
  })

  if (!open)
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setOpen(true)}>
          Make it an effort
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy(adoptPrompt(session), "Copied the prompt")} title={`Copies ${adoptPrompt(session)}: Claude Code names the effort and writes its docs`}>
          <CopyIcon aria-hidden />
          Copy prompt
        </Button>
      </div>
    )

  return (
    <form
      aria-label="Make it an effort"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        make.mutate()
      }}
    >
      <label className="flex min-w-[200px] grow flex-col gap-1 text-[13px] text-muted-foreground">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required className="h-8 text-sm text-foreground" />
      </label>
      <label className="flex min-w-[160px] flex-col gap-1 text-[13px] text-muted-foreground">
        Repo
        <Select value={repo} onValueChange={setRepo}>
          <SelectTrigger className="h-8 w-full text-foreground" aria-label="Repo">
            <SelectValue placeholder="Pick a repo" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(repos.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </label>
      <Button size="sm" type="submit" disabled={!name.trim() || !repo || make.isPending}>
        Create and copy the prompt
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {make.error && (
        <p role="alert" className="w-full text-[13px] text-destructive">
          {make.error.message}
        </p>
      )}
    </form>
  )
}

/** After Make it an effort: the prompt that writes the effort's docs, until they exist. */
export function AdoptPrompt({ session, group }: { session: SessionSummary; group: string }) {
  const prompt = adoptPrompt(session, group)
  return (
    <div className="flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5">
      <code className="min-w-0 grow font-mono text-[11.5px] break-all">{prompt}</code>
      <button
        type="button"
        onClick={() => copy(prompt, "Copied the prompt")}
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <CopyIcon className="size-3" aria-hidden />
        Copy
      </button>
    </div>
  )
}
