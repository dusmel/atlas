import { expect, test } from "bun:test"
import { ageTone, typeColor } from "../src/lib/doc-colors"

test("change age: this week is green, 60 days or older is amber, neutral between", () => {
  const now = Date.parse("2026-10-13T12:00:00Z")
  const ago = (days: number) => new Date(now - days * 864e5).toISOString()
  expect([0, 6.9, 7, 59.9, 60, 400].map((d) => ageTone(ago(d), now))).toEqual(["text-fresh", "text-fresh", "text-muted-foreground", "text-muted-foreground", "text-old", "text-old"])
})

test("doc types take html-docs' colours, aliases included, and unknown types are slate", () => {
  expect(typeColor("plan")).toBe("#2563eb")
  expect(typeColor("research")).toBe("#c2410c")
  expect(typeColor("poem")).toBe("#64748b")
})
