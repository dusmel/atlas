import {
  ArchiveIcon,
  ArrowRightLeftIcon,
  ClockIcon,
  KeyboardIcon,
  ListFilterIcon,
  MonitorIcon,
  MoonIcon,
  PanelRightOpenIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  XIcon,
} from "lucide-react"
import { useState } from "react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { activeCount, FACETS, ROWS, rowKey, rowLabel, STATUS_LABEL, STATUSES, type Facet, type Filters, type Item, type Row, type Status } from "@/lib/todos"
import { PriorityIcon, StatusIcon } from "./icons"
import { FacetCommand, type Option } from "./filters"
import { plainTitle } from "./rich-title"
import { VIEWS, type View } from "./view-tabs"

export type PaletteActions = {
  openItem: (id: number) => void
  newItem: () => void
  move: () => void
  archive: () => void
  setPriority: (r: Row) => void
  setStatus: (s: Status) => void
  toggleDone: () => void
  view: (v: View) => void
  shortcuts: () => void
  settings: () => void
  theme: (t: "light" | "dark" | "system") => void
}

type Props = {
  open: boolean
  page: "root" | "filter" | "views"
  view: View
  onOpenChange: (open: boolean) => void
  items: Item[]
  selected: Item | null
  filters: Filters
  doneAll: boolean
  options: Record<Facet, Option[]>
  onFilters: (f: Filters) => void
  run: PaletteActions
}

/** ⌘K: jump to any item by number or title, filter, and act on the selected card. */
export function CommandPalette(props: Props) {
  return (
    <CommandDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.page === "views" ? "Switch view" : "Command palette"}
      description={props.page === "views" ? "Press a view's number, or pick it from the list." : "Jump to an item, filter the board, or run an action."}
      className={props.page === "views" ? "sm:max-w-sm" : "sm:max-w-xl"}
    >
      {props.open && <Palette key={props.page} {...props} />}
    </CommandDialog>
  )
}

function Palette({ page: startPage, view, items, selected, filters, doneAll, options, onFilters, onOpenChange, run }: Props) {
  const [page, setPage] = useState(startPage)
  const [search, setSearch] = useState("")
  const close = (then: () => void) => () => {
    onOpenChange(false)
    then()
  }

  // V opens this page. View names hold no digits, so a number picks a view instead of searching.
  if (page === "views")
    return (
      <Command
        loop
        onKeyDown={(e) => {
          const v = VIEWS[Number(e.key) - 1]
          if (!v || e.metaKey || e.ctrlKey) return
          e.preventDefault()
          onOpenChange(false)
          run.view(v.id)
        }}
      >
        <CommandInput autoFocus placeholder="Switch to a view…" />
        <CommandList>
          <CommandEmpty>No view by that name.</CommandEmpty>
          <CommandGroup>
            {VIEWS.map((v, n) => (
              <CommandItem key={v.id} value={v.label} onSelect={close(() => run.view(v.id))}>
                <v.icon />
                {v.label}
                {v.id === view && <span className="text-xs text-muted-foreground">Current</span>}
                <CommandShortcut>{n + 1}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    )

  if (page === "filter")
    return (
      <div onKeyDown={(e) => e.key === "Backspace" && !(e.target as HTMLInputElement).value && startPage === "root" && setPage("root")}>
        <FacetCommand facets={FACETS} options={options} filters={filters} onChange={onFilters} autoFocus />
      </div>
    )

  const q = search.trim().replace(/^#/, "")
  const found = q ? items.filter((i) => String(i.id).startsWith(q) || i.title.toLowerCase().includes(q.toLowerCase())).slice(0, 30) : []

  return (
    <Command loop>
      <CommandInput autoFocus value={search} onValueChange={setSearch} placeholder="Type a number or words to find an item, or a command…" />
      <CommandList className="max-h-[min(65vh,28rem)]">
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {found.length > 0 && (
          <CommandGroup heading="Items">
            {found.map((i) => (
              <CommandItem key={i.id} value={`#${i.id} ${plainTitle(i.title)}`} onSelect={close(() => run.openItem(i.id))}>
                <PriorityIcon row={rowKey(i.priority)} />
                <span className="font-mono text-xs text-muted-foreground tabular-nums">#{i.id}</span>
                <span className="min-w-0 flex-1 truncate">{plainTitle(i.title)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{i.repo_name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {selected && (
          <CommandGroup heading={`#${selected.id} ${plainTitle(selected.title).slice(0, 60)}`}>
            <CommandItem onSelect={close(() => run.openItem(selected.id))}>
              <PanelRightOpenIcon />
              Open
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
            {ROWS.filter((r) => r !== selected.priority).map((r) => (
              <CommandItem key={rowKey(r)} value={`priority ${rowLabel(r)}`} onSelect={close(() => run.setPriority(r))}>
                <PriorityIcon row={rowKey(r)} />
                Set priority {rowLabel(r)}
                <CommandShortcut>{r === null ? "I" : r.slice(1)}</CommandShortcut>
              </CommandItem>
            ))}
            {STATUSES.filter((s) => s !== selected.status).map((s) => (
              <CommandItem key={s} value={`status ${s}`} onSelect={close(() => run.setStatus(s))}>
                <StatusIcon status={s} className="size-4" />
                Mark as {STATUS_LABEL[s].toLowerCase()}
              </CommandItem>
            ))}
            <CommandItem onSelect={close(run.move)}>
              <ArrowRightLeftIcon />
              Move to…
              <CommandShortcut>M</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={close(run.archive)}>
              <ArchiveIcon />
              Archive
              <CommandShortcut>A</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Views">
          {VIEWS.map((v, n) => (
            <CommandItem key={v.id} value={`view ${v.label}`} onSelect={close(() => run.view(v.id))}>
              <v.icon />
              {v.label}
              <CommandShortcut>V {n + 1}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Board">
          <CommandItem onSelect={close(run.newItem)}>
            <PlusIcon />
            New item
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => (setPage("filter"), setSearch(""))}>
            <ListFilterIcon />
            Filter…
            <CommandShortcut>F</CommandShortcut>
          </CommandItem>
          {activeCount(filters) > 0 && (
            <CommandItem onSelect={close(() => onFilters({ done: filters.done }))}>
              <XIcon />
              Clear filters
            </CommandItem>
          )}
          <CommandItem onSelect={close(run.toggleDone)}>
            <ClockIcon />
            {doneAll ? "Done lane: last 14 days only" : "Done lane: show all time"}
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="General">
          <CommandItem value="theme light" onSelect={close(() => run.theme("light"))}>
            <SunIcon />
            Light theme
          </CommandItem>
          <CommandItem value="theme dark" onSelect={close(() => run.theme("dark"))}>
            <MoonIcon />
            Dark theme
          </CommandItem>
          <CommandItem value="theme system" onSelect={close(() => run.theme("system"))}>
            <MonitorIcon />
            Theme follows the system
          </CommandItem>
          <CommandItem onSelect={close(run.shortcuts)}>
            <KeyboardIcon />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={close(run.settings)}>
            <SettingsIcon />
            Settings and API tokens
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
