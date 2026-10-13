import { expect, test } from "@playwright/test"
import { login, openBoard } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

const results = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Results" }).locator("[data-result]")
const recent = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Recently changed docs" }).locator("[data-result]")
const sidebar = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Repos" })
const views = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Views" })

test("the header links to Docs, which counts the docs and skips backups", async ({ page }) => {
  await page.goto("/todos")
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" }).click()
  await expect(page).toHaveURL(/\/docs$/)
  await expect(page.getByTestId("docs-summary")).toHaveText("4 docs in 2 repos: 2 markdown, 2 html.")
  await expect(page.getByRole("searchbox", { name: "Search the docs" })).toBeFocused()
})

test("before anything is typed, the page lists the recently changed docs", async ({ page }) => {
  await page.goto("/docs")
  await expect(recent(page)).toHaveCount(3)
  await sidebar(page).getByRole("checkbox", { name: /^api/ }).check()
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
  const side = sidebar(page)
  await expect(results(page)).toHaveCount(2)
  await expect(side.getByRole("checkbox", { name: /^web/ }).locator("..")).toContainText("2")
  await side.getByRole("checkbox", { name: /^api/ }).check()
  await expect(page.getByText("No doc matches “lamp”")).toBeVisible()
  await expect(page).toHaveURL(/repo=api/)
  await side.getByRole("checkbox", { name: /^web/ }).check()
  await expect(results(page)).toHaveCount(2)
  await expect(page).toHaveURL(/repo=api(%2C|,)web/)
  await side.getByRole("button", { name: "Show all" }).click()
  await expect(side.getByRole("checkbox", { checked: true })).toHaveCount(0)
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
  expect((await (await page.request.get("/api/health")).json()).docs).toEqual({ source: "mega", last_pull: expect.any(String), count: 4 })
})

test("j and k select a result, Enter copies its path, and a result shows its tags, the groups that link it and their open todos", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/docs?q=lamp")
  await expect(results(page)).toHaveCount(2)
  // Escape leaves the box and keeps the query, which Chrome would otherwise clear.
  await page.getByRole("searchbox", { name: "Search the docs" }).press("Escape")
  await expect(page.getByRole("searchbox", { name: "Search the docs" })).toHaveValue("lamp")
  await page.keyboard.press("j")
  await expect(results(page).first()).toHaveAttribute("data-selected", "true")
  await page.keyboard.press("j")
  await page.keyboard.press("k")
  await expect(results(page).first()).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByText(/^Copied atlas\/plans\/lighthouse\.(md|html)$/)).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^atlas\/plans\/lighthouse\.(md|html)$/)

  // The Onboarding group links plans/lighthouse.html and has one open item; the md twin counts as the same doc.
  const lighthouse = page.locator(`[data-result$="plans/lighthouse.html"]`)
  await expect(lighthouse.locator("[data-group]")).toHaveText(["Group: Onboarding"])
  await expect(lighthouse.locator("[data-tags]")).toHaveText("Tags: plans, lamps")
  await results(page).first().getByRole("link", { name: "1 open todo" }).click()
  await expect(page).toHaveURL(/\/todos\?.*view=list/)
  await expect(page.getByText("Synced with the CLI")).toBeVisible()
})

test("Activity has a year grid and lists doc changes, and Overview has a card per repo and what needs attention", async ({ page }) => {
  await page.goto("/docs")
  await views(page).getByRole("link", { name: "Activity" }).click()
  await expect(page).toHaveURL(/view=activity/)
  // e2e/serve.ts edits the runbook once the first index is done.
  await expect(page.locator('[data-event="changed"]')).toHaveCount(1)
  await expect(page.locator('[data-event="changed"]')).toContainText("Ferry runbook")
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  // The year grid's last square is today.
  await expect(page.getByRole("img", { name: "1 doc change in the last year" })).toBeVisible()
  await expect(page.locator("[data-year-grid] rect").last()).toHaveAttribute("data-count", "1")
  await sidebar(page).getByRole("checkbox", { name: /^web/ }).check()
  await expect(page.getByText("No doc changes yet")).toBeVisible()
  await expect(page.getByRole("img", { name: "0 doc changes in the last year" })).toBeVisible()

  await views(page).getByRole("link", { name: "Overview" }).click()
  const cards = page.locator("section[data-repo]")
  await expect(cards).toHaveCount(1)
  const web = page.locator('[data-repo="web"]')
  // web holds the lighthouse plan as md and html, which count as one doc.
  await expect(web.locator('[data-count="docs"]')).toHaveText("2")
  await expect(web.getByRole("list", { name: "Changed this week" }).getByRole("link")).toHaveCount(2)
  // Onboarding links the plan and the harbour notes, with one open todo.
  await expect(web.getByRole("list", { name: "With open todos" }).getByRole("link", { name: /Lighthouse plan/ })).toBeVisible()
  const attention = page.getByRole("region", { name: /Needs attention/ })
  await expect(attention.locator('[data-attention="no-doc"]', { hasText: "Search quality" })).toContainText("and no doc")
  await expect(attention.locator('[data-attention="missing"]')).toHaveCount(0)
  await sidebar(page).getByRole("button", { name: "Show all" }).click()
  await expect(cards).toHaveCount(2)
  await web.getByRole("link", { name: "web", exact: true }).click()
  await expect(page).toHaveURL(/\/docs\?repo=web$/)
  await expect(recent(page)).toHaveCount(2)
})

test("⌘K finds a doc from Todos and opens the Docs search with it selected", async ({ page }) => {
  await openBoard(page, "/todos")
  await page.keyboard.press("ControlOrMeta+k")
  await page.getByRole("dialog").getByRole("combobox").fill("ferry engine")
  await page.getByRole("option", { name: /Ferry runbook/ }).click()
  await expect(page).toHaveURL(/\/docs\?.*q=ferry(\+|%20)engine/)
  await expect(results(page).first()).toHaveAttribute("data-selected", "true")
  await page.keyboard.press("ControlOrMeta+k")
  await page.getByRole("dialog").getByRole("combobox").fill("overview")
  await page.getByRole("option", { name: /^view Overview|Overview/ }).first().click()
  await expect(page).toHaveURL(/view=overview/)
})

test("docs fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/docs?q=lamp")
  await expect(results(page)).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(sidebar(page)).toBeHidden()
  await page.getByRole("button", { name: "Filters" }).click()
  await page.getByRole("dialog").getByRole("checkbox", { name: /^plans/ }).check()
  // The open drawer hides the page from the accessibility tree, so check the results once it closes.
  await page.keyboard.press("Escape")
  await expect(results(page)).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Remove Folder plans" })).toBeVisible()
})
