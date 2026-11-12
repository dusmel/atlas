// One model call per session day, through `claude -p` on the owner's subscription (design D-digest).
// The input is dayText()'s redacted conversation; the output is checked by the same filter before it is kept.

import { tmpdir } from "node:os"
import { isSecretLine } from "./redact"

// Sonnet caught 20 of 27 checked facts to Haiku's 15, in 6.7 s a day to 12.6 s: atlas/timeline/evidence/phase-2/model-compare.md.
export const DIGEST_MODEL = "sonnet"

export type Digest = { title: string; session_title: string; asked: string[]; decided: string[]; done: string[] }
/** `usd` is what the call would cost on the API; on a subscription it measures use against the limits. */
export type DigestRun = { digest: Digest; ms: number; model: string; dropped: number; usd: number; tokens: { in: number; out: number } }

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    session_title: { type: "string" },
    asked: { type: "array", items: { type: "string" } },
    decided: { type: "array", items: { type: "string" } },
    done: { type: "array", items: { type: "string" } },
  },
  required: ["title", "session_title", "asked", "decided", "done"],
}

export const DIGEST_PROMPT = `You write a short digest of one day of a coding session between the owner ("You:") and a coding agent ("Agent:"). "Ran:" and "Wrote:" lines are what the agent did.

Return:
- title: what the day was about, 3 to 7 words, sentence case.
- session_title: a name for the whole session so far, 3 to 7 words. Earlier days' titles are given; keep the same name unless the work clearly moved on.
- asked: up to 3 lines, what the owner asked for.
- decided: up to 3 lines, choices the owner or the agent settled, with the reason when it is short.
- done: up to 4 lines, what got built, fixed or shipped.

Rules:
- Each line is one plain sentence of at most 14 words, in the past tense, with no ending full stop.
- Paraphrase. Never quote the owner's words, a command, a file's contents or tool output.
- Name projects, features, files and PR numbers. Never name a person, an email address, an account or a machine.
- Leave out secrets, passwords, tokens and keys, and anything private that is not about the work.
- An empty list is fine. Do not invent.`

/** Runs one day through the model. Lines the filter flags are dropped from the digest too. */
export async function digestDay(text: string, opts: { model: string; effort?: string; earlierTitles?: string[]; bin?: string }): Promise<DigestRun> {
  const input = `${opts.earlierTitles?.length ? `Earlier days' titles: ${opts.earlierTitles.join("; ")}\n\n` : ""}${text}`
  const args = ["-p", "--model", opts.model, "--no-session-persistence", "--tools", "", "--setting-sources", "", "--strict-mcp-config"]
  if (opts.effort) args.push("--effort", opts.effort)
  args.push("--system-prompt", DIGEST_PROMPT, "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA))
  const started = performance.now()
  // A scratch cwd, so no project's CLAUDE.md reaches the call.
  const p = Bun.spawn([opts.bin ?? "claude", ...args], { cwd: tmpdir(), stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  const ms = Math.round(performance.now() - started)
  if (code !== 0) throw new Error(`claude -p exited ${code}: ${err.trim().slice(0, 300)}`)
  const res = JSON.parse(out)
  if (res.is_error || !res.structured_output) throw new Error(`claude -p gave no digest: ${String(res.result ?? "").slice(0, 300)}`)
  const raw = res.structured_output as Digest
  let dropped = 0
  const keep = (l: string) => {
    const bad = isSecretLine(l)
    if (bad) dropped++
    return !bad
  }
  const one = (s: string) => (keep(s) ? s.trim() : "")
  const digest: Digest = {
    title: one(raw.title),
    session_title: one(raw.session_title),
    asked: raw.asked.filter(keep).slice(0, 3),
    decided: raw.decided.filter(keep).slice(0, 3),
    done: raw.done.filter(keep).slice(0, 4),
  }
  const u = res.usage ?? {}
  const tokens = { in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), out: u.output_tokens ?? 0 }
  return { digest, ms, model: Object.keys(res.modelUsage ?? {})[0] ?? opts.model, dropped, usd: res.total_cost_usd ?? 0, tokens }
}
