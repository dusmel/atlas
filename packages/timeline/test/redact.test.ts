import { describe, expect, test } from "bun:test"
import { isSecretLine, redact } from "../src/redact"

// Every value below is made up. None is a real key.
const PLANTED = [
  "export ANTHROPIC_API_KEY=sk-ant-api03-FAKEfake0123456789FAKEfake",
  "token ghp_FAKEfake0123456789FAKEfake0123",
  "github_pat_11FAKE0123456789_fakeFAKEfake0123456789",
  "SLACK=xoxb-123456789012-fakefakefake",
  "aws AKIAFAKEFAKEFAKEFAKE in the config",
  "maps key AIzaSyFAKEfake0123456789FAKEfake012345",
  "Authorization: Bearer abc123def456ghi789jkl",
  "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.ZmFrZXNpZ25hdHVyZQ",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "postgres://atlas:hunter2hunter2@db.example.com/atlas",
  'COOLIFY_TOKEN="9f8e7d6c5b4a39281706"',
  '{"password": "correct-horse-battery"}',
  "hash $2b$10$FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE",
  "random Zx9QwErTy7UiOp3AsDfGh5JkLzXcVbN1mQ in a sentence",
]

const SAFE = [
  "Commit 1a2b3c4 and 9f0e8d7c6b5a49382716051a2b3c4d5e6f708192 are on main",
  "Read /Users/someone/Desktop/projects/harbour/apps/web/src/routes/timeline.tsx",
  "Session 8e1e13cd-0af3-462b-846c-14ee6416ba71 built the lamp",
  "COOLIFY_TOKEN='{{ op://Personal/coolify API token - agents/password }}'",
  "ATLAS_PASSWORD_HASH_B64=$(bun -e ...) bun server.ts",
  "Fix the token refresh in the login page",
  "The password field now shows a hint",
]

describe("redaction", () => {
  test.each(PLANTED)("flags %s", (line) => expect(isSecretLine(line)).toBe(true))
  test.each(SAFE)("keeps %s", (line) => expect(isSecretLine(line)).toBe(false))

  test("redact drops whole lines and counts them", () => {
    const text = ["You: deploy it", ...PLANTED, "Agent: done"].join("\n")
    const out = redact(text)
    expect(out.text).toBe("You: deploy it\nAgent: done")
    expect(out.dropped).toBe(PLANTED.length)
  })
})
