import { Fragment } from "react"

// Titles carry `code`, **bold** and *italic* from the old TODO.md files. Everything else is plain text.
const MARKS = /(`[^`]+`|\*\*.+?\*\*|\*[^*\s][^*]*\*)/g

export function RichTitle({ text }: { text: string }) {
  return (
    <>
      {text.split(MARKS).map((part, n) =>
        part.length > 1 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={n} className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        ) : part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
          <strong key={n} className="font-semibold">
            <RichTitle text={part.slice(2, -2)} />
          </strong>
        ) : part.length > 2 && part.startsWith("*") && part.endsWith("*") ? (
          <em key={n}>{part.slice(1, -1)}</em>
        ) : (
          <Fragment key={n}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** The title as plain text, for group names, search values and screen readers. */
export const plainTitle = (text: string) => text.replace(/[`*]/g, "")
