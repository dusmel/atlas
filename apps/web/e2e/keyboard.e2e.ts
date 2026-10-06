import { expect, test } from "@playwright/test"
import { card, cell, getItem, idsIn, itemByTitle, login, openBoard } from "./helpers"

test.beforeEach(async ({ page }) => {
  await login(page)
})

test("the palette jumps to an item by number", async ({ page }) => {
  const item = await itemByTitle(page, "Jump here by number")
  await openBoard(page, "/todos")
  await page.keyboard.press("ControlOrMeta+k")
  await page.keyboard.type(String(item.id))
  await expect(page.getByRole("option", { name: new RegExp(`^#${item.id} Jump here by number`) })).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: item.title })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`item=${item.id}`))
})

test("j and k move the selection, Enter opens it", async ({ page }) => {
  await openBoard(page, "/todos?q=Ranking tweak")
  const lane = cell(page, "P2:todo")
  await expect.poll(() => idsIn(lane)).toHaveLength(2)
  const [first, second] = (await idsIn(lane)) as [number, number]
  await page.keyboard.press("j")
  await page.keyboard.press("j")
  await expect(card(page, second)).toBeFocused()
  await page.keyboard.press("k")
  await expect(card(page, first)).toBeFocused()
  await page.keyboard.press("Enter")
  const opened = await getItem(page, first)
  await expect(page.getByRole("dialog", { name: opened.title })).toBeVisible()
})

test("pressing 1 sets the selected card to P1", async ({ page }) => {
  const item = await itemByTitle(page, "Press one on me")
  await openBoard(page, "/todos?q=Press one on me")
  await page.keyboard.press("j")
  await page.keyboard.press("1")
  await expect(cell(page, "P1:todo").locator(`[data-item="${item.id}"]`)).toBeVisible()
  await expect.poll(async () => (await getItem(page, item.id)).priority).toBe("P1")
})

test("the filter search finds a group and filters the board to it", async ({ page }) => {
  await openBoard(page, "/todos")
  await page.keyboard.press("f")
  await page.keyboard.type("Search quality")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(/\?repo=demo-api&group=\d+$/)
  const titles = await page.locator("[data-item]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace(/^#\d+ /, "")))
  expect(titles.sort()).toEqual(["Ranking tweak one", "Ranking tweak two"])
})

test("a picked repo narrows the group list, and a picked group brings its repo", async ({ page }) => {
  await openBoard(page, "/todos?repo=demo-web")
  await page.getByRole("button", { name: "Group" }).click()
  const list = page.getByRole("listbox")
  await expect(list.getByRole("option", { name: /Onboarding/ })).toBeVisible()
  await expect(list.getByRole("option", { name: /Search quality/ })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await openBoard(page, "/todos")
  await page.getByRole("button", { name: "Group" }).click()
  await page.getByRole("option", { name: /Search quality/ }).click()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(/repo=demo-api/)

  // Dropping the repo drops its groups with it.
  await page.getByRole("button", { name: /Remove Repo demo-api/ }).click()
  await expect(page).not.toHaveURL(/group=/)
})
