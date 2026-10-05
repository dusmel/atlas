import { Fragment, useState } from "react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { laneOf, PRIORITY_NAME, ROWS, rowKey, rowLabel, STATUS_LABEL, STATUSES, useActions, type Group, type Item, type Repo, type Row, type Status } from "@/lib/todos"
import { PriorityIcon, StatusIcon } from "./icons"
import { plainTitle } from "./rich-title"

const LAST_REPO = "atlas.last-repo"
const readRepo = () => {
  try {
    return localStorage.getItem(LAST_REPO)
  } catch {
    return null
  }
}

// The outline toggle's own "on" state is a faint grey. A filled segment reads at a glance.
const ON = "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground"

// Inbox means "not prioritised yet", so it sits apart from P0 to P3.
export function PriorityToggle({ value, onChange }: { value: Row; onChange: (r: Row) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" value={rowKey(value)} onValueChange={(v) => v && onChange(v === "inbox" ? null : (v as Row))} className="w-full">
      {ROWS.map((r) => (
        <Fragment key={rowKey(r)}>
          <ToggleGroupItem value={rowKey(r)} title={r ? `${r} ${PRIORITY_NAME[r]}` : "Inbox: not prioritised yet"} className={cn("min-h-9 flex-auto gap-1.5 px-2", ON)}>
            <PriorityIcon row={rowKey(r)} />
            {rowLabel(r)}
          </ToggleGroupItem>
          {r === null && <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />}
        </Fragment>
      ))}
    </ToggleGroup>
  )
}

export function StatusToggle({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" value={value} onValueChange={(v) => v && onChange(v as Status)} className="w-full">
      {STATUSES.map((s) => (
        <ToggleGroupItem key={s} value={s} className={cn("min-h-9 flex-1 gap-1.5", ON)}>
          <StatusIcon status={s} />
          {STATUS_LABEL[s]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

type NewProps = { open: boolean; priority: Row; repos: Repo[]; groups: Group[]; repoHint?: string; onClose: () => void; onCreated: (item: Item) => void }

/** New item. The repo defaults to the one filtered on, then the last one used. */
export function NewItemDialog(props: NewProps) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-lg">{props.open && <NewItemForm {...props} />}</DialogContent>
    </Dialog>
  )
}

function NewItemForm({ priority: startPriority, repos, groups, repoHint, onClose, onCreated }: NewProps) {
  const actions = useActions()
  const fallback = repos.find((r) => r.name === repoHint) ?? repos.find((r) => r.id === readRepo()) ?? repos.find((r) => r.name === "personal") ?? repos[0]
  const [title, setTitle] = useState("")
  const [repo, setRepo] = useState(fallback?.id ?? "")
  const [priority, setPriority] = useState<Row>(startPriority)
  const [group, setGroup] = useState("none")
  const repoGroups = groups.filter((g) => g.repo_id === repo)

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim() || !repo) return
    try {
      localStorage.setItem(LAST_REPO, repo)
    } catch {}
    actions.create({ repo, title: title.trim(), priority, group: group === "none" ? null : Number(group) }, onCreated)
    onClose()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>New item</DialogTitle>
        <DialogDescription>Press Enter to add it.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="new-title">Title</FieldLabel>
          <Textarea
            id="new-title"
            name="title"
            autoFocus
            autoComplete="off"
            rows={2}
            value={title}
            placeholder="What needs doing…"
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => e.key === "Enter" && submit(e)}
            className="field-sizing-content min-h-16 resize-none"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="new-repo">Repo</FieldLabel>
            <Select value={repo} onValueChange={(v) => (setRepo(v), setGroup("none"))}>
              <SelectTrigger id="new-repo" className="w-full">
                <SelectValue placeholder="Pick a repo" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {repos.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-group">Group</FieldLabel>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger id="new-group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">No group</SelectItem>
                  {repoGroups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {plainTitle(g.name)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel>Priority</FieldLabel>
          <PriorityToggle value={priority} onChange={setPriority} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim() || !repo}>
          Add item
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Move without dragging: pick the row, the lane and the end of the lane. */
export function MoveDialog({ item, items, onClose }: { item: Item | null; items: Item[]; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">{item && <MoveForm key={item.id} item={item} items={items} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function MoveForm({ item, items, onClose }: { item: Item; items: Item[]; onClose: () => void }) {
  const actions = useActions()
  const [priority, setPriority] = useState<Row>(item.priority)
  const [status, setStatus] = useState<Status>(item.status)
  const [end, setEnd] = useState<"top" | "bottom">("top")
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const first = laneOf(items, priority, status, item.id)[0]
    actions.move(item, { priority, status, ...(end === "top" && first ? { before: first.id } : {}) })
    onClose()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Move #{item.id}</DialogTitle>
        <DialogDescription className="line-clamp-2">{plainTitle(item.title)}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel>Priority</FieldLabel>
          <PriorityToggle value={priority} onChange={setPriority} />
        </Field>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <StatusToggle value={status} onChange={setStatus} />
        </Field>
        <Field>
          <FieldLabel>Position</FieldLabel>
          <ToggleGroup type="single" variant="outline" value={end} onValueChange={(v) => v && setEnd(v as "top" | "bottom")} className="w-full">
            <ToggleGroupItem value="top" className={cn("min-h-9 flex-1", ON)}>
              Top of the lane
            </ToggleGroupItem>
            <ToggleGroupItem value="bottom" className={cn("min-h-9 flex-1", ON)}>
              Bottom
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Move</Button>
      </DialogFooter>
    </form>
  )
}

export const SHORTCUTS: { keys: string[]; label: string; section: string }[] = [
  { keys: ["⌘", "K"], label: "Command palette", section: "Anywhere" },
  { keys: ["/"], label: "Search", section: "Anywhere" },
  { keys: ["F"], label: "Filter by repo, group, priority, status or author", section: "Anywhere" },
  { keys: ["N"], label: "New item in Inbox", section: "Anywhere" },
  { keys: ["?"], label: "This list", section: "Anywhere" },
  { keys: ["V", "then", "1"], label: "Board", section: "Views" },
  { keys: ["V", "then", "2"], label: "List", section: "Views" },
  { keys: ["V", "then", "3"], label: "Triage", section: "Views" },
  { keys: ["V", "then", "4"], label: "Overview", section: "Views" },
  { keys: ["V", "then", "5"], label: "Activity", section: "Views" },
  { keys: ["J"], label: "Next card down the lane", section: "Board" },
  { keys: ["K"], label: "Previous card", section: "Board" },
  { keys: ["H"], label: "Lane to the left", section: "Board" },
  { keys: ["L"], label: "Lane to the right", section: "Board" },
  { keys: ["Enter"], label: "Open the card", section: "Board" },
  { keys: ["Space"], label: "Pick up, move with arrows, Space to drop", section: "Board" },
  { keys: ["J"], label: "Next row", section: "List" },
  { keys: ["K"], label: "Previous row", section: "List" },
  { keys: ["X"], label: "Tick the row, to change several at once", section: "List" },
  { keys: ["Shift", "click"], label: "Tick every row in between", section: "List" },
  { keys: ["Esc"], label: "Untick all", section: "List" },
  { keys: ["0", "–", "3"], label: "Set priority P0 to P3", section: "Selected card, or ticked rows" },
  { keys: ["I"], label: "Send to Inbox", section: "Selected card, or ticked rows" },
  { keys: ["S"], label: "Next status: todo, doing, done", section: "Selected card, or ticked rows" },
  { keys: ["M"], label: "Move to another row or lane", section: "Selected card, or ticked rows" },
  { keys: ["A"], label: "Archive", section: "Selected card, or ticked rows" },
  { keys: ["Z"], label: "Undo the last archive", section: "Selected card, or ticked rows" },
  { keys: ["Esc"], label: "Close the panel or dialog", section: "Selected card, or ticked rows" },
  { keys: ["0", "–", "3"], label: "Set the priority, then show the next item", section: "Triage" },
  { keys: ["G"], label: "Pick a group", section: "Triage" },
  { keys: ["A"], label: "Archive", section: "Triage" },
  { keys: ["S"], label: "Skip for now", section: "Triage" },
  { keys: ["Enter"], label: "Open the item", section: "Triage" },
  { keys: ["Z"], label: "Undo the last step", section: "Triage" },
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sections = [...new Set(SHORTCUTS.map((s) => s.section))]
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys work when you're not typing in a field.</DialogDescription>
        </DialogHeader>
        {sections.map((section) => (
          <section key={section} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{section}</h3>
            <dl className="flex flex-col">
              {SHORTCUTS.filter((s) => s.section === section).map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                  <dt>{s.label}</dt>
                  <dd>
                    <KbdGroup>
                      {s.keys.map((k) => (k === "–" || k === "then" || k === "click" ? <span key={k} className="text-xs text-muted-foreground">{k}</span> : <Kbd key={k}>{k}</Kbd>))}
                    </KbdGroup>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
