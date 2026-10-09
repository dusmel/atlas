import { ArchiveIcon, BoxIcon, FolderIcon, PanelRightOpenIcon, SkipForwardIcon, Undo2Icon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Button } from "@/components/ui/button"
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { useHotkeys, type Hotkeys } from "@/hooks/use-hotkeys"
import { ago, exact } from "@/lib/format"
import { authorOf, PRIORITIES, PRIORITY_NAME, useActions, type Group, type Item, type Priority } from "@/lib/todos"
import { AuthorAvatar } from "./author-avatar"
import { CopyId } from "./copy-id"
import { GroupDot } from "./filters"
import { groupColor } from "./group-color"
import { PriorityIcon } from "./icons"
import { dedent } from "./item-panel"
import { plainTitle, RichTitle } from "./rich-title"

type Props = {
  /** Open Inbox items that pass the filters, oldest first. */
  inbox: Item[]
  all: Item[]
  groups: Group[]
  onOpen: (id: number) => void
  onCurrent: (id: number | null) => void
  keys: Hotkeys
}

type Step = { id: number; did: "priority" | "archive"; label: string }

const chip = "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full border px-2 text-xs text-muted-foreground"

/** The Inbox one item at a time: one key gives it a priority, and the next one shows. */
export function TriageView({ inbox, all, groups, onOpen, onCurrent, keys }: Props) {
  const actions = useActions()
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set())
  const [last, setLast] = useState<Step | null>(null)
  const [picking, setPicking] = useState(false)
  const queue = useMemo(() => inbox.filter((i) => !skipped.has(i.id)), [inbox, skipped])
  const item = queue[0] ?? null

  useEffect(() => onCurrent(item?.id ?? null), [item?.id, onCurrent])

  const prioritise = (p: Priority) => {
    if (!item) return
    actions.update(item, { priority: p })
    setLast({ id: item.id, did: "priority", label: `#${item.id} is now ${p}` })
  }
  const archive = () => {
    if (!item) return
    actions.archive(item)
    setLast({ id: item.id, did: "archive", label: `Archived #${item.id}` })
  }
  const skip = () => item && setSkipped((s) => new Set(s).add(item.id))
  const undo = () => {
    if (!last) return
    // Look the item up again: the change gave it a new updated_at.
    const now = all.find((i) => i.id === last.id)
    if (last.did === "priority" && now) actions.update(now, { priority: null })
    if (last.did === "archive") actions.undoArchive()
    setLast(null)
  }

  useHotkeys({
    ...keys,
    "0": () => prioritise("P0"),
    "1": () => prioritise("P1"),
    "2": () => prioritise("P2"),
    "3": () => prioritise("P3"),
    g: () => item && setPicking(true),
    a: archive,
    s: skip,
    Enter: () => item && onOpen(item.id),
    z: undo,
  })

  const undoLine = last && (
    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      {last.label}
      <Button variant="ghost" size="sm" onClick={undo}>
        <Undo2Icon data-icon="inline-start" />
        Undo <Kbd>Z</Kbd>
      </Button>
    </p>
  )

  if (!item)
    return (
      <div className="flex flex-col gap-4 px-4 py-10 sm:px-6">
        <Empty className="mx-auto w-full max-w-2xl border">
          <EmptyHeader>
            <EmptyTitle>{inbox.length ? `You skipped the other ${skipped.size}` : "The Inbox is clear"}</EmptyTitle>
            <EmptyDescription>{inbox.length ? "Start over to go through them again." : "Every item that passes the filters has a priority."}</EmptyDescription>
          </EmptyHeader>
          {inbox.length > 0 && (
            <EmptyContent>
              <Button onClick={() => setSkipped(new Set())}>Start over</Button>
            </EmptyContent>
          )}
        </Empty>
        {undoLine}
      </div>
    )

  const repoGroups = groups.filter((g) => g.repo_id === item.repo_id)
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4 sm:px-6">
      <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite" data-testid="triage-left">
        {inbox.length} left in Inbox{skipped.size > 0 && `, ${skipped.size} skipped`}. Oldest first.
      </p>

      <article data-triage={item.id} aria-labelledby="triage-title" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <CopyId id={item.id} link className="-ml-1" />
          <span className={chip}>
            <BoxIcon className="size-3" aria-hidden />
            {item.repo_name}
          </span>
          {item.group_name && (
            <span className={chip}>
              <GroupDot color={groupColor(item.group_name)} />
              <span className="truncate">{plainTitle(item.group_name)}</span>
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5" title={exact(item.created_at)}>
            <AuthorAvatar author={authorOf(item)} />
            {authorOf(item)}, {ago(item.created_at)}
          </span>
        </div>
        <h2 id="triage-title" className="text-lg leading-snug font-medium text-balance">
          <RichTitle text={item.title} />
        </h2>
        {item.body.trim() && (
          <div className="markdown max-h-72 overflow-y-auto text-sm leading-relaxed break-words text-muted-foreground">
            <ReactMarkdown>{dedent(item.body)}</ReactMarkdown>
          </div>
        )}
      </article>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRIORITIES.map((p, n) => (
          <Button key={p} variant="outline" className="h-11 justify-start" onClick={() => prioritise(p)}>
            <PriorityIcon row={p} />
            {p} {PRIORITY_NAME[p]}
            <Kbd className="ml-auto max-sm:hidden">{n}</Kbd>
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="ghost" className="h-11 justify-start" onClick={() => setPicking(true)}>
          <FolderIcon />
          Group
          <Kbd className="ml-auto max-sm:hidden">G</Kbd>
        </Button>
        <Button variant="ghost" className="h-11 justify-start" onClick={archive}>
          <ArchiveIcon />
          Archive
          <Kbd className="ml-auto max-sm:hidden">A</Kbd>
        </Button>
        <Button variant="ghost" className="h-11 justify-start" onClick={skip}>
          <SkipForwardIcon />
          Skip
          <Kbd className="ml-auto max-sm:hidden">S</Kbd>
        </Button>
        <Button variant="ghost" className="h-11 justify-start" onClick={() => onOpen(item.id)}>
          <PanelRightOpenIcon />
          Open
          <Kbd className="ml-auto max-sm:hidden">↵</Kbd>
        </Button>
      </div>
      {undoLine}

      <CommandDialog open={picking} onOpenChange={setPicking} title="Pick a group" description={`Groups in ${item.repo_name}`}>
        <Command loop>
          <CommandInput autoFocus placeholder={`Groups in ${item.repo_name}…`} />
          <CommandList>
            <CommandEmpty>No group by that name.</CommandEmpty>
            {repoGroups.map((g) => (
              <CommandItem
                key={g.id}
                value={`${g.id} ${plainTitle(g.name)}`}
                onSelect={() => {
                  setPicking(false)
                  actions.update(item, { group: g.id })
                }}
              >
                <GroupDot color={groupColor(g.name)} />
                {plainTitle(g.name)}
              </CommandItem>
            ))}
            <CommandItem
              value="none No group"
              onSelect={() => {
                setPicking(false)
                actions.update(item, { group: null })
              }}
            >
              <GroupDot />
              No group
            </CommandItem>
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  )
}
