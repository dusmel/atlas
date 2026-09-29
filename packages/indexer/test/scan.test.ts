import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanDocs } from "../src/index.ts"

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "atlas-indexer-"))
  const files = [
    "alpha/plan.md",
    "alpha/notes/deep/idea.html",
    "alpha/TODO.md",
    "alpha/TODO.imported-2026-10-01.md",
    "alpha/meta.json",
    "alpha/.DS_Store",
    "alpha/backups/old.md",
    "alpha/.hidden/secret.md",
    "beta/index.html",
    "beta/image.png",
    "loose.md",
  ]
  for (const f of files) await Bun.write(join(root, f), "x")
})

afterAll(() => rm(root, { recursive: true, force: true }))

test("finds md and html per repo and applies the skip rules", async () => {
  expect(await scanDocs(root)).toEqual([
    { repo: "alpha", path: "notes/deep/idea.html", kind: "html" },
    { repo: "alpha", path: "plan.md", kind: "md" },
    { repo: "alpha", path: "TODO.md", kind: "md" },
    { repo: "beta", path: "index.html", kind: "html" },
  ])
})
