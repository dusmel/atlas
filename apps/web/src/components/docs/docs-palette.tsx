import { CopyIcon, FileTextIcon, GlobeIcon, ListTodoIcon, SettingsIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { DOC_VIEWS, docPath, type DocView, type Hit } from "@/lib/docs"
import { DocCommandGroup } from "./doc-command-group"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: DocView
  selected?: Hit
  filtered: boolean
  run: { pick: (hit: Hit) => void; view: (v: DocView) => void; copy: () => void; open: () => void; clear: () => void; go: (to: "/todos" | "/shared" | "/settings") => void }
}

/** ⌘K on the Docs page: find a doc by its words, switch view, or act on the selected doc. */
export function DocsPalette(props: Props) {
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange} title="Command palette" description="Find a doc, switch view, or run an action." className="sm:max-w-xl">
      {props.open && <Palette {...props} />}
    </CommandDialog>
  )
}

function Palette({ view, selected, filtered, onOpenChange, run }: Props) {
  const [search, setSearch] = useState("")
  const close = (then: () => void) => () => {
    onOpenChange(false)
    then()
  }
  return (
    <Command loop>
      <CommandInput autoFocus value={search} onValueChange={setSearch} placeholder="Type words to find a doc, or a command…" />
      <CommandList className="max-h-[min(65vh,28rem)]">
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <DocCommandGroup query={search} onPick={(h) => close(() => run.pick(h))()} />
        {selected && (
          <CommandGroup heading={selected.title.slice(0, 60)}>
            <CommandItem value="open doc" onSelect={close(run.open)}>
              <FileTextIcon />
              Open the doc
              <CommandShortcut>O</CommandShortcut>
            </CommandItem>
            <CommandItem value="copy path" onSelect={close(run.copy)}>
              <CopyIcon />
              Copy {docPath(selected)}
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Views">
          {DOC_VIEWS.map((v) => (
            <CommandItem key={v.id} value={`view ${v.label}`} onSelect={close(() => run.view(v.id))}>
              <v.icon />
              {v.label}
              {v.id === view && <span className="text-xs text-muted-foreground">Current</span>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="General">
          {filtered && (
            <CommandItem onSelect={close(run.clear)}>
              <XIcon />
              Clear filters
            </CommandItem>
          )}
          <CommandItem onSelect={close(() => run.go("/todos"))}>
            <ListTodoIcon />
            Go to Todos
          </CommandItem>
          <CommandItem onSelect={close(() => run.go("/shared"))}>
            <GlobeIcon />
            Go to Shared
          </CommandItem>
          <CommandItem onSelect={close(() => run.go("/settings"))}>
            <SettingsIcon />
            Settings and API tokens
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
