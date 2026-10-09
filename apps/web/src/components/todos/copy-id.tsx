import { LinkIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

const copy = async (text: string, message: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error("The browser didn't allow copying")
  }
}

// Inside cards and rows: a click on these copies, and must not open the item or start a drag.
const stop = (e: React.SyntheticEvent) => e.stopPropagation()

const button = "cursor-pointer rounded hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/**
 * The underlined `#id` copies `#id`. `link` adds a button that copies the item's URL; "hover" shows
 * it only while the pointer is over the surrounding `group/item`, for cards and rows.
 */
export function CopyId({ id, link, className }: { id: number; link?: boolean | "hover"; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} onPointerDown={stop} onKeyDown={stop}>
      <button
        type="button"
        title="Copy the id"
        aria-label={`Copy #${id}`}
        onClick={(e) => (stop(e), copy(`#${id}`, `Copied #${id}`))}
        className={cn(button, "px-1 py-0.5 font-mono tabular-nums underline underline-offset-2")}
        translate="no"
      >
        #{id}
      </button>
      {link && (
        <button
          type="button"
          title="Copy a link to this item"
          aria-label={`Copy a link to #${id}`}
          onClick={(e) => (stop(e), copy(`${window.location.origin}/todos?item=${id}`, "Copied the link"))}
          className={cn(button, "p-1", link === "hover" && "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100")}
        >
          <LinkIcon className="size-3.5" />
        </button>
      )}
    </span>
  )
}
