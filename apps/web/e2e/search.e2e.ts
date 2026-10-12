import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

const results = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Results" }).locator("[data-result]")

test("the header links to Search, which counts the docs and skips backups", async ({ page }) => {
  await page.goto("/todos")
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Search" }).click()
  await expect(page).toHaveURL(/\/search$/)
  await expect(page.getByTestId("docs-summary")).toHaveText("4 docs (2 markdown, 2 html) in 2 repos.")
  await expect(page.getByRole("searchbox", { name: "Search the docs" })).toBeFocused()
})

test("a phrase finds its doc once, with the matches marked, and the URL keeps the query", async ({ page }) => {
  await page.goto("/search")
  await page.getByRole("searchbox", { name: "Search the docs" }).fill("lights the lamp")
  await expect(results(page)).toHaveCount(1)
  await expect(results(page).first().getByRole("heading")).toHaveText("Lighthouse plan")
  await expect(results(page).first().locator("mark").first()).toHaveText("lights the lamp")
  await expect(page).toHaveURL(/q=lights(\+|%20)the(\+|%20)lamp/)
  await page.reload()
  await expect(results(page)).toHaveCount(1)
})

test("the repo filter narrows the results", async ({ page }) => {
  await page.goto("/search?q=lamp")
  await expect(results(page)).toHaveCount(2)
  await page.getByRole("combobox", { name: "Repo" }).click()
  await page.getByRole("option", { name: /^api/ }).click()
  await expect(page.getByText("No doc matches “lamp”")).toBeVisible()
  await expect(page).toHaveURL(/repo=api/)
})

test("html is indexed without its scripts, and its text shows as text", async ({ page }) => {
  await page.goto("/search?q=hidden")
  await expect(page.getByText("No doc matches “hidden”")).toBeVisible()
  await page.goto("/search?q=fuel")
  await expect(results(page).first().getByRole("heading")).toHaveText("Ferry runbook")
  await expect(results(page).first()).toContainText("<fuel>")
})

test("search syntax in the box is just text", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent('"lamp" (*:')}`)
  await expect(results(page)).toHaveCount(2)
  await page.goto(`/search?q=${encodeURIComponent("* : -")}`)
  await expect(page.getByText(/No doc matches/)).toBeVisible()
})

test("the API checks limit, reindexes, and health counts the docs", async ({ page }) => {
  const bad = await page.request.get("/api/search?q=lamp&limit=0")
  expect(bad.status()).toBe(400)
  expect((await bad.json()).error.code).toBe("bad_limit")
  const reindex = await page.request.post("/api/docs/reindex", { headers: { "x-atlas": "1" } })
  expect(await reindex.json()).toMatchObject({ docs: 4, md: 2, html: 2 })
  expect((await (await page.request.get("/api/health")).json()).docs).toEqual({ count: 4 })
})

test("search fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/search?q=lamp")
  await expect(results(page)).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
