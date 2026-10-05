import { useEffect, useRef } from "react"

export type Hotkeys = Record<string, (e: KeyboardEvent) => void>

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')

/**
 * Single-key shortcuts for the page. Keys are `KeyboardEvent.key` values, with `mod+` for ⌘ or Ctrl.
 * Plain keys are ignored while typing or while a dialog is open; `mod+` keys always fire.
 */
export function useHotkeys(keys: Hotkeys, enabled = true) {
  const latest = useRef(keys)
  latest.current = keys
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const mod = e.metaKey || e.ctrlKey
      const name = mod ? `mod+${e.key.toLowerCase()}` : e.key
      const run = latest.current[name]
      if (!run || (!mod && (e.altKey || typing(e.target) || dialogOpen()))) return
      e.preventDefault()
      run(e)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled])
}
