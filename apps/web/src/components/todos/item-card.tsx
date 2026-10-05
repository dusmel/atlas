import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ListTreeIcon } from "lucide-react"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import type { Item } from "@/lib/todos"
import { groupColor } from "./group-color"
import { plainTitle, RichTitle } from "./rich-title"

type CardProps = {
  item: Item
  showRepo: boolean
  children: number
  selected?: boolean
  dragging?: boolean
  overlay?: boolean
} & React.ComponentProps<"div">

export function ItemCard({ item, showRepo, children, selected, dragging, overlay, className, ...props }: CardProps) {
  const done = item.status === "done"
  return (
    <div
      data-item={item.id}
      aria-label={`#${item.id} ${plainTitle(item.title)}`}
      className={cn(
        "group/card relative flex cursor-pointer flex-col gap-1.5 rounded-md border border-l-[3px] bg-card py-2 pr-2.5 pl-2.5 text-left text-sm outline-none select-none",
        "transition-[box-shadow,background-color] hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "ring-2 ring-ring",
        dragging && "opacity-40",
        overlay && "cursor-grabbing shadow-lg ring-1 ring-ring",
        className,
      )}
      style={{ borderLeftColor: groupColor(item.group_name) }}
      {...props}
    >
      <p className={cn("line-clamp-2 leading-snug text-pretty break-words", done && "text-muted-foreground")}>
        <RichTitle text={item.title} />
      </p>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums" translate="no">
          #{item.id}
        </span>
        {showRepo && (
          <Badge variant="outline" className="h-5 max-w-36 truncate px-1.5 font-normal" translate="no">
            {item.repo_name}
          </Badge>
        )}
        {item.group_name && <span className="hidden min-w-0 truncate min-[900px]:inline">{plainTitle(item.group_name)}</span>}
        {item.section && <span className="min-w-0 truncate italic">{item.section}</span>}
        {children > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5" title={`${children} child items`}>
            <ListTreeIcon aria-hidden className="size-3.5" />
            {children}
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
      style={{ transform: CSS.Translate.toString(transform), transition, borderLeftColor: groupColor(item.group_name) }}
      {...attributes}
      {...listeners}
      onFocus={onSelect}
      onClick={onOpen}
      {...rest}
    />
  )
}
