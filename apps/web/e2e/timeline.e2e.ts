import { expect, test, type Page } from "@playwright/test"
import { api, login, overflowing } from "./helpers"

// Design: atlas/timeline/design.html#look. The spec posts its own entries to the seeded Onboarding group.
const WAITING = "Pick the harbour colour for the e2e"

async function seedTimeline(page: Page) {
  const groups = await api<{ id: number; name: string }[]>(page, "GET", "/groups")
  const group = groups.find((g) => g.name === "Onboarding")!
  await api(page, "PATCH", `/groups/${group.id}`, { branches: "onboard/*" })
  await api(page, "POST", "/timeline", {
    group: group.id,
    entries: [
      {
        entry: "phase-1",
        state: "done",
        title: "Phase 1: the keeper's log",
        merged: true,
        note: "Logged ships first, so the lamp work had a record to check.",
        started_at: "2026-11-03",
        ended_at: "2026-11-04",
        lines: [
          { day: "2026-11-03", text: "Log every passing ship", source: "git", ref: "a1b2c3d" },
          { day: "2026-11-04", text: "Add the night `watch` rota", source: "git", ref: "d4e5f6a" },
          { day: "2026-11-04", text: "PR 7", source: "git", ref: "https://github.com/example/web/pull/7", kind: "pr-merged" },
        ],
      },
      {
        entry: "lamp",
        state: "doing",
        title: "Light the lamp at dusk",
        lines: [
          { day: "2026-11-10", text: "Trim the wick", source: "git", ref: "b7c8d9e" },
          { day: null, text: WAITING, source: "note", ref: null, kind: "waiting" },
        ],
      },
      { entry: "next", state: "todo", title: "Next", lines: [{ day: null, text: "Paint the gallery rail", source: "note", ref: null, kind: "next" }] },
    ],
  })
  return group.id
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

test("the rail shows done, now and next, and Compact folds all but now", async ({ page }) => {
  const id = await seedTimeline(page)
  await page.goto(`/timeline?group=${id}`)
  const entries = page.locator("li[data-entry]")
  await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible()
  await expect(entries).toHaveCount(3)
  await expect(entries.nth(0)).toHaveAttribute("data-state", "done")
  await expect(entries.nth(1)).toHaveAttribute("data-state", "doing")

  const done = page.locator('li[data-entry="phase-1"]')
  await expect(done.getByText("3 to 4 Nov")).toBeVisible()
  await expect(done.getByLabel("merged")).toBeVisible()
  await expect(done.getByText("Logged ships first")).toBeVisible()
  // A commit links to GitHub, taken from the PR line's url.
  await expect(done.getByRole("link", { name: "git a1b2c3d" })).toHaveAttribute("href", "https://github.com/example/web/commit/a1b2c3d")
  await expect(done.getByText("2 commits · PR 7")).toBeVisible()

  const now = page.locator('li[data-entry="lamp"]')
  await expect(now.getByText("now", { exact: true })).toBeVisible()
  await expect(now.getByText(`You: ${WAITING}`)).toBeVisible()

  await page.getByRole("radio", { name: "Compact" }).click()
  await expect(page).toHaveURL(/density=compact/)
  await expect(done.getByText("Log every passing ship")).toBeHidden()
  await expect(done.getByText("Phase 1: the keeper's log")).toBeVisible()
  await expect(now.getByText("Trim the wick")).toBeVisible()
})

test("the sidebar lists the effort, what waits on you, and filters", async ({ page }) => {
  const id = await seedTimeline(page)
  await page.goto(`/timeline?group=${id}`)
  const nav = page.getByRole("navigation", { name: "Efforts" })
  const row = nav.locator('[data-effort="Onboarding"]')
  await expect(row.getByRole("link", { name: "Onboarding" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("region", { name: "Waiting on you" }).getByText(WAITING)).toBeVisible()
  await expect(row.getByLabel(/^Phases:/)).toBeVisible()

  // List drops the phase bars.
  await page.getByRole("radio", { name: "List" }).click()
  await expect(row.getByLabel(/^Phases:/)).toBeHidden()

  // The selected effort opens with its details; the chevron folds them.
  await expect(row.getByText("onboard/*")).toBeVisible()
  await row.getByRole("button", { name: "Hide details" }).click()
  await expect(row.getByText("onboard/*")).toBeHidden()

  // Touched today, so Neglected leaves it out.
  await page.getByRole("radio", { name: "Neglected" }).click()
  await expect(page).toHaveURL(/filter=neglected/)
  await expect(nav.locator('[data-effort="Onboarding"]')).toHaveCount(0)
})

test("a group's doc opens its timeline from the toolbar", async ({ page }) => {
  const id = await seedTimeline(page)
  await page.goto("/r/web/plans/lighthouse.html")
  await page.getByRole("link", { name: "Timeline", exact: true }).last().click()
  await expect(page).toHaveURL(new RegExp(`/timeline\\?group=${id}$`))
  await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible()
})

test("on a phone the sidebar and the rail fit without sideways scroll", async ({ page }) => {
  const id = await seedTimeline(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/timeline")
  await expect(page.locator('[data-effort="Onboarding"]')).toBeVisible()
  await page.locator('[data-effort="Onboarding"]').getByRole("link", { name: "Onboarding" }).click()
  await expect(page).toHaveURL(new RegExp(`group=${id}`))
  await expect(page.locator("li[data-entry]")).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  expect(await overflowing(page.locator("main"))).toEqual([])
})
