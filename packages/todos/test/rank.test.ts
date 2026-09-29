import { describe, expect, test } from "bun:test"
import { rankBetween } from "../src/index.ts"

describe("rankBetween", () => {
  test("gives a key for an empty column", () => {
    expect(rankBetween(null, null)).toBeString()
  })

  test("sorts between its neighbours", () => {
    const a = rankBetween(null, null)
    const c = rankBetween(a, null)
    const b = rankBetween(a, c)
    expect([c, b, a].sort()).toEqual([a, b, c])
  })

  test("keeps order after many inserts at the top", () => {
    const keys: string[] = []
    let first: string | null = null
    for (let i = 0; i < 200; i++) {
      first = rankBetween(null, first)
      keys.unshift(first)
    }
    expect([...keys].sort()).toEqual(keys)
  })

  test("rejects neighbours in the wrong order", () => {
    const a = rankBetween(null, null)
    const b = rankBetween(a, null)
    expect(() => rankBetween(b, a)).toThrow()
  })
})
