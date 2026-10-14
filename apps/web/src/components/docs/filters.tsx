import { CheckIcon, ChevronDownIcon, FolderIcon, XIcon } from "lucide-react"
import { cn } from "cn"
import { SinceControl } from "@/components/todos/filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Option } from "@/lib/docs"

/**
 * Checkboxes with a count each. A thin bar under every row shows its share of the largest count, so
 * the sidebar reads as a chart of where the matches are.
 */
export function CheckList({ name, legend, options, picked, onToggle, touch, action }: { name: string; legend: string; options: Option[]; picked: string[]; onToggle: (v: string) => void; touch?: boolean; action?: React.ReactNode }) {
  const max = Math.max(1, ...options.map((o) => o.count))
  return (
    <FieldSet className="gap-1">
      <div className="flex h-7 items-center justify-between gap-2 px-2">
        <FieldLegend variant="label" className="mb-0 text-xs font-medium text-muted-foreground">
          {legend}
        </FieldLegend>
        {action}
      </div>
      <FieldGroup className="gap-0">
        {options.map((o) => {
          const on = picked.includes(o.value)
          const id = `${name}-${o.value}`
          return (
            <Field key={o.value} orientation="horizontal" className={cn("gap-2.5 rounded-md px-2 hover:bg-muted/60", touch ? "min-h-11" : "min-h-8")}>
              <Checkbox id={id} name={name} value={o.value} checked={on} onCheckedChange={() => onToggle(o.value)} />
              <div className="relative flex min-w-0 flex-1 items-center gap-2 self-stretch">
                <span aria-hidden className={cn("absolute bottom-1 left-0 h-0.5 rounded-full transition-[width]", on ? "bg-primary/70" : "bg-primary/20")} style={{ width: `${(o.count / max) * 100}%` }} />
                <FieldLabel htmlFor={id} className={cn("relative min-w-0 flex-1 cursor-pointer truncate font-normal", on && "font-medium", !o.count && !on && "text-muted-foreground")} translate="no">
                  {o.label}
                </FieldLabel>
                <span className={cn("relative text-xs tabular-nums", o.count ? "text-muted-foreground" : "text-muted-foreground/50")}>{o.count}</span>
              </div>
            </Field>
          )
        })}
      </FieldGroup>
    </FieldSet>
  )
}

export function FolderPopover({ options, picked, onToggle }: { options: Option[]; picked: string[]; onToggle: (v: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(picked.length && "border-primary/40")}>
          Folder
          {picked.length > 0 && <Badge className="h-5 min-w-5 px-1 tabular-nums">{picked.length}</Badge>}
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command loop>
          <CommandInput autoFocus placeholder="Filter by folder…" />
          <CommandList className="max-h-[min(60vh,24rem)]">
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = picked.includes(o.value)
                return (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => onToggle(o.value)} aria-checked={on} className="[&>svg:last-child]:hidden">
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {on && <CheckIcon className="size-3" />}
                    </span>
                    <FolderIcon className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className={cn("text-xs tabular-nums", o.count ? "text-muted-foreground" : "text-muted-foreground/50")}>{o.count}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ChangedPopover({ since, onChange }: { since?: string; onChange: (since?: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(since && "border-primary/40")}>
          Changed
          {since && <Badge className="h-5 px-1 tabular-nums">{since}</Badge>}
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="mb-2 text-xs text-muted-foreground">Docs saved in the last…</p>
        <SinceControl value={since} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}

export function FilterBadge({ kind, icon, label, onRemove, className }: { kind: string; icon: React.ReactNode; label: string; onRemove: () => void; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("h-7 max-w-full gap-1 pr-1 font-normal [&>svg]:size-3.5", className)}>
      <span className="text-muted-foreground">{kind}</span>
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        className="shrink-0 rounded-sm p-0.5 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Remove ${kind} ${label}`}
        onClick={onRemove}
      >
        <XIcon className="size-3.5" />
      </button>
    </Badge>
  )
}
