import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test.beforeEach(async ({ page }) => login(page))

const loader = '[data-doc-loading]'

test("the frame asks for the doc before the doc's details arrive, and a loader covers it until the doc paints", async ({ page }) => {
  let releaseView!: () => void
  const viewHeld = new Promise<void>((done) => (releaseView = done))
  await page.route(/\/api\/docs\/view\?/, async (route) => {
    await viewHeld
    await route.continue()
  })
  let releaseRaw!: () => void
  const rawHeld = new Promise<void>((done) => (releaseRaw = done))
  await page.route(/\/raw\/web\/plans\/lighthouse\.html/, async (route) => {
    await rawHeld
    await route.continue()
  })
  const rawAsked = page.waitForRequest((r) => new URL(r.url()).pathname === "/raw/web/plans/lighthouse.html")

  await page.goto("/r/web/plans/lighthouse.html")
  await rawAsked
  await expect(page.locator(loader)).toBeVisible()
  releaseRaw()
  // The paint comes from the doc itself, so the loader leaves while the details are still on their way.
  await expect(page.locator(loader)).toHaveCount(0)
  await expect(page.frameLocator("iframe").getByText("The keeper lights the lamp")).toBeVisible()
  releaseView()
  await expect(page.locator('iframe[title="Lighthouse plan"]')).toBeAttached()
  await expect(page.getByRole("link", { name: "Open raw" })).toBeVisible()
})

test("a doc that never says it painted still shows, after five seconds", async ({ page }) => {
  await page.route(/\/raw\/web\/plans\/lighthouse\.html/, (route) => route.fulfill({ contentType: "text/html", body: "<h1>No bridge here</h1>" }))
  await page.goto("/r/web/plans/lighthouse.html")
  await expect(page.locator(loader)).toBeVisible()
  await expect(page.locator(loader)).toHaveCount(0, { timeout: 8000 })
  await expect(page.frameLocator("iframe").getByText("No bridge here")).toBeVisible()
})

test("/raw sends an ETag and answers 304 when the browser holds that version", async ({ page }) => {
  for (const path of ["web/plans/lighthouse.html", "web/notes/harbour.md"]) {
    const first = await page.request.get(`/raw/${path}`)
    const etag = first.headers()["etag"]!
    expect(etag, path).toMatch(/^"[^"]+"$/)
    expect(first.headers()["cache-control"]).toBe("private, no-cache")
    expect(first.headers()["last-modified"]).toBeTruthy()
    const again = await page.request.get(`/raw/${path}`, { headers: { "if-none-match": etag } })
    expect(again.status(), path).toBe(304)
    // Traefik's compression makes the tag weak on its way back.
    expect((await page.request.get(`/raw/${path}`, { headers: { "if-none-match": `W/${etag}` } })).status()).toBe(304)
    expect((await page.request.get(`/raw/${path}`, { headers: { "if-none-match": '"other"' } })).status()).toBe(200)
  }
})

test("the toolbar says when the doc was updated, to the minute", async ({ page }) => {
  // harbour.md was saved three days ago, so it shows a date and a time.
  await page.goto("/r/web/notes/harbour.md")
  await expect(page.getByText(/^Updated \d{1,2} [A-Z][a-z]{2}( \d{4})?, \d{2}:\d{2}$/)).toBeVisible()
})
