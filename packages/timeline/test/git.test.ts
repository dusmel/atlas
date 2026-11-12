import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { baseBranch, branchWork, matchingBranches } from "../src/git"

let dir = ""
const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
}
const commit = (file: string, subject: string, date: string) => {
  writeFileSync(join(dir, file), subject)
  git("add", file)
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", subject], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_CONFIG_GLOBAL: "/dev/null" },
  })
}

// main, then v1/1-a stacked on main, v1/2-b on v1/1-a, and v1/10-c on v1/2-b.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "timeline-git-"))
  git("init", "-q", "-b", "main")
  commit("base", "Initial commit", "2026-11-01T10:00:00+02:00")
  git("switch", "-q", "-c", "v1/1-a")
  commit("a1", "Add a", "2026-11-05T09:00:00+02:00")
  commit("a2", "Fix a late at night", "2026-11-05T23:30:00+02:00")
  git("switch", "-q", "-c", "v1/2-b")
  commit("b1", "Add b", "2026-11-08T11:00:00+02:00")
  git("switch", "-q", "-c", "v1/10-c")
  commit("c1", "Add c", "2026-11-09T11:00:00+02:00")
  git("switch", "-q", "-c", "other")
  commit("o1", "Not in the effort", "2026-11-09T12:00:00+02:00")
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("finds the base branch without a remote", async () => {
  expect(await baseBranch(dir)).toBe("main")
})

test("lists the pattern's branches in stack order, numbers as numbers", async () => {
  expect((await matchingBranches(dir, "v1/*")).map((b) => b.name)).toEqual(["v1/1-a", "v1/2-b", "v1/10-c"])
})

test("gives each branch only its own commits, oldest first, on the author's day", async () => {
  const work = await branchWork(dir, "v1/*")
  expect(work.map((w) => [w.branch, w.commits.map((c) => [c.day, c.subject])])).toEqual([
    ["v1/1-a", [["2026-11-05", "Add a"], ["2026-11-05", "Fix a late at night"]]],
    ["v1/2-b", [["2026-11-08", "Add b"]]],
    ["v1/10-c", [["2026-11-09", "Add c"]]],
  ])
  expect(work[0]!.commits[0]!.short).toMatch(/^[0-9a-f]{7,}$/)
})

test("a pattern with no branches gives nothing", async () => {
  expect(await branchWork(dir, "v9/*")).toEqual([])
})
