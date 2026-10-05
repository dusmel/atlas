// Starts the production server on a throwaway database of made-up items, for the Playwright tests.
// The repo is public: never seed real todos here.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGroup, createTodo } from "../src/server/todos"
import { freshDb } from "../test/helpers"
import { PASSWORD, SEED } from "./seed"

const dir = mkdtempSync(join(tmpdir(), "atlas-e2e-"))
const db = freshDb(join(dir, "atlas.db"))
for (const group of SEED.groups) createGroup(db, group)
for (const { by = "me", ...item } of SEED.items) createTodo(db, { actor: "cli:seed", author: by }, item)
db.close()

process.env.ATLAS_DATA_DIR = dir
process.env.ATLAS_PASSWORD_HASH_B64 = Buffer.from(await Bun.password.hash(PASSWORD)).toString("base64")
console.log(`e2e data in ${dir}`)
await import("../server")
