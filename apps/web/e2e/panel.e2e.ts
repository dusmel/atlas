import { expect, test } from "@playwright/test"
import { card, itemByTitle, login, openBoard } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

test("dragging the panel's edge widens it, and the width stays after a reload", async ({ page }) => {
  const item = await itemByTitle(page, "Press one on me")
  await openBoard(page, `/todos?item=${item.id}`)
  const panel = page.getByRole("dialog")
  const handle = page.getByRole("separator", { name: "Resize the panel" })
  // The panel slides in, so measure it once it has stopped.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"))
  const before = (await panel.boundingBox())!.width
  const h = (await handle.boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + 200)
  await page.mouse.down()
  await page.mouse.move(h.x - 200, h.y + 200, { steps: 10 })
  await page.mouse.up()
  const wider = (await panel.boundingBox())!.width
  expect(wider).toBeGreaterThan(before + 150)

  await page.reload()
  await expect(panel).toBeVisible()
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(wider))

  // From the keyboard: arrows resize, and a double click resets.
  await handle.focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(wider) - 32)
  await handle.dblclick()
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(576)
})

test("the panel copies the item's id and a link to it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const item = await itemByTitle(page, "Press one on me")
  await openBoard(page)
  await card(page, item.id).click()
  const panel = page.getByRole("dialog")
  const id = panel.getByRole("button", { name: `Copy #${item.id}` })
  const link = panel.getByRole("button", { name: `Copy a link to #${item.id}` })
  await expect(id).toHaveCSS("text-decoration-line", "underline")
  await expect(id).toHaveCSS("cursor", "pointer")
  await expect(link).toHaveCSS("cursor", "pointer")
  await id.click()
  await expect(page.getByText(`Copied #${item.id}`)).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`#${item.id}`)
  await link.click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/todos?item=${item.id}`)
})

test("the Changed filter keeps items changed in the window, from a preset or typed", async ({ page }) => {
  await page.goto("/todos?view=list&q=three%20days")
  const old = page.getByText("Finished three days ago")
  await expect(old).toBeVisible()

  await page.locator("button[aria-haspopup=dialog]", { hasText: "Changed" }).click()
  await page.getByRole("button", { name: "Day", exact: true }).click()
  await expect(page).toHaveURL(/since=1d/)
  await expect(old).toBeHidden()

  await page.getByLabel(/Changed in the last, as/).fill("1w")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(/since=1w/)
  await expect(old).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByText("in the last week")).toBeVisible()

  await page.getByRole("button", { name: "Remove Changed filter" }).click()
  await expect(page).not.toHaveURL(/since=/)
  await page.goto("/todos?view=overview&since=2d")
  await expect(page.getByRole("link", { name: /Done in the last 2 days/ })).toBeVisible()
})
