import { watch, type FSWatcher } from "node:fs"
import type { DocIndex } from "./store.ts"

/**
 * Re-syncs the index 1 s after the last change under its root, and rescans every 10 minutes in
 * case the watcher missed something or the root did not exist yet. Returns a function that stops both.
 */
export function watchDocs(index: DocIndex, { debounceMs = 1000, rescanMs = 600_000 } = {}): () => void {
  const sync = () => void index.sync().catch((err) => console.error("atlas: docs index sync failed", err))
  let timer: ReturnType<typeof setTimeout> | undefined
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(index.root, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(sync, debounceMs)
    })
    watcher.on("error", (err) => console.error("atlas: docs watcher failed; the 10-minute rescan still runs", err))
  } catch (err) {
    console.error(`atlas: cannot watch ${index.root}; the 10-minute rescan still runs`, err)
  }
  const rescan = setInterval(sync, rescanMs)
  rescan.unref()
  return () => {
    watcher?.close()
    clearInterval(rescan)
    clearTimeout(timer)
  }
}
