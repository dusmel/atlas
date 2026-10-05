import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { ChevronRightIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CELL_LIMIT, cellKey, type BoardRow, type Cell } from "@/lib/board"
import { PRIORITY_NAME, rowLabel, STATUS_LABEL, type Item, type Place, type Row, type Status } from "@/lib/todos"
import { PriorityIcon, StatusIcon } from "./icons"
import { ItemCard, SortableCard } from "./item-card"

export type BoardProps = {
  rows: BoardRow[]
  statuses: Status[]
  laneTotals: Record<Status, number>
  showRepo: boolean
  childCount: Map<number, number>
  expanded: Set<string>
  selectedId: number | null
  doneAll: boolean
  onSelect: (id: number) => void
  onOpen: (id: number) => void
  onAdd: (row: Row) => void
  onToggleRow: (key: string) => void
  onToggleCell: (key: string) => void
  onToggleDone: () => void
  onMove: (item: Item, to: Place) => void
}


const CELL_PREFIX = "cell:"

export function Board(props: BoardProps) {
  const { rows, statuses } = props
  const [active, setActive] = useState<Item | null>(null)
  const sensors = useSensors(
    // A short travel before a drag starts, so a click still opens the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  )
  const byId = new Map(rows.flatMap((r) => r.cells.flatMap((c) => c.all)).map((i) => [i.id, i]))

  const onDragStart = (e: DragStartEvent) => setActive(byId.get(Number(e.active.id)) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const item = byId.get(Number(e.active.id))
    if (!item || !e.over || e.over.id === e.active.id) return
    const overId = String(e.over.id)
    if (overId.startsWith(CELL_PREFIX)) {
      const [, row, status] = overId.split(":")
      return props.onMove(item, { priority: row === "inbox" ? null : (row as Row), status: status as Status })
    }
    const over = byId.get(Number(overId))
    if (!over) return
    const sameLane = over.priority === item.priority && over.status === item.status
    // Dragging down a lane drops after the card under the pointer, everything else drops before it.
    const down = sameLane && (item.rank < over.rank || (item.rank === over.rank && item.id < over.id))
    props.onMove(item, { priority: over.priority, status: over.status, ...(down ? { after: over.id } : { before: over.id }) })
  }

  const cols = { gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))` }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="flex flex-col gap-3 px-4 pb-24 sm:px-6">
        <div className="sticky top-14 z-20 -mx-4 grid h-11 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:-mx-6 sm:px-6" style={cols}>
          {statuses.map((s) => (
            <div key={s} className="flex items-center gap-2 px-1 text-sm">
              <StatusIcon status={s} className="size-4" />
              <span className="font-medium">{STATUS_LABEL[s]}</span>
              <span className="text-muted-foreground tabular-nums">{props.laneTotals[s]}</span>
              {s === "done" && (
                <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs text-muted-foreground" onClick={props.onToggleDone}>
                  {props.doneAll ? "All time" : "Last 14 days"}
                </Button>
              )}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <section key={row.key} aria-label={rowLabel(row.row)} className="flex flex-col gap-2">
            <RowHeader row={row} onToggle={() => props.onToggleRow(row.key)} onAdd={() => props.onAdd(row.row)} />
            {!row.collapsed && (
              <div className="grid gap-3" style={cols}>
                {row.cells.map((cell) => (
                  <LaneCell key={cell.status} id={cellKey(row.row, cell.status)} cell={cell} dragging={!!active} {...props} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <ItemCard item={active} showRepo={props.showRepo} children={props.childCount.get(active.id) ?? 0} overlay />}
      </DragOverlay>
    </DndContext>
  )
}

// Sticks below the page header (h-14) and the lane bar (h-11).
function RowHeader({ row, onToggle, onAdd }: { row: BoardRow; onToggle: () => void; onAdd: () => void }) {
  const open = row.cells.filter((c) => c.status !== "done").reduce((n, c) => n + c.all.length, 0)
  const label = rowLabel(row.row)
  return (
    <div className="sticky top-25 z-10 flex h-10 items-center gap-1 rounded-lg bg-muted px-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!row.collapsed}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRightIcon aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform", !row.collapsed && "rotate-90")} />
        <PriorityIcon row={row.key} />
        <span className="font-medium">{label}</span>
        {PRIORITY_NAME[row.key] && <span className="text-muted-foreground">{PRIORITY_NAME[row.key]}</span>}
        <span className="text-muted-foreground tabular-nums">{open}</span>
      </button>
      {row.collapsed && (
        <span className="flex items-center gap-3 px-2 text-xs text-muted-foreground tabular-nums">
          {row.cells.map((c) => (
            <span key={c.status} className="flex items-center gap-1" title={`${c.all.length} ${STATUS_LABEL[c.status].toLowerCase()}`}>
              <StatusIcon status={c.status} />
              {c.all.length}
            </span>
          ))}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Add to ${label}`} onClick={onAdd}>
            <PlusIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add to {label}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function LaneCell({ id, cell, dragging, ...props }: BoardProps & { id: string; cell: Cell; dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CELL_PREFIX}${id}` })
  const hidden = cell.all.length - cell.shown.length
  const isExpanded = props.expanded.has(id)
  return (
    <div ref={setNodeRef} data-cell={id} className={cn("flex min-h-16 min-w-0 flex-col gap-2 rounded-xl bg-muted/35 p-1.5 transition-colors", dragging && "bg-muted/60", isOver && "bg-accent")}>
      <SortableContext items={cell.shown.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {cell.shown.map((item) => (
          <SortableCard
            key={item.id}
            item={item}
            showRepo={props.showRepo}
            children={props.childCount.get(item.id) ?? 0}
            selected={props.selectedId === item.id}
            onSelect={() => props.onSelect(item.id)}
            onOpen={() => props.onOpen(item.id)}
          />
        ))}
      </SortableContext>
      {(hidden > 0 || (isExpanded && cell.all.length > CELL_LIMIT)) && (
        <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => props.onToggleCell(id)}>
          {isExpanded ? "Show fewer" : `Show ${hidden} more`}
        </Button>
      )}
    </div>
  )
}
