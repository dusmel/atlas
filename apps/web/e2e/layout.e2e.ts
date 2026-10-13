import { expect, test } from "@playwright/test"
import { itemByTitle, login, openBoard, overflowing } from "./helpers"

for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test.describe(`at ${name} width`, () => {
    test.use({ viewport, isMobile: name === "phone", hasTouch: name === "phone" })

    test("no control in the panel or the new item dialog overflows", async ({ page }) => {
      await login(page)
      const item = await itemByTitle(page, "Ranking tweak one")
      // Selected Inbox is the widest priority button.
      await openBoard(page, `/todos?item=${item.id}`)
      const panel = page.getByRole("dialog", { name: item.title })
      await panel.getByRole("radio", { name: "Inbox" }).click()
      expect(await overflowing(panel)).toEqual([])
      await panel.getByRole("radio", { name: /^P2/ }).click()
      await page.keyboard.press("Escape")
      await page.keyboard.press("n")
      expect(await overflowing(page.getByRole("dialog", { name: "New item" }))).toEqual([])
    })
  })
}

test("an unknown page shows the 404, with three designs to compare", async ({ page }) => {
  await login(page)
  await page.goto("/no-such-page")
  await expect(page.getByRole("heading", { name: "Nothing here." })).toBeVisible()
  const designs = page.getByRole("navigation", { name: "404 design" })
  await designs.getByRole("link", { name: "B · Dots" }).click()
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible()
  await designs.getByRole("link", { name: "C · Screen" }).click()
  await expect(page.getByRole("heading", { name: "No signal." })).toBeVisible()
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/")
})
