import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { BoxIcon, ListTreeIcon } from "lucide-react"
import { cn } from "cn"
import { exact, shortDate } from "@/lib/format"
import { PRIORITY_NAME, rowKey, rowLabel, type Item } from "@/lib/todos"
import { groupColor } from "./group-color"
import { PriorityIcon, StatusIcon } from "./icons"
import { plainTitle, RichTitle } from "./rich-title"

type CardProps = {
  item: Item
  showRepo: boolean
  children: number
  selected?: boolean
  dragging?: boolean
  overlay?: boolean
} & React.ComponentProps<"div">

const chip = "inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs text-muted-foreground"

export function ItemCard({ item, showRepo, children, selected, dragging, overlay, className, ...props }: CardProps) {
  const done = item.status === "done"
  const row = rowKey(item.priority)
  return (
    <div
      data-item={item.id}
      aria-label={`#${item.id} ${plainTitle(item.title)}`}
      className={cn(
        "group/card relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-3 text-left text-sm shadow-xs outline-none select-none",
        "transition-[box-shadow,background-color] hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "ring-2 ring-ring",
        dragging && "opacity-40",
        overlay && "cursor-grabbing shadow-lg ring-1 ring-ring",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
        <span translate="no">#{item.id}</span>
        {children > 0 && (
          <span className="flex items-center gap-0.5" title={`${children} child items`}>
            <ListTreeIcon aria-hidden className="size-3.5" />
            {children}
          </span>
        )}
        <span className="ml-auto" title={`${done && item.done_at ? "Done" : "Created"} ${exact(done && item.done_at ? item.done_at : item.created_at)}`}>
          {shortDate(done && item.done_at ? item.done_at : item.created_at)}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <StatusIcon status={item.status} className="mt-[0.2rem]" />
        <p className={cn("line-clamp-2 leading-snug text-pretty break-words", done && "text-muted-foreground")}>
          <RichTitle text={item.title} />
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <span className={cn(chip, "px-1.5")} title={`${rowLabel(item.priority)}${PRIORITY_NAME[row] ? ` ${PRIORITY_NAME[row]}` : ""}`}>
          <PriorityIcon row={row} className="size-3.5" />
        </span>
        {showRepo && (
          <span className={chip} translate="no">
            <BoxIcon aria-hidden className="size-3.5" />
            <span className="truncate">{item.repo_name}</span>
          </span>
        )}
        {item.group_name && (
          <span className={cn(chip, "shrink")}>
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: groupColor(item.group_name) }} />
            <span className="truncate">{plainTitle(item.group_name)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/** A card the board can drag. Space picks it up from the keyboard; Enter is left to the page, which opens it. */
export function SortableCard(props: Omit<CardProps, "dragging"> & { onOpen: () => void; onSelect: () => void }) {
  const { item, onOpen, onSelect, ...rest } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <ItemCard
      ref={setNodeRef}
      item={item}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onFocus={onSelect}
      onClick={onOpen}
      {...rest}
    />
  )
}
