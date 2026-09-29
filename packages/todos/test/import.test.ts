import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { asRenderInput, checkFile, checkStored, report, roundTrip } from "../src/index.ts"

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8")
const { parsed, failures } = checkFile(fixture("every-rule.md"))
const item = (title: string) => parsed.items.find((i) => i.title === title)!
const group = (name: string) => parsed.groups.find((g) => g.name === name)!

describe("parsing every rule", () => {
  test("the fixture passes checks 1 to 3", () => {
    expect(failures).toEqual([])
  })

  test("## P0 — Subject gives the group and the priority, with any dash", () => {
    expect(item("Write the announcement").priority).toBe("P0")
    expect(item("Delete old branches").priority).toBe("P2")
    expect(group("Cleanup")).toBeDefined()
  })

  test("Low priority maps to P3, other headings to Inbox, both reported", () => {
    expect(item("Nice to have").priority).toBe("P3")
    expect(item("Shipped v0").priority).toBeNull()
    expect(parsed.mappings.map((m) => [m.text, m.to])).toEqual([
      ["## Low priority stuff", "P3"],
      ["## Recently Done", "inbox"],
    ])
  })

  test("a repeated heading folds into the first group and is reported", () => {
    expect(item("Rehearse").group).toBe(group("Launch").key)
    expect(parsed.merged.map((m) => m.text)).toEqual(["## P0 - Launch"])
  })

  test("### sets the section, and the quote under ## is the note with its first relative link", () => {
    expect(item("Order chairs").section).toBe("Logistics")
    expect(item("Pick a date").section).toBeNull()
    expect(group("Launch").doc_path).toBe("plans/launch.html")
    expect(group("Launch").note).toStartWith("> Plan: [launch plan]")
  })

  test("marks give the status, [X] included", () => {
    expect(["Write the announcement", "Book the venue", "Pick a date", "Order chairs"].map((t) => item(t).status)).toEqual(["todo", "doing", "done", "done"])
  })

  test("indented lines and plain sub-bullets are the body, dedented", () => {
    expect(item("Write the announcement").body).toBe("Draft it in the shared doc.\n- a plain sub-bullet stays in the body")
  })

  test("indented checkboxes are children, deeper ones flattened and reported", () => {
    const parent = item("Order chairs").key
    expect(["Count guests", "Ask the caterer", "Confirm the room"].map((t) => item(t).parent)).toEqual([parent, parent, parent])
    expect(parsed.flattened.map((f) => f.text)).toEqual(["- [ ] Ask the caterer"])
    expect(item("Count guests").priority).toBe("P0")
  })

  test("prose and tables between items join the group note, under their ### heading", () => {
    const note = group("Launch").note
    expect(note).toContain("### Logistics\n\nSome prose between items goes to the note.")
    expect(note).toContain("| 1 | 2 |")
    expect(note).toContain("### Notes only\n\nNothing but prose here.")
  })

  test("a ### with only items under it is the section alone, not in the note", () => {
    expect(item("Delete old branches").section).toBe("Branches")
    expect(parsed.sections.map((s) => s.text)).toEqual(["### Branches"])
    expect(group("Cleanup").note).toBe("")
  })

  test("preamble and separators are kept aside and reported", () => {
    expect(parsed.preamble.map((l) => l.text)).toEqual(["# Sample TODO", "Text before the first group is preamble."])
    expect(parsed.separators.map((l) => l.text)).toEqual(["---"])
  })

  test("the report counts what it found", () => {
    const r = report("TODO.md", { id: "r", name: "r" }, parsed, failures)
    expect(r.ok).toBe(true)
    expect(r.items).toBe(11)
    expect(r.children).toBe(3)
    expect(r.by_status).toEqual({ todo: 6, doing: 1, done: 4 })
    expect(r.by_priority).toEqual({ P0: 8, P1: 0, P2: 1, P3: 1, inbox: 1 })
    expect(r.groups).toEqual(["Launch", "Cleanup", "Low priority stuff", "Recently Done"])
  })
})

describe("files that must fail", () => {
  test("an unknown mark", () => {
    const r = checkFile(fixture("unknown-mark.md"))
    expect(r.failures[0]).toMatchObject({ check: "mark", line: 4 })
  })

  test("a title over 500 characters", () => {
    expect(checkFile(fixture("long-title.md")).failures.map((f) => f.check)).toEqual(["title"])
  })

  test("a lost line", () => {
    const input = asRenderInput(parsed)
    input.items = input.items.map((i) => (i.title === "Write the announcement" ? { ...i, body: "Draft it in the shared doc." } : i))
    expect(roundTrip(parsed, input)).toEqual([
      { check: "round_trip", line: 11, text: "- a plain sub-bullet stays in the body", message: "missing after the round trip" },
    ])
  })

  test("a duplicated line", () => {
    const input = asRenderInput(parsed)
    input.groups = input.groups.map((g) => (g.name === "Cleanup" ? { ...g, note: "Nothing but prose here." } : g))
    expect(roundTrip(parsed, input).map((f) => f.message)).toEqual(["not in the original"])
  })

  test("a server that stored a different priority fails check 4", () => {
    const input = asRenderInput(parsed)
    input.items = input.items.map((i) => (i.title === "Pick a date" ? { ...i, priority: "P1" as const } : i))
    expect(checkStored(parsed, input).map((f) => f.message)).toEqual([`priority differs on the server (#${item("Pick a date").key})`])
  })

  test("the untouched parse passes check 4 against itself", () => {
    expect(checkStored(parsed, asRenderInput(parsed))).toEqual([])
  })
})
