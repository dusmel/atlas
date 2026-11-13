import { afterAll, describe, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { activeDays, dayPrompts, dayText, loadState, readSession, scanTranscripts, type SyncState } from "../src/session"

// A made-up session: two days in Kigali time (UTC+2), so 23:30 UTC on the 3rd is already the 4th.
const ID = "11111111-2222-3333-4444-555555555555"
const FAKE_KEY = "sk-ant-api03-FAKEfakeFAKE0123456789abcdefXYZ"
const lines = [
  { type: "ai-title", aiTitle: "Harbour lamp rota", sessionId: ID },
  { type: "user", timestamp: "2026-11-03T08:00:00Z", cwd: "/w/harbour", message: { content: "Plan the lamp rota for the harbour" } },
  {
    type: "assistant",
    timestamp: "2026-11-03T08:01:00Z",
    cwd: "/w/harbour",
    message: {
      content: [
        { type: "text", text: "I will write the plan first." },
        { type: "tool_use", name: "Write", input: { file_path: "/w/harbour/atlas/lamp/plan.md", content: "secret body" } },
      ],
    },
  },
  { type: "user", timestamp: "2026-11-03T08:02:00Z", message: { content: [{ type: "tool_result", content: "File written" }] } },
  {
    type: "assistant",
    timestamp: "2026-11-03T08:03:00Z",
    message: { content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "git commit -m 'Plan the rota' && atlas todo start 41", description: "Commit the plan and start the todo" } }] },
  },
  { type: "user", timestamp: "2026-11-03T08:03:05Z", message: { content: [{ type: "tool_result", tool_use_id: "c1", content: "[lamp/1-plan 1a2b3c4] Plan the rota\n 1 file changed" }] } },
  // A quiet commit prints its hash through `git log --oneline -1`. A log in an unrelated command is not a commit.
  {
    type: "assistant",
    timestamp: "2026-11-03T08:04:00Z",
    message: {
      content: [
        { type: "tool_use", id: "c2", name: "Bash", input: { command: "git -C /w/harbour commit -qm 'Add the rota' && git log --oneline -1" } },
        { type: "tool_use", id: "l1", name: "Bash", input: { command: "git log --oneline -3" } },
      ],
    },
  },
  {
    type: "user",
    timestamp: "2026-11-03T08:04:05Z",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "c2", content: [{ type: "text", text: "5e6f7a8 Add the rota" }] },
        { type: "tool_result", tool_use_id: "l1", content: "9999999 Older work" },
      ],
    },
  },
  { type: "user", timestamp: "2026-11-03T08:05:00Z", isMeta: true, message: { content: "<command-caveat>meta</command-caveat>" } },
  { type: "user", timestamp: "2026-11-03T08:06:00Z", message: { content: "<task-notification>done</task-notification>" } },
  { type: "user", timestamp: "2026-11-03T08:07:00Z", isSidechain: true, message: { content: "a subagent prompt" } },
  { type: "pr-link", sessionId: ID, prNumber: 7, prUrl: "https://github.com/example/harbour/pull/7", prRepository: "example/harbour", timestamp: "2026-11-03T09:00:00Z" },
  { type: "user", timestamp: "2026-11-03T23:30:00Z", cwd: "/w/harbour", message: { content: `Use this key ${FAKE_KEY} for the test` } },
  { type: "assistant", timestamp: "2026-11-03T23:31:00Z", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "atlas todo done 41 42", description: "Close both todos" } }] } },
]

const dir = mkdtempSync(join(tmpdir(), "atlas-session-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const TZ = "Africa/Kigali"

describe("readSession", () => {
  const path = join(dir, "one.jsonl")
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")

  test("gives facts per local day and never prompt text", async () => {
    const s = await readSession(path, 0, TZ)
    expect(s.title).toBe("Harbour lamp rota")
    expect(Object.keys(s.days)).toEqual(["2026-11-03", "2026-11-04"])
    const d3 = s.days["2026-11-03"]!
    // The typed prompt counts; the tool result, meta record, notification and subagent prompt do not.
    expect(d3.prompts).toBe(1)
    expect(d3.commits).toEqual(["1a2b3c4", "5e6f7a8"])
    expect(d3.todos).toEqual([41])
    expect(d3.files).toEqual(["/w/harbour/atlas/lamp/plan.md"])
    expect(d3.prs).toEqual(["https://github.com/example/harbour/pull/7"])
    expect(d3.cwds).toEqual(["/w/harbour"])
    expect(d3.first).toBe("2026-11-03T08:00:00Z")
    expect(s.days["2026-11-04"]!.todos).toEqual([41, 42])
    expect(JSON.stringify(s)).not.toContain("Plan the lamp rota")
    expect(JSON.stringify(s)).not.toContain(FAKE_KEY)
  })

  test("a day of only background records is not an active day", async () => {
    const quiet = join(dir, "quiet.jsonl")
    writeFileSync(quiet, [...lines.slice(0, 3), { ...lines[11]!, timestamp: "2026-11-06T09:00:00Z" }].map((l) => JSON.stringify(l)).join("\n") + "\n")
    const s = await readSession(quiet, 0, TZ)
    expect(Object.keys(s.days)).toEqual(["2026-11-03", "2026-11-06"])
    expect(activeDays(s.days).map((d) => d.day)).toEqual(["2026-11-03"])
  })

  test("dayText gives the conversation of one day, with the key line dropped", async () => {
    const s = await readSession(path, 0, TZ)
    const d3 = s.days["2026-11-03"]!
    const t3 = await dayText(path, d3.start, d3.end)
    expect(t3.text).toContain("You: Plan the lamp rota for the harbour")
    expect(t3.text).toContain("Agent: I will write the plan first.")
    expect(t3.text).toContain("Ran: Commit the plan and start the todo")
    expect(t3.text).toContain("Wrote: /w/harbour/atlas/lamp/plan.md")
    // Tool output and file contents stay out.
    expect(t3.text).not.toContain("File written")
    expect(t3.text).not.toContain("secret body")
    expect(t3.text).not.toContain("a subagent prompt")
    const d4 = s.days["2026-11-04"]!
    const t4 = await dayText(path, d4.start, d4.end)
    expect(t4.text).not.toContain(FAKE_KEY)
    expect(t4.dropped).toBe(1)
    expect(t4.text).toContain("Ran: Close both todos")
  })
})

describe("scanTranscripts", () => {
  test("reads only new bytes, leaves a half-written line, and merges into the same day", async () => {
    const projects = join(dir, "projects")
    mkdirSync(join(projects, "-w-harbour"), { recursive: true })
    const path = join(projects, "-w-harbour", `${ID}.jsonl`)
    const first =
      lines
        .slice(0, 7)
        .map((l) => JSON.stringify(l))
        .join("\n") + "\n"
    const half = JSON.stringify(lines[7]!)
    writeFileSync(path, first + half.slice(0, 20))
    const state: SyncState = { version: 2, sessions: {} }

    expect(await scanTranscripts(state, projects, TZ)).toEqual([ID])
    expect(state.sessions[ID]!.offset).toBe(Buffer.byteLength(first))
    expect(state.sessions[ID]!.days["2026-11-03"]!.prs).toEqual([])

    expect(state.sessions[ID]!.pending).toEqual(["c2"])
    appendFileSync(
      path,
      half.slice(20) +
        "\n" +
        lines
          .slice(8)
          .map((l) => JSON.stringify(l))
          .join("\n") +
        "\n",
    )
    expect(await scanTranscripts(state, projects, TZ)).toEqual([ID])
    const s = state.sessions[ID]!
    expect(s.days["2026-11-03"]!.prs).toEqual(["https://github.com/example/harbour/pull/7"])
    expect(s.days["2026-11-03"]!.prompts).toBe(1)
    expect(s.days["2026-11-03"]!.commits).toEqual(["1a2b3c4", "5e6f7a8"])
    expect(s.pending).toEqual([])
    expect(s.days["2026-11-04"]!.prompts).toBe(1)

    // Nothing new: nothing changes.
    expect(await scanTranscripts(state, projects, TZ)).toEqual([])
  })
})

describe("dayPrompts", () => {
  // Planted, made-up secrets: none may come back.
  const GH = "ghp_FAKEfake0123456789FAKEfake0123456789"
  const AWS = "AKIAFAKEFAKE12345678"
  const at = (m: number) => `2026-11-05T09:${String(m).padStart(2, "0")}:00Z`
  const paste = Array.from({ length: 14 }, (_, i) => `row ${i + 1}`).join("\n")
  const records = [
    { type: "user", timestamp: at(0), message: { content: "Plan the ferry rota" } },
    { type: "user", timestamp: at(1), message: { content: "<command-message>mel</command-message>\n<command-name>/mel</command-name>\n<command-args>auto build the rota</command-args>" } },
    { type: "user", timestamp: at(1), isMeta: true, message: { content: [{ type: "text", text: "Base directory for this skill: /x/mel\n# /mel" }] } },
    { type: "user", timestamp: at(2), message: { content: "<bash-input>git status</bash-input>" } },
    { type: "user", timestamp: at(2), message: { content: "<bash-stdout>On branch main</bash-stdout><bash-stderr></bash-stderr>" } },
    { type: "user", timestamp: at(3), message: { content: '<hc from="t9">another agent says hello</hc>' } },
    { type: "user", timestamp: at(4), isCompactSummary: true, message: { content: "This session is being continued from a previous conversation" } },
    { type: "user", timestamp: at(5), message: { content: [{ type: "text", text: "Check the tide table\n<system-reminder>hook output</system-reminder>" }] } },
    { type: "user", timestamp: at(6), message: { content: [{ type: "tool_result", tool_use_id: "x", content: "tool output" }] } },
    { type: "user", timestamp: at(7), promptSource: "typed", message: { content: `Use these:\n<pasted_content id="7afa">\n${paste}\ntoken=${GH}\naws ${AWS}\n</pasted_content>` } },
    { type: "user", timestamp: at(8), message: { content: "https://claude.ai/artifact/FAKE?sk=oc_FAKEfake0123FAKE" } },
    { type: "user", timestamp: "2026-11-05T23:00:00Z", message: { content: "A prompt on the next local day" } },
  ]
  const path = join(dir, "prompts.jsonl")
  writeFileSync(path, records.map((l) => JSON.stringify(l)).join("\n") + "\n")

  test("keeps what the owner typed, as sent, and drops secret lines", async () => {
    const s = await readSession(path, 0, TZ)
    const d = s.days["2026-11-05"]!
    const prompts = await dayPrompts(path, "2026-11-05", d.start, d.end, TZ)
    expect(prompts.map((p) => p.text.split("\n")[0])).toEqual(["Plan the ferry rota", "/mel auto build the rota", "! git status", "Check the tide table", "Use these:", ""])
    // A prompt that was all secret stays, empty, with its line counted.
    expect(prompts[5]!.dropped).toBe(1)
    expect(prompts[3]!.text).toBe("Check the tide table")
    const pasted = prompts[4]!
    expect(pasted.text).toStartWith("Use these:\n<pasted_content>\nrow 1\n")
    expect(pasted.text).toContain("row 14")
    expect(pasted.dropped).toBe(2)
    const all = JSON.stringify(prompts)
    for (const leak of [GH, AWS, "oc_FAKE", "hook output", "tool output", "another agent", "Base directory", "On branch main", "continued from"]) expect(all).not.toContain(leak)
    // The prompt count agrees with what dayPrompts keeps.
    expect(d.prompts).toBe(6)
  })
})

test("a version 1 state reads every transcript again and keeps its digests", async () => {
  const path = join(dir, "state-v1.json")
  const digest = { end: 900, digest: { title: "Rota day" } }
  writeFileSync(path, JSON.stringify({ version: 1, sessions: { a: { path: "/x.jsonl", size: 900, offset: 900, title: "Rota", days: { "2026-11-03": { prompts: 12 } }, pending: ["c1"], digests: { "2026-11-03": digest } } }, sent: { h: { a: "k" } } }))
  const state = await loadState(path)
  expect(state.version).toBe(2)
  expect(state.sessions.a).toMatchObject({ offset: 0, size: 0, days: {}, pending: [], title: "Rota", digests: { "2026-11-03": digest } })
  expect(state.sent).toEqual({ h: { a: "k" } })
})
