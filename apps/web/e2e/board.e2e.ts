import { expect, test } from "@playwright/test"
import { card, cell, drag, getItem, idsIn, itemByTitle, login, openBoard } from "./helpers"

// Tall enough for the whole seeded board, so no drop target sits under the sticky headers.
test.use({ viewport: { width: 1280, height: 1600 } })

test.beforeEach(async ({ page }) => {
  await login(page)
})

test("dragging a card to another lane and row persists", async ({ page }) => {
  const item = await itemByTitle(page, "Drag me to P1 doing")
  await openBoard(page, "/todos")
  await drag(page, card(page, item.id), cell(page, "P1:doing"))
  await expect(cell(page, "P1:doing").locator(`[data-item="${item.id}"]`)).toBeVisible()
  await expect.poll(async () => (await getItem(page, item.id)).status).toBe("doing")
  await page.reload()
  await expect(cell(page, "P1:doing").locator(`[data-item="${item.id}"]`)).toBeVisible()
  expect(await getItem(page, item.id)).toMatchObject({ priority: "P1", status: "doing" })
})

test("reordering within a lane persists", async ({ page }) => {
  const order = await Promise.all(["Order A", "Order B", "Order C"].map((t) => itemByTitle(page, t)))
  const [a, b, c] = order.map((i) => i.id) as [number, number, number]
  await openBoard(page, "/todos?q=Order")
  const lane = cell(page, "P3:todo")
  await expect.poll(() => idsIn(lane)).toEqual([a, b, c])
  await drag(page, card(page, c), card(page, a), "top")
  await expect.poll(() => idsIn(lane)).toEqual([c, a, b])
  await page.reload()
  await expect.poll(() => idsIn(lane)).toEqual([c, a, b])
})

test("adding an item puts it in Inbox", async ({ page }) => {
  await openBoard(page, "/todos")
  await page.keyboard.press("n")
  await page.getByRole("dialog", { name: "New item" }).getByLabel("Title").fill("A brand new idea")
  await page.keyboard.press("Enter")
  await expect(page.getByText(/^Added #\d+$/)).toBeVisible()
  const added = await itemByTitle(page, "A brand new idea")
  expect(added).toMatchObject({ priority: null, status: "todo" })
})

test("editing the body saves it", async ({ page }) => {
  const item = await itemByTitle(page, "Body gets edited")
  await openBoard(page, `/todos?item=${item.id}`)
  const panel = page.getByRole("dialog", { name: item.title })
  await panel.getByRole("tab", { name: "Write" }).click()
  await panel.getByRole("textbox", { name: "Body" }).fill("Steps:\n\n- check the **logs**")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect(panel.getByRole("button", { name: /^Save/ })).toBeHidden()
  await expect.poll(async () => (await getItem(page, item.id)).body).toBe("Steps:\n\n- check the **logs**")
  await page.reload()
  await expect(page.getByRole("dialog", { name: item.title }).locator(".markdown strong")).toHaveText("logs")
})

test("archiving hides the card and Undo brings it back", async ({ page }) => {
  const item = await itemByTitle(page, "Archive then undo")
  await openBoard(page, "/todos?q=Archive then undo")
  await expect(card(page, item.id)).toBeVisible()
  await page.keyboard.press("j")
  await page.keyboard.press("a")
  await expect(card(page, item.id)).toBeHidden()
  await expect.poll(async () => (await getItem(page, item.id)).archived_at).not.toBeNull()
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(card(page, item.id)).toBeVisible()
  await page.reload()
  await expect(card(page, item.id)).toBeVisible()
  expect((await getItem(page, item.id)).archived_at).toBeNull()
})

test("saving over a change made in another tab gives a 409 and keeps the text", async ({ page, context }) => {
  const item = await itemByTitle(page, "Two tabs edit this")
  const other = await context.newPage()
  for (const p of [page, other]) {
    await openBoard(p, `/todos?item=${item.id}`)
    await p.getByRole("dialog", { name: item.title }).getByRole("tab", { name: "Write" }).click()
  }
  // The second tab starts its draft before the first one saves, so it still holds the old version.
  await other.getByRole("textbox", { name: "Body" }).fill("from the second tab")
  await page.getByRole("textbox", { name: "Body" }).fill("from the first tab")
  await page.keyboard.press("ControlOrMeta+Enter")
  await expect.poll(async () => (await getItem(page, item.id)).body).toBe("from the first tab")
  await other.bringToFront()
  await other.getByRole("textbox", { name: "Body" }).press("ControlOrMeta+Enter")
  await expect(other.getByText(`#${item.id} changed somewhere else`)).toBeVisible()
  await expect(other.getByRole("textbox", { name: "Body" })).toHaveValue("from the second tab")
  expect((await getItem(page, item.id)).body).toBe("from the first tab")
})
