/**
 * `atlas timeline hook`: one command for Claude Code's PostToolUse, Stop and SessionEnd hooks. It reads the
 * hook's JSON on stdin and starts the cheap sync in the background, so the agent never waits on it. When
 * the entry the agent worked on has no note, the sync marks it `note: draft` and the next tool call asks the
 * agent for one sentence. A validation and SessionEnd start the digest. Design: atlas/timeline/design.html#triggers.
 * A hook must never get in the agent's way: every error goes to the log, and it always exits 0.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
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
// Read at each call, so a test can point HOME at a scratch folder.
const cache = () => join(process.env.HOME!, ".cache/atlas");
const stateFile = () => join(cache(), "timeline-hook.json");
const hookLog = () => join(cache(), "timeline-hook.log");

/** What one background sync does: the triggers since the last one (null: the cwd repo's groups), and the todo commands to check for a validation. */
export type Job = { cwd: string; triggers: (Trigger | null)[]; commands: string[] };

/**
 * Per session: when its last sync started, the entries it was asked to write a note for, the asks still to
 * deliver, and while a sync runs, when it started and the job that came in meanwhile.
 */
type Session = { synced: number; asked: string[]; asks?: string[]; running?: number; queued?: Job };
type State = Record<string, Session>;

/** A sync running longer than this died without clearing its mark. */
const RUN_LIMIT_MS = 5 * 60 * 1000;

function loadState(): State {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: State) {
  mkdirSync(cache(), { recursive: true });
  const tmp = `${stateFile()}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, stateFile());
}

/** Changes one session's state. Other sessions' hooks write the same file, so it reads first and renames into place. */
function update(id: string, change: (s: Session) => void) {
  const state = loadState();
  change((state[id] ??= { synced: 0, asked: [] }));
  saveState(state);
}

const merge = (a: Job | undefined, b: Job): Job => ({
  cwd: b.cwd,
  triggers: [...(a?.triggers ?? []), ...b.triggers].filter((t, i, all) => all.findIndex((u) => JSON.stringify(u) === JSON.stringify(t)) === i),
  commands: [...(a?.commands ?? []), ...b.commands],
});

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

/**
 * The command that runs this CLI again: `bun index.ts` from a checkout, or the compiled binary alone. A compiled
 * binary's entry is inside its own file system (`/$bunfs/...`), where existsSync is true, so it is checked by name.
 */
const self = () => (Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main]);

const quote = (a: string) => `'${a.replace(/'/g, "'\\''")}'`;

/** Runs this CLI detached, with `stdin` on its stdin, so the hook returns before it finishes. */
function detach(args: string[], stdin = "") {
  const cmd = [...self(), ...args].map(quote).join(" ");
  Bun.spawn(["sh", "-c", `printf '%s' ${quote(stdin)} | nohup ${cmd} >> ${quote(hookLog())} 2>&1 &`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
}

/** Digests the session's new days in the background: a model call per day must not hold up the agent. */
function startDigest(session: string) {
  detach(["timeline", "sync", "--digest", "--session", session]);
}

export type Launch = (args: string[], stdin?: string) => void;

/** Starts a background sync, or queues the job for the one already running, which takes it when it finishes. */
function schedule(id: string, job: Job, now: number, launch: Launch): "started" | "queued" {
  let busy = false;
  update(id, (s) => {
    s.synced = now;
    busy = !!s.running && now - s.running < RUN_LIMIT_MS;
    if (busy) s.queued = merge(s.queued, job);
    else s.running = now;
  });
  if (!busy) launch(["timeline", "hook"], JSON.stringify({ hook_event_name: "Sync", session_id: id, cwd: job.cwd, job }));
  return busy ? "queued" : "started";
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

/**
 * The background sync: each trigger's groups, with a note asked for where one is missing, the digest after a
 * validation, then the session and its effort links. Takes any job queued meanwhile before it clears its mark.
 */
async function runSync(id: string, job: Job): Promise<string> {
  const cfg = loadConfig();
  const done: string[] = [];
  for (let next: Job | undefined = job; next; ) {
    try {
      const groups = new Map<number, Group>();
      for (const t of next.triggers) for (const g of await groupsFor(cfg, t, next.cwd)) groups.set(g.id, g);
      const asked = loadState()[id]?.asked ?? [];
      const asks = await syncAndAsk(cfg, [...groups.values()], asked);
      const checks = await Promise.all(next.commands.map((command) => validated(cfg, { hook_event_name: "PostToolUse", session_id: id, cwd: next!.cwd, tool_name: "Bash", tool_input: { command } })));
      if (checks.some(Boolean)) startDigest(id);
      await syncSessions(cfg, { digest: false, session: id, days: 7, dryRun: false, log: () => {} });
      update(id, (s) => {
        s.asked = [...new Set([...s.asked, ...asked])];
        if (asks.length) s.asks = [...(s.asks ?? []), ...asks];
      });
      done.push(`${[...groups.values()].map((g) => g.name).join(", ") || "no group"}${asks.length ? ", asked for a note" : ""}${checks.some(Boolean) ? ", started the digest" : ""}`);
    } finally {
      next = undefined;
      update(id, (s) => {
        next = s.queued;
        delete s.queued;
        if (next) s.running = Date.now();
        else delete s.running;
      });
    }
  }
  return `synced ${done.join("; then ")} and the session`;
}

/** Runs one hook event. `out` is what to print on stdout; `did` is null when there was nothing to do. */
export async function runHook(input: HookInput, now = Date.now(), launch: Launch = detach): Promise<{ out: string | null; did: string | null }> {
  const id = input.session_id;
  if (input.hook_event_name === "Sync") return { out: null, did: await runSync(id, (input as HookInput & { job: Job }).job) };

  const s = loadState()[id] ?? { synced: 0, asked: [] };
  const due = now - s.synced >= STOP_EVERY_MS;

  if (input.hook_event_name === "PostToolUse") {
    // Notes a finished sync asked for go to the agent on its next tool call.
    const asks = s.asks ?? [];
    if (asks.length) update(id, (x) => delete x.asks);
    const out = asks.length ? JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: asks.join("\n") } }) : null;
    const t = trigger(input);
    // A long reply has no Stop, so any tool call 10 minutes after the last sync starts one.
    if (!t && !due) return { out, did: asks.length ? "asked for a note" : null };
    const job: Job = { cwd: input.cwd, triggers: [t], commands: t?.kind === "todo" ? [String(input.tool_input?.command)] : [] };
    return { out, did: `${t?.kind ?? "10 minutes"}: sync ${schedule(id, job, now, launch)}${asks.length ? ", asked for a note" : ""}` };
  }

  if (input.hook_event_name === "Stop") {
    if (!due) return { out: null, did: null };
    return { out: null, did: `sync ${schedule(id, { cwd: input.cwd, triggers: [null], commands: [] }, now, launch)}` };
  }

  if (input.hook_event_name === "SessionEnd") {
    const state = loadState();
    delete state[id];
    saveState(state);
    startDigest(id);
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
      mkdirSync(cache(), { recursive: true });
      appendFileSync(hookLog(), `${new Date().toISOString()} ${input?.hook_event_name ?? "?"} ${input?.session_id?.slice(0, 8) ?? ""} ${(performance.now() - start).toFixed(0)} ms ${note}\n`);
    } catch {}
  }
}
