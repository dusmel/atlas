import { ChevronRightIcon, PlusIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CELL_LIMIT, cellKey } from "@/lib/board"
import { PRIORITY_NAME, rowLabel, STATUS_LABEL, type Status } from "@/lib/todos"
import { type BoardProps } from "./board"
import { PriorityIcon, StatusIcon } from "./icons"
import { ItemCard } from "./item-card"

/** The board at phone width: one lane at a time, priorities stacked. Cards move through the item drawer, not by dragging. */
export function MobileBoard(props: BoardProps & { lane: Status; onLane: (s: Status) => void }) {
  const { rows, statuses, lane } = props
  const at = statuses.indexOf(lane) >= 0 ? lane : statuses[0]!
  return (
    <div className="flex flex-col pb-28">
      <Tabs value={at} onValueChange={(v) => props.onLane(v as Status)} className="sticky top-14 z-10 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <TabsList className="w-full">
          {statuses.map((s) => (
            <TabsTrigger key={s} value={s} className="flex-1 gap-1.5">
              <StatusIcon status={s} />
              {STATUS_LABEL[s]}
              <span className="text-muted-foreground tabular-nums">{props.laneTotals[s]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {at === "done" && (
        <Button variant="ghost" size="sm" className="mx-4 mt-2 self-start text-muted-foreground" onClick={props.onToggleDone}>
          {props.doneAll ? "Showing all time" : "Showing the last 14 days"}
        </Button>
      )}
      {rows.map((row) => {
        const cell = row.cells.find((c) => c.status === at)
        if (!cell) return null
        const key = cellKey(row.row, at)
        const expanded = props.expanded.has(key)
        const shown = row.collapsed ? [] : expanded ? cell.all : cell.all.slice(0, CELL_LIMIT)
        const label = rowLabel(row.row)
        return (
          <section key={row.key} aria-label={label} className="flex flex-col gap-2 px-4 pt-3">
            <div className="flex items-center gap-1 rounded-lg bg-muted pl-1">
              <button
                type="button"
                onClick={() => props.onToggleRow(row.key)}
                aria-expanded={!row.collapsed}
                className="flex min-h-11 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm font-medium"
              >
                <ChevronRightIcon aria-hidden className={cn("size-4 text-muted-foreground transition-transform", !row.collapsed && "rotate-90")} />
                <PriorityIcon row={row.key} />
                {label}
                {PRIORITY_NAME[row.key] && <span className="font-normal text-muted-foreground">{PRIORITY_NAME[row.key]}</span>}
                <span className="font-normal text-muted-foreground tabular-nums">{cell.all.length}</span>
              </button>
              <Button variant="ghost" size="icon" className="size-11" aria-label={`Add to ${label}`} onClick={() => props.onAdd(row.row)}>
                <PlusIcon />
              </Button>
            </div>
            {shown.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                role="button"
                tabIndex={0}
                showRepo={props.showRepo}
                children={props.childCount.get(item.id) ?? 0}
                selected={props.selectedId === item.id}
                onClick={() => props.onOpen(item.id)}
              />
            ))}
            {!row.collapsed && cell.all.length > CELL_LIMIT && (
              <Button variant="ghost" className="min-h-11 justify-start text-muted-foreground" onClick={() => props.onToggleCell(key)}>
                {expanded ? "Show fewer" : `Show ${cell.all.length - CELL_LIMIT} more`}
              </Button>
            )}
            {!row.collapsed && !cell.all.length && <p className="px-2 text-sm text-muted-foreground">Nothing here</p>}
          </section>
        )
      })}
    </div>
  )
}
