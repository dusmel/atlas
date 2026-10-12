import { expect, test, type Page } from "@playwright/test"
import { api, login } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

const pill = (page: Page) => page.getByTestId("docs-pill")
const found = async (page: Page, q: string) => (await api<{ results: { path: string }[] }>(page, "GET", `/search?q=${q}`)).results.map((r) => r.path)

test("the pill says MEGA with the last pull, and Pull now asks MEGAcmd", async ({ page }) => {
  await page.goto("/docs")
  // e2e/serve.ts writes the report the megacmd loop would, with both pairs synced.
  await expect(pill(page)).toHaveAttribute("aria-label", "Docs: MEGA · pulled just now")
  await expect(pill(page)).toHaveAttribute("data-tone", "ok")
  await pill(page).click()
  const box = page.getByTestId("docs-source")
  await expect(box.getByRole("definition")).toHaveText(["Synced", "Synced"])
  await expect(box).toContainText("4 docs indexed")
  await box.getByRole("button", { name: "Pull now" }).click()
  await expect(page.getByText("Asked MEGA to pull")).toBeVisible()
  await expect(box.getByText("Waiting for MEGAcmd…")).toBeVisible()
  await expect(box.getByRole("button", { name: "Pull now" })).toBeDisabled()
})

test("holding serves the pushed copy, and resuming brings MEGA's back", async ({ page }) => {
  expect(await found(page, "albatross")).toEqual([])
  expect((await page.request.post("/api/docs/hold")).status()).toBe(403)

  expect(await api(page, "POST", "/docs/hold")).toMatchObject({ source: "manual", count: 5 })
  expect(await found(page, "albatross")).toEqual(["pushed/ferry-timetable.md"])
  expect((await (await page.request.get("/api/health")).json()).docs).toMatchObject({ source: "manual", count: 5 })
  await page.goto("/settings")
  await expect(pill(page)).toHaveAttribute("aria-label", "Docs: manual push · just now (MEGA paused)")
  await expect(page.getByTestId("docs-source")).toContainText("atlas push --resume-mega")
  await expect(page.getByTestId("docs-source").getByRole("button", { name: "Pull now" })).toHaveCount(0)

  expect(await api(page, "DELETE", "/docs/hold")).toMatchObject({ source: "mega", count: 4 })
  expect(await found(page, "albatross")).toEqual([])
  await page.reload()
  await expect(pill(page)).toHaveAttribute("aria-label", /^Docs: MEGA/)
})
