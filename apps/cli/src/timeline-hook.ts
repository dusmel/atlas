/**
 * `atlas timeline hook`: one command for Claude Code's PostToolUse, Stop and SessionEnd hooks. It reads the
 * hook's JSON on stdin and runs the cheap sync. When the entry the agent worked on has no note, it marks it
 * `note: draft` and asks the agent for one sentence. A validation and SessionEnd start the digest.
 * Design: atlas/timeline/design.html#triggers.
 * A hook must never get in the agent's way: every error goes to the log, and it always exits 0.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { COMMIT_CMD, setNote } from "@atlas/timeline";
import { syncSessions } from "./timeline-sessions.ts";
import { effortDir, syncGroup, type Group } from "./timeline.ts";
import { api, loadConfig, type Config } from "./todo/client.ts";
import { repoParam, scopeOf } from "./todo/scope.ts";

export type HookInput = {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name?: string;
  tool_input?: { command?: unknown; file_path?: unknown };
};

export type Trigger = { kind: "commit" | "todo" } | { kind: "file"; path: string };

const TODO_CMD = /\btodo\s+(start|done|add)\b/;
const EFFORT_FILES = new Set(["run.md", "timeline.md"]);

/** What in a PostToolUse call should start a sync: a commit, a todo start, done or add, or a write to run.md or timeline.md. */
export function trigger(input: HookInput): Trigger | null {
  const cmd = input.tool_input?.command;
  if (input.tool_name === "Bash" && typeof cmd === "string") {
    if (COMMIT_CMD.test(cmd)) return { kind: "commit" };
    if (/\batlas\b|index\.ts/.test(cmd) && TODO_CMD.test(cmd)) return { kind: "todo" };
    return null;
  }
  const path = input.tool_input?.file_path;
  if (typeof path === "string" && EFFORT_FILES.has(basename(path))) return { kind: "file", path };
  return null;
}

export const STOP_EVERY_MS = 10 * 60 * 1000;
const CACHE = join(process.env.HOME!, ".cache/atlas");
const STATE = join(CACHE, "timeline-hook.json");
export const HOOK_LOG = join(CACHE, "timeline-hook.log");

/** Per session: when it last synced, and the entries it was already asked to write a note for. */
type State = Record<string, { synced: number; asked: string[] }>;

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: State) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state));
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The linked groups a trigger touches: the one whose effort folder holds the file, else the cwd repo's. */
async function groupsFor(cfg: Config, t: Trigger | null, cwd: string): Promise<Group[]> {
  if (t?.kind === "file") {
    const dir = real(dirname(t.path));
    return (await api<Group[]>(cfg, "GET", "/groups")).filter((g) => {
      if (!g.branches) return false;
      try {
        return real(effortDir(g)) === dir;
      } catch {
        return false;
      }
    });
  }
  const scope = await scopeOf({}, cwd).catch(() => null);
  if (!scope || scope === "all") return [];
  return (await api<Group[]>(cfg, "GET", `/groups?${new URLSearchParams({ repo: repoParam(scope) })}`)).filter((g) => g.branches);
}

/** Sync each group; for the entry now being worked on, mark a missing note as a draft and say so once per session. */
async function syncAndAsk(cfg: Config, groups: Group[], asked: string[]): Promise<string[]> {
  const asks: string[] = [];
  for (const g of groups) {
    const r = await syncGroup(cfg, g, { dryRun: false, prs: true });
    const current = r.entries.find((e) => e.state === "doing") ?? r.entries.filter((e) => e.state === "done").at(-1);
    if (!current || current.note_state === "written") continue;
    const key = `${g.id}:${current.entry}`;
    if (asked.includes(key)) continue;
    asked.push(key);
    const file = join(effortDir(g), "timeline.md");
    if (current.note_state !== "draft") writeFileSync(file, setNote(existsSync(file) ? readFileSync(file, "utf8") : "", current.entry, "draft"));
    asks.push(
      `Entry \`${current.entry}\` in ${file} is a draft: write one sentence on why this work was done, with \`atlas timeline note ${current.entry} "<why>" --group "${g.name}"\`.`,
    );
  }
  return asks;
}

/** The command that runs this CLI again: `bun index.ts` from a checkout, or the compiled binary. */
const self = () => (existsSync(Bun.main) ? [process.execPath, Bun.main] : [process.execPath]);

/** Digests the session's new days in the background: a model call per day must not hold up the agent. */
function startDigest(session: string) {
  const cmd = [...self(), "timeline", "sync", "--digest", "--session", session].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  Bun.spawn(["sh", "-c", `nohup ${cmd} >> '${HOOK_LOG}' 2>&1 &`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
}

const PHASE_TODO = /^Phase \d+\b/i;

/** A validation: `todo done` on a "Phase N:" todo, which is how mel records a proven or approved phase. */
async function validated(cfg: Config, input: HookInput): Promise<boolean> {
  const m = /\btodo\s+done\s+((?:#?\d+[\s,]*)+)/.exec(String(input.tool_input?.command ?? ""));
  if (!m) return false;
  const ids = m[1]!.match(/\d+/g)!;
  const items = await Promise.all(ids.map((id) => api<{ item: { title: string } }>(cfg, "GET", `/todos/${id}`).catch(() => null)));
  return items.some((t) => t && PHASE_TODO.test(t.item.title));
}

/** Runs one hook event. `out` is what to print on stdout; `did` is null when there was nothing to do. */
export async function runHook(input: HookInput, now = Date.now()): Promise<{ out: string | null; did: string | null }> {
  const state = loadState();
  const s = (state[input.session_id] ??= { synced: 0, asked: [] });
  const cfg = loadConfig();

  if (input.hook_event_name === "PostToolUse") {
    const t = trigger(input);
    if (!t) return { out: null, did: null };
    const groups = await groupsFor(cfg, t, input.cwd);
    const asks = await syncAndAsk(cfg, groups, s.asked);
    s.synced = now;
    saveState(state);
    const digest = t.kind === "todo" && (await validated(cfg, input));
    if (digest) startDigest(input.session_id);
    const did = `${t.kind}: synced ${groups.map((g) => g.name).join(", ") || "no group"}${asks.length ? ", asked for a note" : ""}${digest ? ", started the digest" : ""}`;
    return { out: asks.length ? JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: asks.join("\n") } }) : null, did };
  }

  if (input.hook_event_name === "Stop") {
    if (now - s.synced < STOP_EVERY_MS) return { out: null, did: null };
    s.synced = now;
    saveState(state);
    const groups = await groupsFor(cfg, null, input.cwd);
    for (const g of groups) await syncGroup(cfg, g, { dryRun: false, prs: true });
    await syncSessions(cfg, { digest: false, session: input.session_id, days: 7, dryRun: false, log: () => {} });
    return { out: null, did: `synced ${groups.map((g) => g.name).join(", ") || "no group"} and the session` };
  }

  if (input.hook_event_name === "SessionEnd") {
    delete state[input.session_id];
    saveState(state);
    startDigest(input.session_id);
    return { out: null, did: "started the digest" };
  }
  return { out: null, did: null };
}

/** Entry point: never throws, never exits non-zero. */
export async function cmdHook(stdin: string): Promise<void> {
  const start = performance.now();
  let input: HookInput | null = null;
  let note: string | null;
  try {
    input = JSON.parse(stdin) as HookInput;
    const r = await runHook(input);
    if (r.out) process.stdout.write(`${r.out}\n`);
    note = r.did;
  } catch (e) {
    note = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  // Only work done and errors are logged, so the log does not grow with every tool call.
  if (note) {
    try {
      mkdirSync(CACHE, { recursive: true });
      appendFileSync(HOOK_LOG, `${new Date().toISOString()} ${input?.hook_event_name ?? "?"} ${input?.session_id?.slice(0, 8) ?? ""} ${(performance.now() - start).toFixed(0)} ms ${note}\n`);
    } catch {}
  }
}
