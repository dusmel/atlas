import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

const results = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Results" }).locator("[data-result]")
const recent = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Recently changed docs" }).locator("[data-result]")

test("the header links to Docs, which counts the docs and skips backups", async ({ page }) => {
  await page.goto("/todos")
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" }).click()
  await expect(page).toHaveURL(/\/docs$/)
  await expect(page.getByTestId("docs-summary")).toHaveText("4 docs (2 markdown, 2 html) in 2 repos.")
  await expect(page.getByRole("searchbox", { name: "Search the docs" })).toBeFocused()
})

test("before anything is typed, the page lists the recently changed docs", async ({ page }) => {
  await page.goto("/docs")
  await expect(recent(page)).toHaveCount(3)
  await page.getByRole("complementary", { name: "Repos" }).getByRole("checkbox", { name: /^api/ }).check()
  await expect(recent(page)).toHaveCount(1)
  await expect(recent(page).first().getByRole("heading")).toHaveText("Ferry runbook")
})

test("a phrase finds its doc once, with the matches marked, and the URL keeps the query", async ({ page }) => {
  await page.goto("/docs")
  await page.getByRole("searchbox", { name: "Search the docs" }).fill("lights the lamp")
  await expect(results(page)).toHaveCount(1)
  await expect(results(page).first().getByRole("heading")).toHaveText("Lighthouse plan")
  await expect(results(page).first().locator("mark").first()).toHaveText("lights the lamp")
  await expect(page).toHaveURL(/q=lights(\+|%20)the(\+|%20)lamp/)
  await page.reload()
  await expect(results(page)).toHaveCount(1)
})

test("repos in the sidebar are checkboxes with match counts, and several can be picked", async ({ page }) => {
  await page.goto("/docs?q=lamp")
  const sidebar = page.getByRole("complementary", { name: "Repos" })
  await expect(results(page)).toHaveCount(2)
  await expect(sidebar.getByRole("checkbox", { name: /^web/ }).locator("..")).toContainText("2")
  await sidebar.getByRole("checkbox", { name: /^api/ }).check()
  await expect(page.getByText("No doc matches “lamp”")).toBeVisible()
  await expect(page).toHaveURL(/repo=api/)
  await sidebar.getByRole("checkbox", { name: /^web/ }).check()
  await expect(results(page)).toHaveCount(2)
  await expect(page).toHaveURL(/repo=api(%2C|,)web/)
  await sidebar.getByRole("button", { name: "All" }).click()
  await expect(sidebar.getByRole("checkbox", { checked: true })).toHaveCount(0)
})

test("the folder and changed filters narrow the results and show as badges", async ({ page }) => {
  await page.goto("/docs?q=lamp")
  await page.getByRole("button", { name: "Folder" }).click()
  await page.getByRole("option", { name: /plans/ }).click()
  await page.keyboard.press("Escape")
  await expect(results(page)).toHaveCount(1)
  await expect(results(page).first().getByRole("heading")).toHaveText("Lighthouse plan")
  await page.getByRole("button", { name: "Remove Folder plans" }).click()
  await expect(results(page)).toHaveCount(2)

  await page.getByRole("button", { name: "Changed" }).click()
  await page.getByRole("button", { name: "Day" }).click()
  await page.keyboard.press("Escape")
  // harbour.md was saved three days ago.
  await expect(results(page)).toHaveCount(1)
  await expect(page).toHaveURL(/since=1d/)
  await expect(page.getByText("1 doc matches")).toBeVisible()
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(results(page)).toHaveCount(2)
})

test("html is indexed without its scripts, and its text shows as text", async ({ page }) => {
  await page.goto("/docs?q=hidden")
  await expect(page.getByText("No doc matches “hidden”")).toBeVisible()
  await page.goto("/docs?q=fuel")
  await expect(results(page).first().getByRole("heading")).toHaveText("Ferry runbook")
  await expect(results(page).first()).toContainText("<fuel>")
})

test("search syntax in the box is just text", async ({ page }) => {
  await page.goto(`/docs?q=${encodeURIComponent('"lamp" (*:')}`)
  await expect(results(page)).toHaveCount(2)
  await page.goto(`/docs?q=${encodeURIComponent("* : -")}`)
  await expect(page.getByText(/No doc matches/)).toBeVisible()
})

test("the API checks limit, reindexes, and health counts the docs", async ({ page }) => {
  const bad = await page.request.get("/api/search?q=lamp&limit=0")
  expect(bad.status()).toBe(400)
  expect((await bad.json()).error.code).toBe("bad_limit")
  expect((await (await page.request.get("/api/search?q=lamp&since=soon")).json()).error.code).toBe("bad_since")
  expect((await (await page.request.get("/api/search?q=lamp&folder=plans")).json()).facets).toEqual({ total: 1, repo: { web: 1 }, folder: { plans: 1, notes: 1 } })
  const reindex = await page.request.post("/api/docs/reindex", { headers: { "x-atlas": "1" } })
  expect(await reindex.json()).toMatchObject({ docs: 4, md: 2, html: 2 })
  expect((await (await page.request.get("/api/health")).json()).docs).toEqual({ count: 4 })
})

test("docs fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/docs?q=lamp")
  await expect(results(page)).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(page.getByRole("complementary", { name: "Repos" })).toBeHidden()
  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("dialog").getByRole("checkbox", { name: /^plans/ }).check()
  // The open drawer hides the page from the accessibility tree, so check the results once it closes.
  await page.keyboard.press("Escape")
  await expect(results(page)).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Remove Folder plans" })).toBeVisible()
})
