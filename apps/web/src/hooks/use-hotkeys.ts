import { useEffect, useRef } from "react"

export type Hotkeys = Record<string, (e: KeyboardEvent) => void>

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')
const SEQUENCE_MS = 1500

/**
 * Single-key shortcuts for the page. Keys are `KeyboardEvent.key` values, with `mod+` for ⌘ or Ctrl.
 * A space makes a sequence: "v 1" is V, then 1 within 1.5 s.
 * Plain keys are ignored while typing or while a dialog is open; `mod+` keys always fire.
 */
export function useHotkeys(keys: Hotkeys, enabled = true) {
  const latest = useRef(keys)
  latest.current = keys
  useEffect(() => {
    if (!enabled) return
    let pending: { key: string; at: number } | null = null
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const mod = e.metaKey || e.ctrlKey
      const name = mod ? `mod+${e.key.toLowerCase()}` : e.key
      if (!mod && (e.altKey || typing(e.target) || dialogOpen())) return
      const prev = pending
      pending = null
      const run = (prev && e.timeStamp - prev.at < SEQUENCE_MS && latest.current[`${prev.key} ${name}`]) || latest.current[name]
      if (run) {
        e.preventDefault()
        return run(e)
      }
      if (!mod && Object.keys(latest.current).some((k) => k.startsWith(`${name} `))) pending = { key: name, at: e.timeStamp }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled])
}
