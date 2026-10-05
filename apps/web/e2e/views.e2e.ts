import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { PORT } from "../playwright.config"
import type { Item } from "../src/server/todos"
import { api, getItem, itemByTitle, login, overflowing } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

const row = (page: Page, id: number) => page.locator(`[data-row="${id}"]`)

// The real CLI, pointed at the test server. An empty ATLAS_ROOT keeps it away from this Mac's repos.
let token: string | undefined
async function atlas(page: Page, ...args: string[]): Promise<string> {
  token ??= (await api<{ token: string }>(page, "POST", "/tokens", { name: `e2e-${Date.now()}` })).token
  return execFileSync("bun", [join(import.meta.dirname, "../../cli/index.ts"), "todo", ...args], {
    env: { ...process.env, ATLAS_URL: `http://localhost:${PORT}`, ATLAS_TOKEN: token, ATLAS_ROOT: mkdtempSync(join(tmpdir(), "atlas-cli-")), ATLAS_AUTHOR: "opencode", ATLAS_AGENT: "0" },
    encoding: "utf8",
  })
}

test("List: tick two rows, set their priority in one go, and it stays after a reload", async ({ page }) => {
  const one = await itemByTitle(page, "Bulk one")
  const two = await itemByTitle(page, "Bulk two")
  await page.goto("/todos?view=list&q=Bulk")
  await page.getByLabel(`Tick #${one.id}`).click()
  await page.getByLabel(`Tick #${two.id}`).click()
  const bar = page.getByRole("toolbar", { name: "2 selected" })
  await bar.getByRole("button", { name: "Priority" }).click()
  await page.getByRole("menuitem", { name: "P0" }).click()
  await expect.poll(async () => [(await getItem(page, one.id)).priority, (await getItem(page, two.id)).priority]).toEqual(["P0", "P0"])

  await page.reload()
  await expect(row(page, one.id)).toContainText("P0")
  await expect(row(page, two.id)).toContainText("P0")
})

test("List: J and X tick rows from the keyboard, and 1 sets both", async ({ page }) => {
  const one = await itemByTitle(page, "Keys tick me")
  const two = await itemByTitle(page, "Keys tick me too")
  await page.goto("/todos?view=list&q=Keys%20tick&sort=id")
  await row(page, one.id).waitFor()
  await page.keyboard.press("j")
  await page.keyboard.press("x")
  await page.keyboard.press("j")
  await page.keyboard.press("x")
  await expect(page.getByRole("toolbar", { name: "2 selected" })).toBeVisible()
  await page.keyboard.press("1")
  await expect.poll(async () => [(await getItem(page, one.id)).priority, (await getItem(page, two.id)).priority]).toEqual(["P1", "P1"])
})

test("Triage: one key sets the priority and the next item shows; Z puts it back", async ({ page }) => {
  await page.goto("/todos?view=triage")
  const card = page.locator("[data-triage]")
  const first = Number(await card.getAttribute("data-triage"))
  const left = Number((await page.getByTestId("triage-left").textContent())!.match(/\d+/)![0])

  await page.keyboard.press("2")
  await expect(card).not.toHaveAttribute("data-triage", String(first))
  await expect(page.getByTestId("triage-left")).toContainText(`${left - 1} left`)
  await expect.poll(async () => (await getItem(page, first)).priority).toBe("P2")

  await page.keyboard.press("z")
  await expect(card).toHaveAttribute("data-triage", String(first))
  await expect.poll(async () => (await getItem(page, first)).priority).toBe(null)

  await page.keyboard.press("s")
  await expect(card).not.toHaveAttribute("data-triage", String(first))
  await expect(page.getByTestId("triage-left")).toContainText("1 skipped")
})

test("Triage: G picks a group for the item on screen", async ({ page }) => {
  await page.goto("/todos?view=triage&repo=demo-api")
  const card = page.locator("[data-triage]")
  const id = Number(await card.getAttribute("data-triage"))
  await page.keyboard.press("g")
  const picker = page.getByRole("dialog", { name: "Pick a group" })
  await picker.getByPlaceholder(/Groups in demo-api/).fill("Release")
  await page.keyboard.press("Enter")
  await expect(picker).toBeHidden()
  await expect(card).toContainText("Release prep")
  await expect.poll(async () => (await getItem(page, id)).group_name).toBe("Release prep")
})

test("Activity: an item added with atlas todo add shows with its author", async ({ page }) => {
  await atlas(page, "add", "Added from the CLI", "--repo", "demo-api")
  await page.goto("/todos?view=activity")
  const newest = page.locator("[data-event]").first()
  await expect(newest).toContainText("Added from the CLI")
  await expect(newest).toContainText("opencode created it")
  await expect(newest.getByRole("img", { name: "opencode" })).toBeVisible()
})

test("Overview: the counts match atlas todo list --all --json", async ({ page }) => {
  const items = JSON.parse(await atlas(page, "list", "--all", "--json")) as Item[]
  await page.goto("/todos?view=overview")
  for (const repo of new Set(items.map((i) => i.repo_name))) {
    const header = page.locator(`section[data-repo="${repo}"] header`)
    for (const status of ["todo", "doing"] as const) {
      const want = items.filter((i) => i.repo_name === repo && i.status === status).length
      await expect(header.locator(`[data-count="${status}"]`), `${repo} ${status}`).toHaveText(String(want))
    }
  }
})

test("? and the header button open the shortcuts; V then 2 opens the List", async ({ page }) => {
  await page.goto("/todos")
  await page.locator("[data-item]").first().waitFor()
  await page.keyboard.press("?")
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Triage")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")

  await page.keyboard.press("v")
  await page.keyboard.press("2")
  await expect(page).toHaveURL(/view=list/)
  await expect(page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "List" })).toHaveAttribute("aria-current", "page")
})

for (const view of ["list", "triage", "overview", "activity"]) {
  test(`${view} fits a phone screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/todos?view=${view}`)
    await page.locator("main").getByRole("button").first().waitFor()
    await page.waitForLoadState("networkidle")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    expect(await overflowing(page.locator("main"))).toEqual([])
  })
}
