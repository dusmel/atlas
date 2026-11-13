import { describe, expect, test } from "bun:test"
import { linkSession, remoteName, type EffortRef } from "../src/links"
import type { DayFacts } from "../src/session"

const day = (d: Partial<DayFacts>): DayFacts => ({ day: "2026-11-03", start: 0, end: 1, first: "", last: "", prompts: 1, commits: [], prs: [], todos: [], files: [], cwds: [], ...d })

// Made-up repos: the harbour effort is the only one in its repo; the lighthouse repo has two efforts.
const harbour: EffortRef = {
  group_id: 1,
  remote: "example/harbour",
  branches: "lamp/*",
  prs: [
    { number: 7, branch: "lamp/1-rota", state: "MERGED", url: "https://github.com/example/harbour/pull/7", mergedAt: null },
    { number: 9, branch: "fix-typo", state: "OPEN", url: "https://github.com/example/harbour/pull/9", mergedAt: null },
  ],
  folders: ["/docs/harbour/lamp", "/w/harbour/atlas/lamp"],
  soloRoot: "/w/harbour",
}
const keeper: EffortRef = { group_id: 2, remote: "example/lighthouse", branches: "keeper/*", prs: [], folders: ["/docs/lighthouse/keeper"], soloRoot: null }
const fog: EffortRef = { group_id: 3, remote: "example/lighthouse", branches: "fog/*", prs: [], folders: ["/docs/lighthouse/fog"], soloRoot: null }

describe("linkSession", () => {
  test("links by each signal on its own, and by all three together", () => {
    const days = {
      a: day({ prs: ["https://github.com/example/harbour/pull/7"], files: ["/w/harbour/atlas/lamp/plan.md"] }),
    }
    expect(linkSession(days, [1], [harbour, keeper, fog])).toEqual([{ group_id: 1, signals: ["todos", "prs", "files"] }])
    expect(linkSession({ a: day({ prs: ["https://github.com/example/harbour/pull/7"] }) }, [], [harbour])).toEqual([{ group_id: 1, signals: ["prs"] }])
    expect(linkSession({ a: day({ files: ["/w/harbour/src/lamp.ts"] }) }, [], [harbour])).toEqual([{ group_id: 1, signals: ["files"] }])
  })

  test("a PR on a branch outside the pattern does not link", () => {
    expect(linkSession({ a: day({ prs: ["https://github.com/example/harbour/pull/9"] }) }, [], [harbour])).toEqual([])
  })

  test("in a repo with two efforts, only a write in an effort's folder picks one", () => {
    expect(linkSession({ a: day({ files: ["/w/lighthouse/src/beam.ts"] }) }, [], [keeper, fog])).toEqual([])
    expect(linkSession({ a: day({ files: ["/docs/lighthouse/fog/run.md"] }) }, [], [keeper, fog])).toEqual([{ group_id: 3, signals: ["files"] }])
    // A folder name that only starts the same does not count.
    expect(linkSession({ a: day({ files: ["/docs/lighthouse/fogbank/x.md"] }) }, [], [keeper, fog])).toEqual([])
  })

  test("a todo in a group with no branches still links the session to it", () => {
    expect(linkSession({ a: day({}) }, [5, 5], [harbour])).toEqual([{ group_id: 5, signals: ["todos"] }])
  })
})

test("remoteName reads ssh and https origins", () => {
  expect(remoteName("git@github.com:example/harbour.git")).toBe("example/harbour")
  expect(remoteName("https://github.com/example/harbour")).toBe("example/harbour")
  expect(remoteName("https://gitlab.com/example/harbour.git")).toBeNull()
})

describe("a docs folder shared by efforts", () => {
  const storage: EffortRef = { group_id: 7, remote: null, branches: null, prs: [], folders: ["/docs/voice"], soloRoot: null, prefix: "object-storage-" }
  const telephony: EffortRef = { group_id: 8, remote: null, branches: null, prs: [], folders: ["/docs/voice"], soloRoot: null, prefix: "telephony-" }
  const wrote = (f: string) => linkSession({ a: day({ files: [f] }) }, [], [storage, telephony])

  test("a file counts only for the effort it is named after", () => {
    expect(wrote("/docs/voice/object-storage-plan.md")).toEqual([{ group_id: 7, signals: ["files"] }])
    expect(wrote("/docs/voice/object-storage-evidence/run.txt")).toEqual([{ group_id: 7, signals: ["files"] }])
    expect(wrote("/docs/voice/release-notes.md")).toEqual([])
  })

  test("an effort with its own folder still takes any file in it", () => {
    expect(linkSession({ a: day({ files: ["/docs/lighthouse/fog/notes.md"] }) }, [], [fog])).toEqual([{ group_id: 3, signals: ["files"] }])
  })
})
