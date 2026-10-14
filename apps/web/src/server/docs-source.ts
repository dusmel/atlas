import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { dataDir } from "./data-dir"

// /data/state is shared with the megacmd container: its loop writes mega-sync.txt every 30 s, touches
// mega-synced when every pair is synced, and answers a mega-pull file with mega-reload (deploy/megacmd).
const stateDir = () => join(dataDir(), "state")
const STALE_MS = 3 * 60_000

export type Source = "mega" | "manual"
export type MegaPair = { path: string; run: string; status: string; error: string }
/** unknown: no report yet (local dev, or the loop is not deployed). failed: a pair errors or stopped, or the report went stale. */
export type MegaState = "unknown" | "ok" | "syncing" | "failed"
/** `pull_requested` is set from Pull now until the megacmd loop picks the request up. */
export type Mega = { state: MegaState; checked: string | null; last_pull: string | null; pairs: MegaPair[]; detail?: string; pull_requested?: string | null }

const mtime = (path: string) => {
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return null
  }
}

export const sourceRoot = (source: Source) => join(dataDir(), source === "manual" ? "docs-manual" : "docs")
/** Docs sent by `atlas doc publish`, served until the copy above catches up (spec section 9, fast publish). Never synced to MEGA. */
export const fastRoot = () => join(dataDir(), "docs-fast")

/** The copy the server serves. `since` is when it last switched, which for `manual` is the last `atlas push`. */
export function readSource(): { source: Source; since: string | null } {
  const path = join(stateDir(), "docs-source")
  try {
    return { source: readFileSync(path, "utf8").trim() === "manual" ? "manual" : "mega", since: mtime(path) }
  } catch {
    return { source: "mega", since: null }
  }
}

export function writeSource(source: Source) {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(join(stateDir(), "docs-source"), `${source}\n`)
}

/** Reads `mega-sync --col-separator='|' --output-cols=LOCALPATH,RUN_STATE,STATUS,ERROR`. Null when the text is not that table, such as an error. */
export function parseMegaSync(text: string): MegaPair[] | null {
  const [head, ...rows] = text.trim().split("\n")
  if (head?.trim() !== "LOCALPATH|RUN_STATE|STATUS|ERROR") return null
  return rows.filter((r) => r.includes("|")).map((r) => {
    const [path = "", run = "", status = "", error = ""] = r.split("|").map((c) => c.trim())
    return { path, run, status, error }
  })
}

export function megaState(text: string | null, checked: string | null, lastPull: string | null, now = Date.now()): Mega {
  const base = { checked, last_pull: lastPull, pairs: [] as MegaPair[] }
  if (text === null || !checked) return { ...base, state: "unknown" }
  const pairs = parseMegaSync(text)
  if (!pairs) return { ...base, state: "failed", detail: text.trim().split("\n")[0]?.slice(0, 200) || "MEGAcmd gave no answer" }
  if (now - Date.parse(checked) > STALE_MS) return { ...base, pairs, state: "failed", detail: "MEGAcmd has not reported for over 3 minutes" }
  if (!pairs.length) return { ...base, pairs, state: "failed", detail: "MEGAcmd has no sync pairs" }
  const broken = pairs.find((p) => p.error !== "NO" || p.run === "Suspended" || p.run === "Disabled")
  if (broken) return { ...base, pairs, state: "failed", detail: `${broken.path}: ${broken.run}, error ${broken.error}` }
  return { ...base, pairs, state: pairs.every((p) => p.status === "Synced") ? "ok" : "syncing" }
}

export function readMega(): Mega {
  const report = join(stateDir(), "mega-sync.txt")
  let text: string | null = null
  try {
    text = readFileSync(report, "utf8")
  } catch {}
  return { ...megaState(text, mtime(report), mtime(join(stateDir(), "mega-synced"))), pull_requested: mtime(join(stateDir(), "mega-pull")) }
}

/** Asks the megacmd loop for `mega-reload`, which it picks up within 5 s. */
export function requestPull(): string {
  mkdirSync(stateDir(), { recursive: true })
  const at = new Date().toISOString()
  writeFileSync(join(stateDir(), "mega-pull"), `${at}\n`)
  return at
}
