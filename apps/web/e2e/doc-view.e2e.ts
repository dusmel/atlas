import { expect, test } from "@playwright/test"
import { api, docFrame, getItem, itemByTitle, login, openBoard } from "./helpers"
import { HARBOUR_TODO, RENAMED } from "./seed"

test.beforeEach(async ({ page }) => login(page))

test("a markdown doc opens in the frame, and its links move the page to an html doc whose scripts run sandboxed", async ({ page }) => {
  await page.goto("/r/web/notes/harbour.md")
  const doc = await docFrame(page, "Harbour notes")
  await expect(doc.getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
  await expect(page).toHaveTitle("Harbour notes · Atlas")
  await expect(doc.locator("table")).toContainText("two hours")
  // The overview label links this doc to Onboarding, which has one open item.
  await expect(page.getByRole("link", { name: "1 open todo" })).toBeVisible()

  const raw = page.waitForResponse((r) => new URL(r.url()).pathname === "/raw/web/plans/lighthouse.html")
  await doc.getByRole("link", { name: "the keeper's plan" }).click()
  await expect(page).toHaveURL(/\/r\/web\/plans\/lighthouse\.html$/)
  expect((await raw).headers()["content-security-policy"]).toBe("sandbox allow-scripts allow-popups; frame-ancestors 'self'")
  const plan = await docFrame(page, "Lighthouse plan")
  await expect(plan.getByText("The keeper lights the lamp")).toBeVisible()
  // The doc's own top bar is hidden: the toolbar does its job.
  await expect(plan.getByText("Old top bar")).toBeHidden()
  // Its theme script reads localStorage before anything else, which throws in the sandbox unless the bridge stands in.
  await plan.getByRole("button", { name: "Theme" }).click()
  await expect(plan.locator("body")).toHaveClass(/dark/)

  await page.goBack()
  await expect(page).toHaveURL(/\/r\/web\/notes\/harbour\.md$/)
  await expect(page.frameLocator('iframe[title="Harbour notes"]').getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
})

test("over an html doc, ⌘K opens the palette, an index link opens Docs for the repo, and anchors stay in the doc", async ({ page }) => {
  await page.goto("/r/web/plans/lighthouse.html")
  let plan = await docFrame(page, "Lighthouse plan")
  await plan.getByRole("link", { name: "Jump to the log" }).click()
  await expect(page).toHaveURL(/\/r\/web\/plans\/lighthouse\.html#log$/)
  await expect(plan.getByRole("heading", { name: "Log" })).toBeInViewport()

  await plan.locator("body").press("ControlOrMeta+k")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await expect(palette).toBeVisible()
  await palette.getByRole("combobox").fill("tide")
  await palette.getByRole("option", { name: /Harbour notes/ }).click()
  await expect(page).toHaveURL(/\/r\/web\/notes\/harbour\.md$/)

  await page.goto("/r/web/plans/lighthouse.html")
  plan = await docFrame(page, "Lighthouse plan")
  await plan.getByRole("link", { name: "All web docs" }).click()
  await expect(page).toHaveURL(/\/docs\?repo=web$/)

  // A file that is not a doc, such as a screenshot, opens as itself.
  await page.goto("/r/web/plans/lighthouse.html")
  plan = await docFrame(page, "Lighthouse plan")
  await plan.getByRole("link", { name: "Lamp sketch" }).click()
  await expect(page).toHaveURL(/\/r\/web\/plans\/lamp\.svg$/)
  await expect(page.locator("circle")).toBeVisible()
})

test("⌘K on a doc acts on it, and ⌘K on Shared, Settings and Todos goes to the other pages", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/r/web/notes/harbour.md")
  await docFrame(page, "Harbour notes")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await page.keyboard.press("ControlOrMeta+k")
  await palette.getByRole("option", { name: "Copy as Markdown" }).click()
  await expect(page.getByText("Markdown copied")).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Ships wait outside the harbour")

  await page.keyboard.press("ControlOrMeta+k")
  await palette.getByRole("option", { name: "Make public" }).click()
  await expect(page.getByText("Public link copied")).toBeVisible()
  await page.keyboard.press("ControlOrMeta+k")
  await expect(palette.getByRole("option", { name: "Copy public link" })).toBeVisible()
  await page.keyboard.press("Escape")
  const { shares } = await api<{ shares: { token: string; path: string }[] }>(page, "GET", "/shares")
  await api(page, "DELETE", `/shares/${shares.find((s) => s.path === "notes/harbour.md")!.token}`)

  await page.goto("/shared")
  // The first press can land before the page hydrates.
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(palette.getByRole("option", { name: "Go to Shared" })).toHaveCount(0)
  await palette.getByRole("combobox").fill("keeper")
  await palette.getByRole("option", { name: /Lighthouse plan/ }).click()
  await expect(page).toHaveURL(/\/r\/web\/plans\/lighthouse\.html$/)

  // Every page's ⌘K reaches the others.
  await page.goto("/settings")
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1000 })
  }).toPass()
  await palette.getByRole("option", { name: "Go to Todos" }).click()
  await expect(page).toHaveURL(/\/todos/)
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1000 })
  }).toPass()
  await palette.getByRole("option", { name: "Go to Docs" }).click()
  await expect(page).toHaveURL(/\/docs/)
})

test("a diagram zooms on click and closes on Escape, and the toolbar copies the markdown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/r/web/plans/lighthouse.html")
  const plan = await docFrame(page, "Lighthouse plan")
  await plan.getByText("The lamp room").click()
  const zoom = plan.getByRole("dialog", { name: /Diagram, zoomed/ })
  await expect(zoom).toBeVisible()
  await zoom.press("Escape")
  await expect(zoom).toBeHidden()

  await page.getByRole("button", { name: "Copy as Markdown" }).click()
  await expect(page.getByText("Markdown copied")).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("The keeper lights the lamp at dusk")
  // The frame follows the app theme.
  await page.getByRole("button", { name: "Menu: theme, pages and log out" }).click()
  await page.getByRole("menuitemradio", { name: "Dark" }).click()
  await expect(plan.locator("html")).toHaveClass(/dark/)
})

test("a doc the served copy lacks gets the map 404 with the closest paths, and every doc route needs a login", async ({ page, browser }) => {
  await page.goto("/r/web/plans/lighthose.html")
  await expect(page.getByRole("heading", { name: "This doc drifted off the map" })).toBeVisible()
  const closest = page.getByRole("region", { name: "Closest paths" }).getByRole("link")
  await expect(closest).toHaveCount(3)
  await expect(closest.first()).toHaveAttribute("href", "/r/web/plans/lighthouse.html")
  await page.keyboard.press("ControlOrMeta+k")
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("textbox", { name: "Search the docs" })).toHaveValue("lighthose")
  await page.getByRole("button", { name: "Search", exact: true }).click()
  await expect(page).toHaveURL(/\/docs\?q=lighthose$/)
  // The plan is kept as both md and html, and the html is the doc, whether the server or the app is asked.
  await page.goto("/r/web/plans/lighthouse.md")
  await expect(page).toHaveURL(/\/r\/web\/plans\/lighthouse\.html$/)
  expect((await page.request.get("/r/web/plans%2f..%2f..%2fapi%2frunbook.png", { maxRedirects: 0 })).status()).toBe(404)
  expect((await page.request.get("/api/docs/view?repo=web&path=plans/../../api/runbook.html")).status()).toBe(404)
  expect((await page.request.get("/raw/web/plans%2f..%2f..%2fapi%2frunbook.html", { maxRedirects: 0 })).status()).toBe(404)
  const md = await page.request.get("/raw/web/plans/lighthouse.html?format=md")
  expect([md.status(), md.headers()["content-type"]]).toEqual([200, "text/markdown; charset=utf-8"])

  const stranger = await browser.newContext()
  for (const path of ["/r/web/notes/harbour.md", "/r/web/plans/lighthouse.html", "/raw/web/plans/lighthouse.html", "/api/docs/view?repo=web&path=notes/harbour.md", "/shared"]) {
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
  // A share names no other doc: its top bar, metadata and Related are hidden, and links within the site reach the share 404.
  await expect(reader.getByText("Old top bar")).toBeHidden()
  await expect(reader.getByText("Metadata")).toBeHidden()
  await expect(reader.getByText("Tide notes")).toBeHidden()
  await expect(reader.getByRole("link", { name: "Jump to the log" })).toHaveAttribute("href", "#log")
  await reader.getByRole("link", { name: "Harbour notes" }).click()
  await expect(reader).toHaveURL(/\/s\/elsewhere$/)
  await expect(reader.getByRole("heading", { name: "Nothing here." })).toBeVisible()
  await expect(reader.getByRole("link")).toHaveCount(0)
  // The fog clears by itself and then stamps "404" on the X, with CSS alone.
  await expect(reader.locator("script")).toHaveCount(0)
  await expect(reader.locator(".lost-stamp")).toHaveCSS("opacity", "0")
  await expect(reader.locator(".lost-stamp")).toHaveCSS("opacity", "1", { timeout: 10_000 })
  await reader.goto(link)
  await expect(reader.getByRole("link", { name: "the keeper's plan" })).toHaveAttribute("href", "/s/elsewhere")

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" }).click()
  await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Shared" }).click()
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shared" })).toHaveCount(0)
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
  await expect(page.frameLocator("iframe").getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
})

test("the toolbar names the doc's parent todo, a todo: link opens that item, and an html doc's markdown block is its markdown", async ({ page }) => {
  expect((await getItem(page, HARBOUR_TODO.id)).title).toBe(HARBOUR_TODO.title)
  await page.goto("/r/web/notes/harbour.md")
  const notes = await docFrame(page, "Harbour notes")
  await expect(page.getByRole("link", { name: `#${HARBOUR_TODO.id} ${HARBOUR_TODO.title}` })).toHaveAttribute("href", `/todos?item=${HARBOUR_TODO.id}`)
  await notes.getByRole("link", { name: "the open question" }).click()
  await expect(page).toHaveURL(new RegExp(`/todos\\?item=${HARBOUR_TODO.id}$`))
  await expect(page.getByRole("dialog", { name: HARBOUR_TODO.title })).toBeVisible()

  expect((await api<{ id: string }>(page, "GET", "/docs/view?repo=web&path=plans/lighthouse.html")).id).toBe("d_lighthouse")
  // The plan's md twin lacks the log; its embedded block has it, and wins.
  expect(await (await page.request.get("/raw/web/plans/lighthouse.html?format=md")).text()).toContain("The keeper trims the wick at midnight.")
  expect((await api<{ results: { path: string }[] }>(page, "GET", "/search?q=trims wick")).results.map((r) => r.path)).toEqual(["plans/lighthouse.html"])
})

test("a renamed doc keeps its share link, its old path and its group link, through the id it carries", async ({ page, browser }) => {
  const share = await api<{ token: string }>(page, "POST", "/shares", { repo: "web", path: "notes/harbour.md" })
  const item = await itemByTitle(page, "Synced with the CLI")
  const own = await api<{ id: number }>(page, "POST", "/todos", { repo: "github.com-demo-web", title: "Body links the old path", priority: "P3", body: "See [the notes](atlas/notes/harbour.md)." })
  // The pushed copy has the harbour notes renamed.
  await api(page, "POST", "/docs/hold")
  try {
    const renamed = RENAMED.path.slice("web/".length)
    const stranger = await browser.newContext()
    const reader = await stranger.newPage()
    await reader.goto(`/s/${share.token}`)
    await expect(reader.getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
    await stranger.close()

    const old = await page.request.get("/r/web/notes/harbour.md", { maxRedirects: 0 })
    expect([old.status(), new URL(old.headers().location!).pathname]).toEqual([302, `/r/web/${renamed}`])
    await openBoard(page, `/todos?item=${item.id}`)
    await expect(page.getByRole("list", { name: "Group docs" }).getByRole("link", { name: "notes/harbour.md" })).toHaveAttribute("href", `/r/web/${renamed}`)
    // A link inside the app skips the server, so the doc page follows the move itself.
    await openBoard(page, `/todos?item=${own.id}`)
    await page.getByRole("tab", { name: "Preview" }).click()
    await page.getByRole("link", { name: "the notes" }).click()
    await expect(page).toHaveURL(new RegExp(`/r/web/${renamed}$`))
    await docFrame(page, "Harbour notes")
  } finally {
    await api(page, "DELETE", "/docs/hold")
    await api(page, "DELETE", `/shares/${share.token}`)
  }
})

test("[[ in a todo's body links a doc: its repo first, arrows move, Esc closes only the list, Enter inserts", async ({ page }) => {
  const own = await api<{ id: number }>(page, "POST", "/todos", { repo: "github.com-demo-web", title: "Link a doc with brackets", priority: "P3" })
  await openBoard(page, `/todos?item=${own.id}`)
  const panel = page.getByRole("dialog", { name: "Link a doc with brackets" })
  await panel.getByRole("tab", { name: "Write" }).click()
  const body = panel.getByRole("textbox", { name: "Body" })
  const list = page.getByRole("listbox", { name: "Docs to link" })
  await body.pressSequentially("See [[")
  await expect(list.getByRole("option")).toHaveText([/web\//, /web\//, /api\//])
  // The list opens under the caret's line, not under the whole box.
  const [box, at] = [(await body.boundingBox())!, (await list.boundingBox())!]
  expect(box.height).toBeGreaterThan(96)
  expect(at.y - box.y).toBeLessThan(48)
  await body.press("ArrowDown")
  await expect(list.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true")
  await body.press("Escape")
  await expect(list).toBeHidden()
  await expect(panel).toBeVisible()
  await body.pressSequentially("x and [[harbour")
  await expect(list.getByRole("option").first()).toHaveAccessibleName(/^Harbour notes/)
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true")
  await body.press("Enter")
  await body.pressSequentially(", [[ferry")
  await expect(list.getByRole("option", { name: /Ferry runbook/ })).toHaveAttribute("aria-selected", "true")
  await body.press("Enter")
  const text = "See [[x and [Harbour notes](atlas/notes/harbour.md), [Ferry runbook](/r/api/runbook.html)"
  await expect(body).toHaveValue(text)
  await body.press("ControlOrMeta+Enter")
  await expect.poll(async () => (await getItem(page, own.id)).body).toBe(text)
  await panel.getByRole("tab", { name: "Preview" }).click()
  await expect(panel.getByRole("link", { name: "Harbour notes" })).toHaveAttribute("href", "/r/web/notes/harbour.md")
})

test("a search result opens its doc", async ({ page }) => {
  await page.goto("/docs?q=tide")
  await page.getByRole("list", { name: "Results" }).getByRole("link", { name: "Harbour notes" }).click()
  await expect(page).toHaveURL(/\/r\/web\/notes\/harbour\.md$/)
})

test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("a doc and Shared fit without sideways scrolling, and the Docs tabs reach Shared", async ({ page }) => {
    await page.goto("/r/web/notes/harbour.md")
    await expect(page.frameLocator("iframe").getByRole("heading", { level: 1, name: "Harbour notes" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" }).click()
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Shared" }).click()
    await expect(page).toHaveURL(/\/shared$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
