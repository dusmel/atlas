import { expect, test } from "@playwright/test"
import { login, openBoard } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

const results = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Results" }).locator("[data-result]")
const recent = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Recently changed docs" }).locator("[data-result]")
const sidebar = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: "Filters" })
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
  expect((await (await page.request.get("/api/search?q=lamp&folder=plans")).json()).facets).toEqual({ total: 1, repo: { web: 1 }, folder: { plans: 1, notes: 1 }, type: { plan: 1 }, tag: { plans: 1, lamps: 1 } })
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
  await expect(lighthouse.getByRole("link", { name: "Group: Onboarding" })).toHaveAttribute("href", /\/todos\?view=list&group=\d+$/)
  await expect(lighthouse.getByRole("list", { name: "Tags" }).getByRole("listitem")).toHaveText(["plans", "lamps"])
  await results(page).first().getByRole("link", { name: "1 open todo" }).click()
  await expect(page).toHaveURL(/\/todos\?.*view=list/)
  await expect(page.getByText("Synced with the CLI")).toBeVisible()
})

test("Activity has a year grid and lists doc changes, and Overview has totals, a row per repo and what needs attention", async ({ page }) => {
  await page.goto("/docs")
  await views(page).getByRole("link", { name: "Activity" }).click()
  await expect(page).toHaveURL(/view=activity/)
  // e2e/serve.ts edits the runbook once the first index is done.
  await expect(page.locator('[data-event="changed"]')).toHaveCount(1)
  await expect(page.locator('[data-event="changed"]')).toContainText("Ferry runbook")
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  // The year grid's last square is today. docs-source.e2e.ts logs changes too, so the count depends on what ran first.
  await expect(page.getByRole("img", { name: /^\d+ doc changes? in the last year$/ })).toBeVisible()
  await expect(page.locator("[data-year-grid] rect").last()).not.toHaveAttribute("data-count", "0")
  await sidebar(page).getByRole("checkbox", { name: /^web/ }).check()
  await expect(page.getByText("No doc changes yet")).toBeVisible()
  await expect(page.getByRole("img", { name: "0 doc changes in the last year" })).toBeVisible()

  await views(page).getByRole("link", { name: "Overview" }).click()
  const cards = page.getByRole("region", { name: "Docs per repo" }).locator("[data-repo]")
  await expect(cards).toHaveCount(1)
  const web = page.locator('[data-repo="web"]')
  // web holds the lighthouse plan as md and html, which count as one doc.
  await expect(web.locator('[data-count="docs"]')).toHaveText("2")
  await expect(page.locator("dl[aria-label=Totals]")).toContainText("Docs2")
  await expect(page.getByRole("link", { name: "Open: Changed this week" })).toHaveAttribute("href", "/docs?since=1w")
  await expect(page.getByRole("list", { name: "Changed this week" }).getByRole("link")).toHaveCount(2)
  // Onboarding links the plan and the harbour notes, with one open todo.
  await expect(page.getByRole("list", { name: "With open todos" }).getByRole("link", { name: /Lighthouse plan/ })).toBeVisible()
  const attention = page.getByRole("region", { name: /Needs attention/ })
  await expect(attention.locator('[data-attention="no-doc"]', { hasText: "Search quality" })).toContainText("and no doc")
  await expect(attention.locator('[data-attention="missing"]')).toHaveCount(0)
  // Report and Trends are one click from Cards, the default.
  const designs = page.getByRole("navigation", { name: "Overview design" })
  await designs.getByRole("link", { name: "Trends" }).click()
  await expect(page).toHaveURL(/design=trends/)
  await expect(designs.getByRole("link", { name: "Trends" })).toHaveAttribute("aria-current", "page")
  await expect(designs.getByRole("link", { name: "Cards" })).not.toHaveAttribute("aria-current")
  await designs.getByRole("link", { name: "Cards" }).click()
  await expect(page).not.toHaveURL(/design=/)
  await sidebar(page).getByRole("button", { name: "Show all" }).click()
  await expect(cards).toHaveCount(2)
  await web.getByRole("link", { name: "web", exact: true }).click()
  await expect(page).toHaveURL(/\/docs\?repo=web$/)
  await expect(recent(page)).toHaveCount(2)
})

test("type and tag filters narrow Search, Overview and Folders, and stay in the URL", async ({ page }) => {
  await page.goto("/docs")
  const side = sidebar(page)
  await expect(recent(page)).toHaveCount(3)
  // The lighthouse plan is md and html, which count as one doc.
  await expect(side.getByRole("checkbox", { name: "plan", exact: true }).locator("..")).toContainText("1")
  await side.getByRole("checkbox", { name: "reference", exact: true }).check()
  await expect(page).toHaveURL(/type=reference/)
  await expect(recent(page)).toHaveCount(1)
  await expect(recent(page).first().getByRole("heading")).toHaveText("Ferry runbook")
  // Several types match any of them.
  await side.getByRole("checkbox", { name: "No type" }).check()
  await expect(recent(page)).toHaveCount(2)
  // A tag must match as well.
  await side.getByRole("checkbox", { name: "ops", exact: true }).check()
  await expect(page).toHaveURL(/tag=ops/)
  await expect(recent(page)).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Remove Type No type" })).toBeVisible()

  await views(page).getByRole("link", { name: "Overview" }).click()
  await expect(page.locator("dl[aria-label=Totals]")).toContainText("Docs1")
  await views(page).getByRole("link", { name: "Folders" }).click()
  await expect(page.locator("[data-row]")).toHaveText([/^api/])
  await page.getByRole("button", { name: "Remove Tag ops" }).click()
  await page.getByRole("button", { name: "Remove Type reference" }).click()
  // Only the harbour notes have no type.
  await expect(page.locator("[data-row]")).toHaveText([/^web/])
})

test("Folders browses from the repos to a doc, and the path and Backspace lead back", async ({ page }) => {
  await page.goto("/docs")
  await views(page).getByRole("link", { name: "Folders" }).click()
  await expect(page).toHaveURL(/view=folders/)
  const rows = page.locator("[data-row]")
  // docs-source.e2e.ts can push a doc into api, so only web's count is fixed.
  await expect(rows.filter({ hasText: /^web/ })).toContainText("2 docs")
  await rows.filter({ hasText: /^web/ }).getByRole("link").click()
  await expect(page).toHaveURL(/path=web$/)
  // Subfolders first, by name; meta.json and the svg are not docs.
  await expect(rows).toHaveText([/^notes1 doc/, /^plans1 doc/])
  await page.keyboard.press("j")
  await page.keyboard.press("j")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/path=web(%2F|\/)plans$/)
  await expect(page.getByRole("navigation", { name: "Folder path" })).toHaveText("All repos/web/plans")
  // A doc kept as md and html shows once, as the html, with its type and tags.
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText("Lighthouse plan")
  await expect(rows.first()).toContainText("plan")
  await expect(rows.first().getByRole("list", { name: "Tags" })).toHaveText("planslamps")
  await page.keyboard.press("Backspace")
  await expect(page).toHaveURL(/path=web$/)
  await expect(rows.filter({ hasText: /^plans/ })).toHaveAttribute("aria-current", "true")
  await page.keyboard.press("Enter")
  await page.keyboard.press("j")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/r\/web\/plans\/lighthouse\.html$/)
  await page.goBack()
  await page.getByRole("navigation", { name: "Folder path" }).getByRole("link", { name: "All repos" }).click()
  await expect(page).not.toHaveURL(/path=/)
  await expect(rows.filter({ hasText: /^web/ })).toBeVisible()
})

test("⌘K opens a doc it finds, from Todos and from Docs", async ({ page }) => {
  await openBoard(page, "/todos")
  await page.keyboard.press("ControlOrMeta+k")
  await page.getByRole("dialog").getByRole("combobox").fill("ferry engine")
  await page.getByRole("option", { name: /Ferry runbook/ }).press("Enter")
  await expect(page).toHaveURL(/\/r\/api\/runbook\.html$/)
  await page.goto("/docs")
  await page.keyboard.press("ControlOrMeta+k")
  await page.getByRole("dialog").getByRole("combobox").fill("ferry engine")
  await expect(page.getByRole("option", { name: /Ferry runbook/ })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("dialog").getByRole("combobox").press("Enter")
  await expect(page).toHaveURL(/\/r\/api\/runbook\.html$/)
  await page.goto("/docs")
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
  // "plans" is a folder and a tag here; CheckList ids each box by its list.
  await page.getByRole("dialog").locator("#folder-plans").check()
  // The open drawer hides the page from the accessibility tree, so check the results once it closes.
  await page.keyboard.press("Escape")
  await expect(results(page)).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Remove Folder plans" })).toBeVisible()
})
