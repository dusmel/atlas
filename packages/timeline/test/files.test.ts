import { describe, expect, test } from "bun:test"
import { readPlanHeadings, readRunMd, readTimelineMd, setNote } from "../src/files"

describe("readRunMd", () => {
  test("reads the open stretch and the parked list, and ignores the prose", () => {
    const text = `Status: running

# Harbour run state

Some prose about the run. A table follows.

| step | state |
|---|---|
| 8. Phases | phase 2 |

Now: Speed of the first answer
Parked:
- Push the monitor commit - waiting on the owner's review
- The menu bug — needs a console snippet
- Retry the import
`
    expect(readRunMd(text)).toEqual({
      now: "Speed of the first answer",
      parked: [
        { text: "Push the monitor commit", reason: "waiting on the owner's review" },
        { text: "The menu bug", reason: "needs a console snippet" },
        { text: "Retry the import", reason: null },
      ],
    })
  })

  test("takes Phase: as the open stretch and a Parked heading with a blank line", () => {
    expect(readRunMd("Phase: phase-2, box 3\n\n## Parked\n\n- Deploy - production pauses\n\n## Next")).toEqual({
      now: "phase-2, box 3",
      parked: [{ text: "Deploy", reason: "production pauses" }],
    })
  })

  test("a run.md with neither key gives nothing", () => {
    expect(readRunMd("| 8. Phases | phase 1 done |\n\n## Parked\n\n(none)\n")).toEqual({ now: null, parked: [] })
  })
})

describe("readTimelineMd", () => {
  test("reads entries by id with state, note, waiting and next", () => {
    const text = `# Timeline

## polish {state: doing}
note: A save had deleted every alternative,
so records are never deleted now.
waiting: #557 pick a target
next: You install the polish

## phase-2 {state: done}
note: draft

## later {state: todo, title: "After v1"}
next: Use it for a week
`
    const [polish, phase2, later] = readTimelineMd(text)
    expect(polish).toEqual({
      id: "polish",
      state: "doing",
      title: null,
      note: "A save had deleted every alternative,\nso records are never deleted now.",
      noteState: "written",
      waiting: ["#557 pick a target"],
      next: ["You install the polish"],
      done: [],
    })
    expect(phase2).toMatchObject({ id: "phase-2", state: "done", note: null, noteState: "draft" })
    expect(later).toMatchObject({ id: "later", state: "todo", title: "After v1", next: ["Use it for a week"] })
  })

  test("skips text before the first entry and lines it does not know", () => {
    expect(readTimelineMd("intro\n\n## a\nrandom line\n")).toEqual([{ id: "a", state: null, title: null, note: null, noteState: null, waiting: [], next: [], done: [] }])
  })
})

test("readPlanHeadings maps anchors to heading text", () => {
  const plan = "## Timeline {#timeline}\n\n## Phase 1: I keep my versions {#phase-1}\n\n## Polish after first use {#polish}\n### Not this {#sub}\n"
  expect([...readPlanHeadings(plan)]).toEqual([
    ["timeline", "Timeline"],
    ["phase-1", "Phase 1: I keep my versions"],
    ["polish", "Polish after first use"],
  ])
})

describe("setNote", () => {
  const file = `# Timeline

## polish {state: doing}
note: draft
waiting: #557 pick a target

## phase-2
note: Old note,
over two lines.
next: ship it
`
  test("replaces a draft and keeps the other keys", () => {
    const out = setNote(file, "polish", "Records are never deleted now.")
    expect(readTimelineMd(out)[0]).toMatchObject({ note: "Records are never deleted now.", noteState: "written", waiting: ["#557 pick a target"] })
    expect(out.split("\n").length).toBe(file.split("\n").length)
  })

  test("replaces a note over several lines and keeps the next key", () => {
    const [, phase2] = readTimelineMd(setNote(file, "phase-2", "New note."))
    expect(phase2).toMatchObject({ note: "New note.", next: ["ship it"] })
  })

  test("adds a note under a heading that has none, and a heading for a new entry", () => {
    expect(readTimelineMd(setNote("## a\nnext: x\n", "a", "Why."))[0]).toMatchObject({ note: "Why.", next: ["x"] })
    const out = setNote(file, "phase-3", "Started.")
    expect(readTimelineMd(out).map((e) => e.id)).toEqual(["polish", "phase-2", "phase-3"])
    expect(setNote("", "phase-1", "First.")).toBe("## phase-1\nnote: First.\n")
  })

  test("does not match an id that only starts the same", () => {
    const out = setNote("## phase-10\nnote: ten\n", "phase-1", "one")
    expect(readTimelineMd(out).map((e) => [e.id, e.note])).toEqual([["phase-10", "ten"], ["phase-1", "one"]])
  })
})
