import { CopyIcon, ExternalLinkIcon, FileTextIcon, ListTodoIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { docPath, type Hit } from "@/lib/docs"
import { DocCommandGroup } from "./doc-command-group"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: { path: string; title: string }
  run: { pick: (hit: Hit) => void; copy: () => void; raw: () => void; go: (to: "/docs" | "/todos") => void }
}

/** ⌘K over a doc in the frame: find another doc, or act on this one. */
export function DocPalette(props: Props) {
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange} title="Command palette" description="Find a doc, or act on this one." className="sm:max-w-xl">
      {props.open && <Palette {...props} />}
    </CommandDialog>
  )
}

function Palette({ doc, onOpenChange, run }: Props) {
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
        <CommandGroup heading={doc.title.slice(0, 60)}>
          <CommandItem value="copy path" onSelect={close(run.copy)}>
            <CopyIcon />
            Copy {docPath(doc)}
          </CommandItem>
          <CommandItem value="open raw" onSelect={close(run.raw)}>
            <ExternalLinkIcon />
            Open raw in a new tab
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="General">
          <CommandItem onSelect={close(() => run.go("/docs"))}>
            <SearchIcon />
            Go to Docs
          </CommandItem>
          <CommandItem onSelect={close(() => run.go("/todos"))}>
            <ListTodoIcon />
            Go to Todos
          </CommandItem>
        </CommandGroup>
        {!search && (
          <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
            <FileTextIcon aria-hidden className="size-3.5" />
            Type two letters or more to find a doc.
          </p>
        )}
      </CommandList>
    </Command>
  )
}
