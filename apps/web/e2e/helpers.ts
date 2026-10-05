import { expect, type Locator, type Page } from "@playwright/test"
import type { Item } from "../src/server/todos"
import { PASSWORD } from "./seed"

export async function login(page: Page) {
  const res = await page.request.post("/login", { form: { password: PASSWORD } })
  expect(res.ok()).toBe(true)
}

export async function api<T>(page: Page, method: string, path: string, data?: unknown): Promise<T> {
  const res = await page.request.fetch(`/api${path}`, { method, data, headers: { "x-atlas": "1" } })
  expect(res.ok(), `${method} ${path} gave ${res.status()}`).toBe(true)
  return res.json()
}

export const getItem = async (page: Page, id: number) => (await api<{ item: Item }>(page, "GET", `/todos/${id}`)).item

export async function itemByTitle(page: Page, title: string): Promise<Item> {
  const items = await api<Item[]>(page, "GET", "/todos?status=todo,doing,done")
  const found = items.find((i) => i.title === title)
  if (!found) throw new Error(`No seeded item titled ${title}`)
  return found
}

// Keys pressed before the first card renders go nowhere, so wait for the board itself.
export async function openBoard(page: Page, url = "/todos") {
  await page.goto(url)
  await page.locator("[data-item]").first().waitFor()
}

export const card = (page: Page, id: number) => page.locator(`[data-item="${id}"]`)
export const cell = (page: Page, key: string) => page.locator(`[data-cell="${key}"]`)
export const idsIn = async (cellLocator: Locator) => (await cellLocator.locator("[data-item]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-item")))))

// dnd-kit starts a drag after 6px of pointer travel, so move in small steps.
// "top" drops on the target's top edge, which places the card before it.
export async function drag(page: Page, from: Locator, to: Locator, at: "center" | "top" = "center") {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, at === "top" ? b.y + 6 : b.y + b.height / 2, { steps: 20 })
  await page.mouse.up()
}
