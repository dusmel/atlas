import { useState } from "react"
import type { SessionPrompt } from "@/lib/timeline"

// Design: atlas/timeline/design.html#sessions (T19). The owner's prompts lead each day of a session.

const FOLD = 12

const clock = (at: string) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/** The typed text and each `<pasted_content>` block, in order. */
function segments(text: string): { pasted: boolean; text: string }[] {
  const out: { pasted: boolean; text: string }[] = []
  let at = 0
  for (const m of text.matchAll(/<pasted_content>\n?([\s\S]*?)\n?<\/pasted_content>/g)) {
    if (m.index > at) out.push({ pasted: false, text: text.slice(at, m.index).trim() })
    out.push({ pasted: true, text: m[1]! })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ pasted: false, text: text.slice(at).trim() })
  return out.filter((s) => s.text)
}

/** Text past 12 lines shows its first 12 and a button for the rest. */
function Folded({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = text.split("\n")
  const more = lines.length - FOLD
  return (
    <>
      <div className="break-words whitespace-pre-wrap">{open || more <= 0 ? text : lines.slice(0, FOLD).join("\n")}</div>
      {more > 0 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="cursor-pointer self-start text-[12.5px] text-link underline-offset-2 hover:underline">
          {open ? "Show less" : `Show ${more} more ${more === 1 ? "line" : "lines"}`}
        </button>
      )}
    </>
  )
}

export function Prompts({ prompts }: { prompts: SessionPrompt[] }) {
  return (
    <ol aria-label="Your prompts" className="mt-1 flex flex-col gap-3">
      {prompts.map((p) => (
        <li key={p.at} data-prompt className="flex gap-3 text-[14.5px] leading-normal">
          <time dateTime={p.at} className="w-[38px] shrink-0 pt-[3px] font-mono text-[11.5px] text-muted-foreground">
            {clock(p.at)}
          </time>
          <div className="flex min-w-0 grow flex-col gap-1.5">
            {segments(p.text).map((s, i) =>
              s.pasted ? (
                <div key={i} className="flex flex-col gap-1 rounded-md border-l-2 bg-muted/50 px-2.5 py-1.5 font-mono text-[12.5px]">
                  <span className="font-sans text-[11.5px] text-muted-foreground">pasted</span>
                  <Folded text={s.text} />
                </div>
              ) : (
                <Folded key={i} text={s.text} />
              ),
            )}
            {p.dropped > 0 && (
              <span className="text-[12px] text-muted-foreground">
                {p.dropped} {p.dropped === 1 ? "line" : "lines"} held back: {p.dropped === 1 ? "it looked" : "they looked"} like a secret
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
