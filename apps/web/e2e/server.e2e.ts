import { expect, test } from "@playwright/test"
import { spawn, execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Item } from "../src/server/todos"
import { PORT } from "../playwright.config"
import { api, cell, itemByTitle, login, openBoard } from "./helpers"

const web = join(import.meta.dirname, "..")
const cli = join(web, "../cli/index.ts")

test("the board and atlas todo see each other's changes", async ({ page }) => {
  await login(page)
  const { token } = await api<{ token: string }>(page, "POST", "/tokens", { name: `e2e-${Date.now()}` })
  const home = mkdtempSync(join(tmpdir(), "atlas-e2e-home-"))
  const atlas = (...args: string[]) =>
    execFileSync("bun", [cli, "todo", ...args], { env: { ...process.env, HOME: home, ATLAS_URL: `http://localhost:${PORT}`, ATLAS_TOKEN: token, ATLAS_AGENT: "0", ATLAS_AUTHOR: "e2e" }, encoding: "utf8" })

  const item = await itemByTitle(page, "Synced with the CLI")
  await openBoard(page, "/todos?q=Synced with the CLI")
  await page.keyboard.press("j")
  await page.keyboard.press("0")
  await expect(cell(page, "P0:todo").locator(`[data-item="${item.id}"]`)).toBeVisible()
  await expect.poll(() => (JSON.parse(atlas("list", "--all", "--json")) as Item[]).find((i) => i.id === item.id)?.priority).toBe("P0")

  // The board refetches every 15 s, so a CLI change shows up without a reload.
  atlas("move", String(item.id), "--priority", "P3", "--status", "doing")
  await expect(cell(page, "P3:doing").locator(`[data-item="${item.id}"]`)).toBeVisible({ timeout: 20_000 })
})

test("the auth gate answers 500 when the database can't open", async () => {
  // A data dir under a regular file can never be created, on any OS or user.
  const blocker = join(mkdtempSync(join(tmpdir(), "atlas-e2e-broken-")), "file")
  writeFileSync(blocker, "")
  const port = PORT + 1
  const server = spawn("bun", ["server.ts"], { cwd: web, env: { ...process.env, PORT: String(port), ATLAS_DATA_DIR: join(blocker, "data"), ATLAS_PASSWORD_HASH_B64: "unused" }, stdio: "ignore" })
  try {
    await expect.poll(() => fetch(`http://localhost:${port}/api/health`).then((r) => r.status, () => 0)).toBe(503)
    const res = await fetch(`http://localhost:${port}/api/todos`)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: { code: "db_unavailable" } })
    expect((await fetch(`http://localhost:${port}/todos`, { redirect: "manual" })).status).toBe(500)
  } finally {
    server.kill()
  }
})

test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("the board fits without sideways scrolling", async ({ page }) => {
    await login(page)
    await openBoard(page, "/todos")
    await expect(page.getByRole("tab", { name: /^Todo/ })).toBeVisible()
    await expect(page.locator("[data-item]").first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
