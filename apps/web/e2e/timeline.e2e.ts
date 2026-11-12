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
  // The toolbar link appears once the doc and its group load; the header has a "Timeline" link too.
  await page.getByTitle("The timeline of Onboarding").click()
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

// Sessions with made-up data: two on Onboarding during phase 1, one big with no effort, one small.
const S1 = "aaaaaaaa-1111-4000-8000-000000000001"
const S2 = "bbbbbbbb-2222-4000-8000-000000000002"
const LOOSE = "cccccccc-3333-4000-8000-000000000003"
const SMALL = "dddddddd-4444-4000-8000-000000000004"

async function seedSessions(page: Page, group: number) {
  const meta = (title: string, extra: Record<string, unknown> = {}) => ({
    title,
    ai_title: null,
    cwd: "/w/harbour",
    repo_id: null,
    started_at: "2026-11-03T08:00:00Z",
    ended_at: "2026-11-04T17:00:00Z",
    days: 2,
    prompts: 40,
    commits: 2,
    todos: 1,
    ...extra,
  })
  const day = (sid: string, d: string) => ({
    entry: d,
    state: "done",
    title: `Logged ships on ${d}`,
    lines: [
      { day: d, text: "Asked for a ship log", source: "session", ref: sid, kind: "asked" },
      { day: d, text: "Kept the log in one file", source: "session", ref: sid, kind: "decided" },
    ],
  })
  const open = { entry: "open", state: "todo", title: "Left open", lines: [{ day: null, text: "Paint the gallery rail", source: "todo", ref: "1", kind: "next" }] }
  await api(page, "POST", "/timeline", { session: S1, meta: meta("Keeper's log"), links: [{ group_id: group, signals: ["todos", "prs"] }], entries: [day(S1, "2026-11-03"), day(S1, "2026-11-04"), open] })
  await api(page, "POST", "/timeline", { session: S2, meta: meta("Watch rota", { started_at: "2026-11-04T09:00:00Z" }), links: [{ group_id: group, signals: ["files"] }], entries: [day(S2, "2026-11-04")] })
  await api(page, "POST", "/timeline", { session: LOOSE, meta: meta("Fog horn tests"), links: [], entries: [day(LOOSE, "2026-11-03")] })
  await api(page, "POST", "/timeline", { session: SMALL, meta: meta("Quick question", { days: 1, prompts: 2, commits: 0, todos: 0 }), links: [], entries: [day(SMALL, "2026-11-03")] })
}

test("an effort shows its sessions, and a session's card resumes it", async ({ page }) => {
  const id = await seedTimeline(page)
  await seedSessions(page, id)
  await page.goto(`/timeline?group=${id}`)
  await expect(page.getByText("2 sessions")).toBeVisible()

  // Phase 1 ran on 3 and 4 Nov, while both sessions were active; the work after it names none.
  const done = page.locator('li[data-entry="phase-1"]')
  await expect(done.locator("[data-session]")).toHaveCount(2)
  await expect(page.locator('li[data-entry="lamp"] [data-session]')).toHaveCount(0)
  await done.locator(`[data-session="${S1}"]`).click()
  const card = page.getByRole("dialog")
  await expect(card.getByText(`cd /w/harbour && claude --resume ${S1}`)).toBeVisible()
  await expect(card.getByRole("button", { name: "Copy" })).toBeVisible()
  await card.getByRole("link", { name: "Open the session" }).click()
  await expect(page).toHaveURL(new RegExp(`session=${S1}`))
  await expect(page.getByRole("heading", { level: 1, name: "Keeper's log" })).toBeVisible()
})

test("a session page shows why it is listed, its days and what it left open", async ({ page }) => {
  const id = await seedTimeline(page)
  await seedSessions(page, id)
  await page.goto(`/timeline?session=${S1}`)
  const main = page.getByRole("main")
  await expect(main.getByText("aaaaaaaa", { exact: true })).toBeVisible()
  await expect(main.getByText("2 days, 40 prompts, 2 commits")).toBeVisible()
  const why = page.getByRole("region", { name: "Why it is listed" })
  await expect(why.getByRole("link", { name: "Onboarding" })).toBeVisible()
  await expect(why.getByText("by its todos and its PRs")).toBeVisible()
  await expect(page.locator("li[data-entry]")).toHaveCount(3)
  await expect(page.locator('li[data-entry="2026-11-03"]').getByText("asked", { exact: true })).toBeVisible()
  await expect(page.locator('li[data-entry="open"]')).toHaveAttribute("data-state", "todo")

  await page.goto(`/timeline?session=${LOOSE}`)
  await expect(page.getByRole("region", { name: "Why it is listed" }).getByText("Belongs to no effort")).toBeVisible()
})

test("the sidebar nests an effort's sessions and folds small loose ones", async ({ page }) => {
  const id = await seedTimeline(page)
  await seedSessions(page, id)
  await page.goto(`/timeline?group=${id}`)
  const row = page.locator('[data-effort="Onboarding"]')
  await expect(row.locator(`a[data-session="${S1}"]`)).toContainText("Keeper's log")
  await expect(row.locator(`a[data-session="${S2}"]`)).toContainText("bbbbbbbb")
  await expect(row.locator(`[data-detail-session="${S2}"]`)).toContainText("Watch rota")

  await page.getByRole("radio", { name: "All" }).click()
  const loose = page.getByRole("region", { name: "Sessions with no effort" })
  await expect(loose.locator(`a[data-session="${LOOSE}"]`)).toContainText("2 days, 40 prompts, 2 commits")
  await expect(loose.locator(`a[data-session="${SMALL}"]`)).toHaveCount(0)
  await loose.getByRole("button", { name: /smaller session/ }).click()
  await loose.locator(`a[data-session="${SMALL}"]`).click()
  await expect(page).toHaveURL(new RegExp(`session=${SMALL}`))
  await expect(page).not.toHaveURL(/group=/)
})
