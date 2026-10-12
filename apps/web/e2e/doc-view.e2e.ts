import { expect, test } from "@playwright/test"
import { api, itemByTitle, login, openBoard } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

test("a markdown doc renders in the app, and relative links lead to an html doc whose scripts run sandboxed", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/r/web/notes/harbour.md")
  await expect(page.getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
  await expect(page).toHaveTitle("Harbour notes · Atlas")
  await expect(page.locator(".markdown.doc table")).toContainText("two hours")
  // The overview label links this doc to Onboarding, which has one open item.
  await expect(page.getByRole("link", { name: "1 open todo" })).toBeVisible()

  const html = page.waitForResponse((r) => r.url().endsWith("/r/web/plans/lighthouse.html"))
  await page.getByRole("link", { name: "the keeper's plan" }).click()
  expect((await html).headers()["content-security-policy"]).toBe("sandbox allow-scripts allow-popups")
  await expect(page.getByText("The keeper lights the lamp")).toBeVisible()
  await page.getByRole("button", { name: "Theme" }).click()
  await expect(page.locator("body")).toHaveClass("dark")
  await page.getByRole("button", { name: "Copy as Markdown" }).click()
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible()

  await page.getByRole("link", { name: "Harbour notes" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
})

test("a doc the served copy lacks says so, and every doc route needs a login", async ({ page, browser }) => {
  await page.goto("/r/web/notes/missing.md")
  await expect(page.getByText("No doc here")).toBeVisible()
  expect((await page.request.get("/r/web/plans%2f..%2f..%2fapi%2frunbook.html", { maxRedirects: 0 })).status()).toBe(404)

  const stranger = await browser.newContext()
  for (const path of ["/r/web/notes/harbour.md", "/r/web/plans/lighthouse.html", "/api/docs/view?repo=web&path=notes/harbour.md", "/shared"]) {
    const res = await stranger.request.get(path, { maxRedirects: 0 })
    expect([path, res.status()]).toEqual([path, path.startsWith("/api") ? 401 : 302])
  }
  await stranger.close()
})

test("make public, open the share logged out with scripts blocked, then revoke it to a 404", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/r/web/notes/harbour.md")
  await page.getByRole("button", { name: "Make public" }).click()
  await expect(page.getByText("Public link copied")).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy public link" })).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(/^http:\/\/localhost:\d+\/s\/[\w-]{24}$/)

  // The html plan goes public through the API, to check its scripts are blocked too.
  const htmlShare = await api<{ token: string }>(page, "POST", "/shares", { repo: "web", path: "plans/lighthouse.html" })

  const stranger = await browser.newContext()
  const reader = await stranger.newPage()
  const md = await reader.goto(link)
  expect(md!.headers()["content-security-policy"]).toBe("sandbox")
  await expect(reader.getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
  const html = await reader.goto(`/s/${htmlShare.token}`)
  expect(html!.headers()["content-security-policy"]).toBe("sandbox")
  await reader.getByRole("button", { name: "Theme" }).click()
  await expect(reader.locator("body")).not.toHaveClass("dark")

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shared" }).click()
  const rows = page.getByRole("list", { name: "Shared docs" }).locator("[data-share]")
  await expect(rows).toHaveCount(2)
  await rows.filter({ hasText: "web/notes/harbour.md" }).getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText("Link revoked")).toBeVisible()
  await expect(rows).toHaveCount(1)
  expect((await stranger.request.get(link)).status()).toBe(404)
  expect((await stranger.request.get(`/s/${htmlShare.token}`)).status()).toBe(200)
  await api(page, "DELETE", `/shares/${htmlShare.token}`)
  expect((await stranger.request.get(`/s/${htmlShare.token}`)).status()).toBe(404)
  await stranger.close()
})

test("the item panel lists every group doc, and relative links in a body open the doc view", async ({ page }) => {
  const item = await itemByTitle(page, "Synced with the CLI")
  await openBoard(page, `/todos?item=${item.id}`)
  const docs = page.getByRole("list", { name: "Group docs" })
  await expect(docs.locator("[data-doc]")).toHaveText([/^plan\s*plans\/lighthouse\.html$/, /^overview\s*notes\/harbour\.md$/])
  await expect(docs.getByRole("link", { name: "plans/lighthouse.html" })).toHaveAttribute("href", "/r/web/plans/lighthouse.html")

  // Triage reads the same folder from the docs summary.
  expect((await api<{ folders: Record<string, string> }>(page, "GET", "/docs")).folders).toEqual({ "github.com-demo-web": "web" })
  const own = await api<{ id: number }>(page, "POST", "/todos", { repo: "github.com-demo-web", title: "Body links a doc", priority: "P3", body: "See [the notes](atlas/notes/harbour.md)." })
  await openBoard(page, `/todos?item=${own.id}`)
  await page.getByRole("tab", { name: "Preview" }).click()
  await page.getByRole("link", { name: "the notes" }).click()
  await expect(page).toHaveURL(/\/r\/web\/notes\/harbour\.md$/)
  await expect(page.getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
})

test("a search result opens its doc", async ({ page }) => {
  await page.goto("/docs?q=tide")
  await page.getByRole("list", { name: "Results" }).getByRole("link", { name: "Harbour notes" }).click()
  await expect(page).toHaveURL(/\/r\/web\/notes\/harbour\.md$/)
})

test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("a doc and Shared fit without sideways scrolling, and the menu reaches Shared", async ({ page }) => {
    await page.goto("/r/web/notes/harbour.md")
    await expect(page.getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.getByRole("button", { name: "Menu: theme, pages and log out" }).click()
    await page.getByRole("menuitem", { name: "Shared" }).click()
    await expect(page).toHaveURL(/\/shared$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
