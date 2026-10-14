import { useNavigate } from "@tanstack/react-router"
import { ClipboardCopyIcon, CopyIcon, ExternalLinkIcon, GlobeIcon, LinkIcon, ListTodoIcon, SearchIcon, SettingsIcon } from "lucide-react"
import { useState } from "react"
import { copy } from "@/components/todos/copy-id"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { docHref, docPath, rawHref, type DocPage } from "@/lib/docs"
import { DocCommandGroup } from "./doc-command-group"
import { copyPath } from "./hits"
import { shareUrl, useMakePublic } from "./share-button"

export async function copyMarkdown(repo: string, path: string) {
  const res = await fetch(`${rawHref({ repo, path })}?format=md`)
  if (res.ok) await copy(await res.text(), "Markdown copied")
}

const PAGES = [
  { to: "/docs", label: "Go to Docs", icon: SearchIcon },
  { to: "/todos", label: "Go to Todos", icon: ListTodoIcon },
  { to: "/shared", label: "Go to Shared", icon: GlobeIcon },
  { to: "/settings", label: "Settings and API tokens", icon: SettingsIcon },
] as const

type Props = { open: boolean; onOpenChange: (open: boolean) => void; doc?: DocPage; page?: (typeof PAGES)[number]["to"] }

/** ⌘K on a doc and on Shared: find a doc, act on the open one, or go to a page. */
export function DocPalette(props: Props) {
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange} title="Command palette" description="Find a doc, act on this one, or go to a page." className="sm:max-w-xl">
      {props.open && <Palette {...props} />}
    </CommandDialog>
  )
}

function Palette({ doc, page, onOpenChange }: Props) {
  const navigate = useNavigate()
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
        <DocCommandGroup query={search} onPick={(h) => close(() => void navigate({ href: docHref(h) }))()} />
        {doc && <DocActions doc={doc} close={close} />}
        <CommandGroup heading="General">
          {PAGES.filter((p) => p.to !== page).map((p) => (
            <CommandItem key={p.to} onSelect={close(() => void navigate({ to: p.to }))}>
              <p.icon />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function DocActions({ doc, close }: { doc: DocPage; close: (then: () => void) => () => void }) {
  const make = useMakePublic(doc.repo, doc.path)
  const share = doc.share
  return (
    <CommandGroup heading={doc.title.slice(0, 60)}>
      <CommandItem value="copy path" onSelect={close(() => copyPath(doc))}>
        <CopyIcon />
        Copy {docPath(doc)}
      </CommandItem>
      {doc.markdown && (
        <CommandItem value="copy as markdown" onSelect={close(() => void copyMarkdown(doc.repo, doc.path))}>
          <ClipboardCopyIcon />
          Copy as Markdown
        </CommandItem>
      )}
      {share ? (
        <CommandItem value="copy public link" onSelect={close(() => void copy(shareUrl(share), "Public link copied"))}>
          <LinkIcon />
          Copy public link
        </CommandItem>
      ) : (
        <CommandItem value="make public" onSelect={close(() => make.mutate())}>
          <GlobeIcon />
          Make public
        </CommandItem>
      )}
      <CommandItem value="open raw" onSelect={close(() => void window.open(rawHref(doc), "_blank", "noopener"))}>
        <ExternalLinkIcon />
        Open raw in a new tab
      </CommandItem>
    </CommandGroup>
  )
}
