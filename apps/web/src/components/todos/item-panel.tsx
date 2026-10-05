import { ArchiveIcon, ChevronsUpDownIcon, FileTextIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ago, describe, exact } from "@/lib/format"
import { authorOf, isAgent, STATUS_LABEL, useActions, useGroups, useItemDetail, type Item } from "@/lib/todos"
import { PriorityToggle, StatusToggle } from "./dialogs"
import { plainTitle, RichTitle } from "./rich-title"

type PanelProps = { item: Item | null; items: Item[]; desktop: boolean; onClose: () => void; onOpen: (id: number) => void }

/** The item's details: a side sheet on desktop, a bottom drawer on a phone. Closing saves unsaved text. */
export function ItemPanel({ item, desktop, onClose, ...rest }: PanelProps) {
  const flush = useRef<() => void>(() => {})
  const close = (open: boolean) => {
    if (open) return
    flush.current()
    onClose()
  }
  const body = item ? <Details key={item.id} item={item} flush={flush} {...rest} /> : null
  const title = item ? plainTitle(item.title) : "Item"
  if (desktop)
    return (
      <Sheet open={!!item} onOpenChange={close}>
        <SheetContent className="w-full gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-xl" onOpenAutoFocus={focusPanel} onEscapeKeyDown={keepOpen}>
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">Edit the item, or press Escape to close.</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    )
  return (
    <Drawer open={!!item} onOpenChange={close} repositionInputs={false}>
      <DrawerContent className="max-h-[92dvh]" onOpenAutoFocus={focusPanel} onEscapeKeyDown={keepOpen}>
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <DrawerDescription className="sr-only">Edit the item, or swipe down to close.</DrawerDescription>
        <div className="overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{body}</div>
      </DrawerContent>
    </Drawer>
  )
}

// Focus the panel itself, not its first field, so opening it doesn't start an edit.
const focusPanel = (e: Event) => {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).focus()
}

// Escape in the title field cancels the edit. Radix sees the key first, so stop it closing the panel here.
const keepOpen = (e: KeyboardEvent) => {
  if ((e.target as HTMLElement).closest("[data-escape-cancels]")) e.preventDefault()
}

// Bodies imported from TODO.md keep their list indent, which Markdown would read as a code block.
const dedent = (text: string) => {
  const lines = text.split("\n")
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].length))
  return Number.isFinite(indent) && indent > 0 ? lines.map((l) => l.slice(indent)).join("\n") : text
}

function Details({ item, items, flush, onOpen }: Omit<PanelProps, "desktop" | "onClose" | "item"> & { item: Item; flush: React.RefObject<() => void> }) {
  const actions = useActions()
  const detail = useItemDetail(item.id)
  const groups = useGroups().data ?? []
  const repoGroups = groups.filter((g) => g.repo_id === item.repo_id)

  // Text edits remember the version they started from, so a change made elsewhere meanwhile gives a 409.
  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body)
  const [base, setBase] = useState(item.updated_at)
  const [editingTitle, setEditingTitle] = useState(false)
  const cancelTitle = useRef(false)
  const dirtyTitle = title.trim() !== item.title && title.trim() !== ""
  const dirtyBody = body !== item.body

  useEffect(() => {
    if (!dirtyTitle) setTitle(item.title)
    if (!dirtyBody) setBody(item.body)
    if (!dirtyTitle && !dirtyBody) setBase(item.updated_at)
    // Only an outside change to the item resets the drafts.
  }, [item.updated_at])

  const save = () => {
    if (!dirtyTitle && !dirtyBody) return
    actions.update(item, { ...(dirtyTitle ? { title: title.trim() } : {}), ...(dirtyBody ? { body } : {}) }, {
      base,
      done: (saved) => setBase(saved.updated_at),
      failed: (latest) => latest && setBase(latest.updated_at),
    })
  }
  flush.current = save

  const set = (fields: Parameters<typeof actions.update>[1]) => actions.update(item, fields)
  const parent = item.parent_id ? items.find((i) => i.id === item.parent_id) : null
  const children = detail.data?.children ?? []
  const author = authorOf(item)

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-2 pr-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums" translate="no">
            #{item.id}
          </span>
          <Badge variant="outline" className="font-normal" translate="no">
            {item.repo_name}
          </Badge>
          {item.section && <span className="italic">{item.section}</span>}
        </div>
        {editingTitle ? (
          <Textarea
            aria-label="Title"
            name="title"
            data-escape-cancels
            autoFocus
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onFocus={(e) => e.currentTarget.setSelectionRange(title.length, title.length)}
            onBlur={() => {
              if (!cancelTitle.current) save()
              cancelTitle.current = false
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                e.currentTarget.blur()
              }
              if (e.key === "Escape") {
                cancelTitle.current = true
                setTitle(item.title)
                e.currentTarget.blur()
              }
            }}
            className="field-sizing-content min-h-0 resize-none px-2 py-1 font-mono text-base leading-snug md:text-base"
          />
        ) : (
          <div data-title>
            <button
              type="button"
              title="Click to edit"
              onClick={() => setEditingTitle(true)}
              className="-mx-2 w-[calc(100%+1rem)] cursor-text rounded-md px-2 py-1 text-left text-lg leading-snug font-semibold text-balance hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <RichTitle text={title} />
            </button>
          </div>
        )}
      </div>

      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel>Priority</FieldLabel>
          <PriorityToggle value={item.priority} onChange={(priority) => set({ priority })} />
        </Field>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <StatusToggle value={item.status} onChange={(status) => set({ status })} />
        </Field>
        <Field>
            <FieldLabel htmlFor="item-group">Group</FieldLabel>
            <Select value={String(item.group_id ?? "none")} onValueChange={(v) => set({ group: v === "none" ? null : Number(v) })}>
              <SelectTrigger id="item-group" className="w-full min-w-0">
                <SelectValue className="truncate" />
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
          <Field>
            <FieldLabel>Parent</FieldLabel>
            <ParentPicker item={item} items={items} hasChildren={children.length > 0} onPick={(parent) => set({ parent })} label={parent ? `#${parent.id} ${plainTitle(parent.title)}` : "None"} />
          </Field>
        {item.group_doc && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileTextIcon aria-hidden className="size-4 shrink-0" />
            <span className="truncate font-mono text-xs" translate="no" title="Opens here once docs are on the server (Phase 5)">
              {item.group_doc}
            </span>
          </p>
        )}
      </FieldGroup>

      <Tabs defaultValue={item.body ? "preview" : "write"} className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          {dirtyBody && (
            <Button size="sm" onClick={save}>
              Save
              <Kbd className="ml-1 hidden sm:inline-flex">⌘↵</Kbd>
            </Button>
          )}
        </div>
        <TabsContent value="write">
          <Textarea
            aria-label="Body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                save()
              }
            }}
            placeholder="Notes, links, a checklist… Markdown works."
            className="min-h-48 font-mono text-sm"
          />
        </TabsContent>
        <TabsContent value="preview">
          {body ? (
            <div className="markdown rounded-md border px-4 py-3 text-sm leading-relaxed break-words">
              <ReactMarkdown>{dedent(body)}</ReactMarkdown>
            </div>
          ) : (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No notes yet. Switch to Write to add some.</p>
          )}
        </TabsContent>
      </Tabs>

      {children.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">Children</h3>
          {children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c.id)}
              className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="font-mono text-xs text-muted-foreground tabular-nums">#{c.id}</span>
              <span className={cn("min-w-0 flex-1 truncate", c.status === "done" && "text-muted-foreground line-through")}>
                <RichTitle text={c.title} />
              </span>
              <span className="text-xs text-muted-foreground">{STATUS_LABEL[c.status]}</span>
            </button>
          ))}
        </section>
      )}

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Made by <span className={cn("font-medium", isAgent(author) ? "text-p2" : "text-foreground")}>{author}</span>
            <span title={exact(item.created_at)}> {ago(item.created_at)}</span>
          </p>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => actions.archive(item)}>
            <ArchiveIcon data-icon="inline-start" />
            Archive
            <Kbd className="ml-1 hidden sm:inline-flex">A</Kbd>
          </Button>
        </div>
        <h3 className="text-sm font-medium">History</h3>
        {detail.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <ol className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            {(detail.data?.events ?? []).map((e) => (
              <li key={e.id} className="col-span-2 grid grid-cols-subgrid">
                <span className="text-muted-foreground tabular-nums whitespace-nowrap" title={exact(e.at)}>
                  {ago(e.at)}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{e.author ?? e.actor}</span> {describe(e)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/** Items in the same repo that can be a parent: one level only, so not items that already have one. */
function ParentPicker({ item, items, hasChildren, onPick, label }: { item: Item; items: Item[]; hasChildren: boolean; onPick: (id: number | null) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const candidates = items.filter((i) => i.repo_id === item.repo_id && i.id !== item.id && i.parent_id === null && i.status !== "done")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} disabled={hasChildren} className="w-full justify-between font-normal" title={hasChildren ? "An item with children can't have a parent" : undefined}>
          <span className="truncate">{label}</span>
          <ChevronsUpDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find a parent by title or #id…" />
          <CommandList>
            <CommandEmpty>No item matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="none no parent" data-checked={item.parent_id === null} onSelect={() => (onPick(null), setOpen(false))}>
                No parent
              </CommandItem>
              {candidates.map((c) => (
                <CommandItem key={c.id} value={`${c.id} ${plainTitle(c.title)}`} data-checked={item.parent_id === c.id} onSelect={() => (onPick(c.id), setOpen(false))}>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">#{c.id}</span>
                  <span className="min-w-0 flex-1 truncate">{plainTitle(c.title)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
