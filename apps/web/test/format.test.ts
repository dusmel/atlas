import { describe, expect, test } from "bun:test"
import { createdExact, createdStamp, stamp } from "../src/lib/format"

describe("stamp", () => {
  // Local time on purpose: the browser shows the reader's own clock.
  const now = new Date(2026, 9, 14, 21, 30).getTime()
  const at = (...p: [number, number, number, number, number]) => new Date(...p).toISOString()

  test("the last hour reads as minutes ago", () => {
    expect(stamp(new Date(now - 30_000).toISOString(), now)).toBe("just now")
    expect(stamp(at(2026, 9, 14, 21, 18), now)).toBe("12 min. ago")
  })

  test("older is a date and a time, the year only when it is not this one", () => {
    expect(stamp(at(2026, 9, 14, 9, 5), now)).toBe("Today, 09:05")
    expect(stamp(at(2026, 9, 11, 14, 5), now)).toBe("11 Oct, 14:05")
    expect(stamp(at(2025, 11, 31, 23, 59), now)).toBe("31 Dec 2025, 23:59")
  })
})

describe("createdStamp", () => {
  const now = new Date(2026, 9, 14, 21, 30).getTime()

  test("a time reads as stamp does", () => {
    const at = new Date(2026, 9, 11, 14, 5).toISOString()
    expect(createdStamp(at, now)).toBe(stamp(at, now))
  })

  test("a bare day reads as that day in any time zone, the year only when it is not this one", () => {
    // ICU versions spell September "Sep" or "Sept".
    expect(createdStamp("2026-09-11", now)).toMatch(/^11 Sept?$/)
    expect(createdStamp("2025-12-31", now)).toBe("31 Dec 2025")
    expect(createdExact("2026-09-11")).toMatch(/^11 Sept? 2026$/)
  })
})
