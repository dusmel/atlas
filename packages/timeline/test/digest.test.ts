import { afterAll, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { digestDay } from "../src/digest"
import { dayText, readSession } from "../src/session"

// Made-up keys, planted in a prompt, a reply and a command description. None is real.
const PLANTED = ["sk-ant-api03-FAKEfake0123456789FAKEfake", "ghp_FAKEfake0123456789FAKEfake0123", "xoxb-123456789012-fakefakefake"]

const dir = mkdtempSync(join(tmpdir(), "atlas-digest-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// A stand-in for `claude -p` that does the worst a model could: echo its whole input back, and repeat a key.
const fake = join(dir, "claude")
writeFileSync(
  fake,
  `#!/usr/bin/env bun
const input = await Bun.stdin.text()
await Bun.write(${JSON.stringify(join(dir, "seen.txt"))}, input)
const lines = input.split("\\n").filter(Boolean)
console.log(JSON.stringify({ structured_output: { title: "Echo day", session_title: "Echo", asked: lines.slice(0, 3), decided: ["Kept the key ${PLANTED[0]} in the config"], done: lines.slice(3) }, usage: { output_tokens: 1 }, modelUsage: { fake: {} } }))
`,
)
chmodSync(fake, 0o755)

test("a planted key reaches neither the model nor the stored digest", async () => {
  const path = join(dir, "s.jsonl")
  const rec = (r: object) => JSON.stringify({ timestamp: "2026-11-03T08:00:00Z", ...r })
  writeFileSync(
    path,
    [
      rec({ type: "user", message: { content: "Build the lamp rota" } }),
      rec({ type: "user", message: { content: `Here is the key: ${PLANTED[0]}` } }),
      rec({ type: "assistant", message: { content: [{ type: "text", text: `I set GITHUB_TOKEN to ${PLANTED[1]}` }] } }),
      rec({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "true", description: `Post to Slack with ${PLANTED[2]}` } }] } }),
      rec({ type: "assistant", message: { content: [{ type: "text", text: "The rota is in place." }] } }),
    ].join("\n") + "\n",
  )
  const day = Object.values((await readSession(path)).days)[0]!
  const text = await dayText(path, day.start, day.end)
  const run = await digestDay(text.text, { model: "fake", bin: fake })
  const seen = await Bun.file(join(dir, "seen.txt")).text()
  const stored = JSON.stringify(run.digest)
  for (const key of PLANTED) {
    expect(seen).not.toContain(key)
    expect(stored).not.toContain(key)
  }
  expect(text.dropped).toBe(3)
  // The echoed prompt survives; the repeated key does not.
  expect(run.digest.asked).toContain("You: Build the lamp rota")
  expect(run.digest.decided).toEqual([])
  expect(run.dropped).toBe(1)
})
