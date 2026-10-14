// Starts the production server on a throwaway database of made-up items, for the Playwright tests.
// The repo is public: never seed real todos here.
import { cpSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGroup, createTodo } from "../src/server/todos"
import { freshDb } from "../test/helpers"
import { DOCS, MEGA_SYNCED, PASSWORD, PUSHED_ONLY, SEED } from "./seed"

const dir = mkdtempSync(join(tmpdir(), "atlas-e2e-"))
const db = freshDb(join(dir, "atlas.db"))
for (const group of SEED.groups) createGroup(db, group)
for (const { by = "me", days, ...item } of SEED.items) {
  const { id } = createTodo(db, { actor: "cli:seed", author: by }, item)
  if (days) {
    const at = new Date(Date.now() - days * 864e5).toISOString()
    db.run("UPDATE items SET created_at = ?, updated_at = ?, done_at = CASE WHEN done_at IS NULL THEN NULL ELSE ? END WHERE id = ?", [at, at, at, id])
  }
}
db.close()
for (const [path, text] of Object.entries(DOCS)) await Bun.write(join(dir, "docs", path), text)
// One doc from three days ago, for the Changed filter.
const old = new Date(Date.now() - 3 * 864e5)
utimesSync(join(dir, "docs", "web/notes/harbour.md"), old, old)

process.env.ATLAS_DATA_DIR = dir
process.env.ATLAS_PASSWORD_HASH_B64 = Buffer.from(await Bun.password.hash(PASSWORD)).toString("base64")
console.log(`e2e data in ${dir}`)
await import("../server")

// Edit one doc after the first index, so Activity has a change to show. The first index only records what is there.
const health = `http://localhost:${process.env.PORT ?? 3000}/api/health`
while ((await (await fetch(health)).json()).docs?.count !== 4) await Bun.sleep(100)
await Bun.write(join(dir, "docs", "api/runbook.html"), DOCS["api/runbook.html"] + "\n")

// What `atlas push` would have sent: the same docs, plus one that only this "Mac" has.
cpSync(join(dir, "docs"), join(dir, "docs-manual"), { recursive: true, preserveTimestamps: true })
await Bun.write(join(dir, "docs-manual", PUSHED_ONLY.path), PUSHED_ONLY.text)

// Stands in for the megacmd loop (deploy/megacmd/start.sh): a fresh report with both pairs synced.
mkdirSync(join(dir, "state"), { recursive: true })
const report = () => {
  writeFileSync(join(dir, "state", "mega-sync.txt"), MEGA_SYNCED)
  writeFileSync(join(dir, "state", "mega-synced"), "")
}
report()
setInterval(report, 30_000)
