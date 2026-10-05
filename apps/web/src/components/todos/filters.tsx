import { BoxIcon, CheckIcon, ChevronDownIcon, ListFilterIcon, SearchIcon, XIcon } from "lucide-react"
import { useMemo, useRef } from "react"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { activeCount, facetCounts, FACETS, isAgent, rowLabel, STATUS_LABEL, type Facet, type Filters, type Group, type Item, type Repo } from "@/lib/todos"
import { AuthorAvatar } from "./author-avatar"
import { groupColor } from "./group-color"
import { PriorityIcon, StatusIcon } from "./icons"
import { plainTitle } from "./rich-title"

export const FACET_LABEL: Record<Facet, string> = { repo: "Repo", group: "Group", priority: "Priority", status: "Status", by: "Author" }

export type Option = { value: string; label: string; section?: string; count: number; icon?: React.ReactNode }

/** Every value each filter can take, with how many items it would show given the other filters. */
export function useOptions(items: Item[], filters: Filters, repos: Repo[], groups: Group[]): Record<Facet, Option[]> {
  return useMemo(() => {
    const counted = (facet: Facet) => facetCounts(items, filters, facet)
    const n = (m: Map<string, number>, v: string) => m.get(v) ?? 0
    const repoCounts = counted("repo")
    const groupCounts = counted("group")
    const priorityCounts = counted("priority")
    const statusCounts = counted("status")
    const byCounts = counted("by")
    const authors = [...new Set(items.map((i) => i.created_by ?? "unknown"))].sort((a, b) => n(byCounts, b) - n(byCounts, a))
    return {
      repo: [...new Set(repos.map((r) => r.name))].map((name) => ({ value: name, label: name, count: n(repoCounts, name), icon: <BoxIcon className="text-muted-foreground" /> })).sort((a, b) => b.count - a.count),
      group: [
        ...groups.map((g) => ({ value: String(g.id), label: plainTitle(g.name), section: g.repo_name, count: n(groupCounts, String(g.id)), icon: <GroupDot color={groupColor(g.name)} /> })),
        { value: "none", label: "No group", count: n(groupCounts, "none"), icon: <GroupDot /> },
      ],
      priority: ["inbox", "P0", "P1", "P2", "P3"].map((p) => ({ value: p, label: rowLabel(p === "inbox" ? null : (p as "P0")), count: n(priorityCounts, p), icon: <PriorityIcon row={p} /> })),
      status: (["todo", "doing", "done"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s], count: n(statusCounts, s), icon: <StatusIcon status={s} /> })),
      by: [
        { value: "agent", label: "Any agent", count: n(byCounts, "agent"), icon: <AuthorAvatar author="agent" /> },
        ...authors.map((a) => ({ value: a, label: a, section: isAgent(a) ? "Agents" : "People and tools", count: n(byCounts, a), icon: <AuthorAvatar author={a} /> })),
      ],
    }
  }, [items, filters, repos, groups])
}

const selected = (filters: Filters, facet: Facet) => (filters[facet] ?? []).map(String)

export function toggle(filters: Filters, facet: Facet, value: string): Filters {
  const now = selected(filters, facet)
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value]
  return { ...filters, [facet]: next.length ? (facet === "group" ? next.map((v) => (v === "none" ? v : Number(v))) : next) : undefined }
}

/** A searchable list of filter values: one facet in a popover, or all of them in the palette and the phone drawer. */
export function FacetCommand({ facets, options, filters, onChange, autoFocus }: { facets: Facet[]; options: Record<Facet, Option[]>; filters: Filters; onChange: (f: Filters) => void; autoFocus?: boolean }) {
  const single = facets.length === 1
  return (
    <Command loop>
      <CommandInput autoFocus={autoFocus} placeholder={single ? `Filter by ${FACET_LABEL[facets[0]!].toLowerCase()}…` : "Filter by repo, group, priority, status or author…"} />
      <CommandList className="max-h-[min(60vh,24rem)]">
        <CommandEmpty>No match.</CommandEmpty>
        {facets.flatMap((facet) => {
          const sections = new Map<string, Option[]>()
          for (const o of options[facet]) {
            const name = single ? (o.section ?? "") : `${FACET_LABEL[facet]}${o.section ? `: ${o.section}` : ""}`
            sections.set(name, [...(sections.get(name) ?? []), o])
          }
          return [...sections.entries()].map(([name, opts]) => (
            <CommandGroup key={`${facet}:${name}`} heading={name || undefined}>
              {opts.map((o) => {
                const on = selected(filters, facet).includes(o.value)
                return (
                  <CommandItem
                    key={o.value}
                    value={`${facet} ${o.section ?? ""} ${o.label} ${o.value}`}
                    onSelect={() => onChange(toggle(filters, facet, o.value))}
                    aria-checked={on}
                    className="[&>svg:last-child]:hidden"
                  >
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {on && <CheckIcon className="size-3" />}
                    </span>
                    {o.icon}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className={cn("text-xs tabular-nums", o.count ? "text-muted-foreground" : "text-muted-foreground/50")}>{o.count}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))
        })}
      </CommandList>
    </Command>
  )
}

const optionOf = (facet: Facet, value: string, options: Record<Facet, Option[]>) => options[facet].find((x) => x.value === value)
const badgeLabel = (facet: Facet, value: string, options: Record<Facet, Option[]>) => optionOf(facet, value, options)?.label ?? value

// A group's colour, or a hollow ring for "No group".
export const GroupDot = ({ color }: { color?: string }) => (
  <span aria-hidden className={cn("mx-0.5 size-2.5 shrink-0 rounded-full", !color && "border border-muted-foreground")} style={color ? { background: color } : undefined} />
)

type BarProps = {
  filters: Filters
  options: Record<Facet, Option[]>
  onChange: (f: Filters) => void
  desktop: boolean
  searchRef: React.RefObject<HTMLInputElement | null>
  /** Items in view; left out where a count means nothing, as in Activity. */
  shown?: number
}

export function FilterBar({ filters, options, onChange, desktop, searchRef, shown }: BarProps) {
  const active = activeCount(filters)
  const tags = FACETS.flatMap((facet) => selected(filters, facet).map((value) => ({ facet, value })))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearch = (q: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange({ ...filters, q: q || undefined }), 150)
  }
  return (
    <div className="flex flex-col gap-2 px-4 pt-3 pb-2 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            type="search"
            name="q"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search titles and bodies"
            placeholder="Search titles, bodies, #id…"
            defaultValue={filters.q ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
          />
          {desktop && (
            <InputGroupAddon align="inline-end">
              <Kbd>/</Kbd>
            </InputGroupAddon>
          )}
        </InputGroup>
        {desktop ? (
          FACETS.map((facet) => <FacetPopover key={facet} facet={facet} options={options} filters={filters} onChange={onChange} />)
        ) : (
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline" className="min-h-11 flex-1">
                <ListFilterIcon data-icon="inline-start" />
                Filters
                {active > 0 && <Badge className="ml-1 tabular-nums">{active}</Badge>}
              </Button>
            </DrawerTrigger>
            <DrawerContent className="pb-[env(safe-area-inset-bottom)]">
              <DrawerHeader className="flex-row items-center justify-between">
                <DrawerTitle>Filters</DrawerTitle>
                {active > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => onChange({ done: filters.done })}>
                    Clear all
                  </Button>
                )}
              </DrawerHeader>
              <div className="px-2 pb-4">
                <FacetCommand facets={FACETS} options={options} filters={filters} onChange={onChange} />
              </div>
            </DrawerContent>
          </Drawer>
        )}
        {shown !== undefined && (
          <span className="ml-auto hidden text-sm text-muted-foreground tabular-nums sm:inline" aria-live="polite">
            {shown} {shown === 1 ? "item" : "items"}
          </span>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map(({ facet, value }) => (
            <Badge key={`${facet}:${value}`} variant="secondary" className="h-7 gap-1 pr-1 font-normal">
              <span className="text-muted-foreground">{FACET_LABEL[facet]}</span>
              <span className="flex items-center [&>svg]:size-3.5 [&>[role=img]]:size-4">{optionOf(facet, value, options)?.icon}</span>
              {badgeLabel(facet, value, options)}
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={`Remove ${FACET_LABEL[facet]} ${badgeLabel(facet, value, options)}`}
                onClick={() => onChange(toggle(filters, facet, value))}
              >
                <XIcon className="size-3.5" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => onChange({ done: filters.done, q: filters.q })}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  )
}

function FacetPopover({ facet, options, filters, onChange }: { facet: Facet; options: Record<Facet, Option[]>; filters: Filters; onChange: (f: Filters) => void }) {
  const count = selected(filters, facet).length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-9", count && "border-primary/40")}>
          {FACET_LABEL[facet]}
          {count > 0 && <Badge className="h-5 min-w-5 px-1 tabular-nums">{count}</Badge>}
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <FacetCommand facets={[facet]} options={options} filters={filters} onChange={onChange} autoFocus />
      </PopoverContent>
    </Popover>
  )
}
