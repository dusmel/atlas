/**
 * `atlas timeline`: link a todo group to its branches, sync its timeline from the files on this Mac,
 * show it, and write an entry's note. Design: atlas/timeline/design.html.
 */

import { isatty } from "node:tty";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { branchWork, buildEntries, setNote, type EffortDoc, type EffortFiles, type Entry, type Pr, type SessionDays, type TodoItem } from "@atlas/timeline";
import { reposDir } from "./config.ts";
import { cmdHook } from "./timeline-hook.ts";
import { syncSessions } from "./timeline-sessions.ts";
import { parseArgs, textFlag, type FlagSpec } from "./todo/args.ts";
import { api, CliError, loadConfig, type Config } from "./todo/client.ts";
import { repoParam, scopeOf } from "./todo/scope.ts";
import { railView } from "./timeline-rail.ts";
import { MIN_WIDTH, type Style } from "./todo/pretty.ts";
import { err, out, page } from "./util.ts";

export const TIMELINE_COMMANDS: Record<string, { about: string; flags: FlagSpec }> = {
  sync: {
    about: "Sync linked efforts: sync [GROUP], or sessions: sync --sessions|--digest",
    flags: { repo: "string", all: "boolean", "dry-run": "boolean", "no-prs": "boolean", json: "boolean", sessions: "boolean", digest: "boolean", session: "string", days: "string" },
  },
  show: { about: "Print an effort's timeline: show GROUP, or show --session ID", flags: { repo: "string", json: "boolean", session: "string" } },
  link: { about: "Link a group to its branches, or to a session it grew from: link GROUP --branches 'v1/*' | --session ID", flags: { repo: "string", branches: "string", session: "string" } },
  note: { about: "Write an entry's note in timeline.md: note ENTRY TEXT|-", flags: { repo: "string", group: "string", "no-sync": "boolean" } },
  hook: { about: "Run as the Claude Code hook: reads the hook's JSON on stdin", flags: {} },
};

export const TIMELINE_USAGE = `atlas timeline — what an effort did, is doing and does next, from git, run.md, timeline.md and its todos.

  atlas timeline link  GROUP --branches 'v1/*'   once per effort; the repo is the group's
  atlas timeline link  GROUP --session ID         the session the effort grew from (/mel adopt)
  atlas timeline sync  [GROUP] [--all] [--dry-run] [--no-prs] [--json]
  atlas timeline sync  --sessions [--session ID] [--dry-run] [--json]    sessions from the transcripts, no model
  atlas timeline sync  --digest [--session ID] [--days 7]                 also a digest per session day (Sonnet)
  atlas timeline show  GROUP [--json]
  atlas timeline show  --session ID [--json]    a session's days and what each one asked, decided and did
  atlas timeline note  ENTRY "why it was done" [--group GROUP] [--no-sync]   TEXT - reads stdin
  atlas timeline hook  < hook JSON              for PostToolUse, Stop and SessionEnd; always exits 0

sync with no GROUP syncs every linked group of the current repo; --all syncs every linked group.
--digest without --session digests sessions big enough to list that were active in the last --days days.
GROUP is a todo group name. Each command takes --repo NAME when the current directory is not the repo.`;

export type Group = { id: number; name: string; repo_id: string; repo_name: string; branches: string | null; docs: { label: string; path: string }[] };

export async function cmdTimeline(args: string[]): Promise<void> {
  try {
    process.exitCode = await run(args);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    err(e.message);
    process.exitCode = e.exitCode;
  }
}

async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "-h" || sub === "--help") {
    console.log(TIMELINE_USAGE);
    return sub ? 0 : 2;
  }
  const spec = TIMELINE_COMMANDS[sub];
  if (!spec) throw new CliError(2, `Unknown timeline command: ${sub}\n\n${TIMELINE_USAGE}`);
  const { flags, rest: words } = parseArgs(rest, spec.flags);
  // Before loadConfig: a hook must exit 0 even with no config.
  if (sub === "hook") {
    await cmdHook(await Bun.stdin.text());
    return 0;
  }
  const cfg = loadConfig();

  switch (sub) {
    case "link": {
      const { branches, session } = flags;
      if (!words[0] || (typeof branches !== "string" && typeof session !== "string")) throw new CliError(2, "Usage: atlas timeline link GROUP --branches 'v1/*' | --session ID");
      const group = await findGroup(cfg, words.join(" "), flags);
      if (typeof branches === "string") {
        await api(cfg, "PATCH", `/groups/${group.id}`, { branches });
        await out(`${group.repo_name}  ${group.name}  → branches ${branches}`);
      }
      if (typeof session === "string") {
        await api(cfg, "POST", "/timeline/adopt", { session, group_id: group.id });
        await out(`${group.repo_name}  ${group.name}  → session ${session}`);
      }
      return 0;
    }
    case "sync": {
      if (flags.sessions || flags.digest || typeof flags.session === "string") {
        const days = typeof flags.days === "string" ? Number(flags.days) : 7;
        if (!Number.isInteger(days) || days < 1) throw new CliError(2, "--days takes a whole number of days");
        const r = await syncSessions(cfg, {
          digest: !!flags.digest,
          session: typeof flags.session === "string" ? flags.session : undefined,
          days,
          dryRun: !!flags["dry-run"],
          log: (l) => err(l),
        }).catch((e) => {
          throw new CliError(1, e instanceof Error ? e.message : String(e));
        });
        if (flags.json || flags["dry-run"]) await out(JSON.stringify(r, null, 2));
        else await out(`${n(r.scanned, "transcript")} read, ${n(r.digested, "day")} digested, ${n(r.sent.length, "session")} sent (${r.sent.filter((x) => x.links.length).length} linked to an effort)`);
        return 0;
      }
      const groups = words.length ? [await findGroup(cfg, words.join(" "), flags)] : await linkedGroups(cfg, flags);
      if (!groups.length) throw new CliError(2, "No linked groups here. Link one with: atlas timeline link GROUP --branches 'v1/*'");
      const results = [];
      for (const g of groups) results.push(await syncGroup(cfg, g, { dryRun: !!flags["dry-run"], prs: !flags["no-prs"] }));
      if (flags.json || flags["dry-run"]) await out(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
      else await out(results.map((r) => `${r.group}: ${r.entries.length} entries (${r.counts ? Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(", ") : "not sent"})`).join("\n"));
      return 0;
    }
    case "show": {
      if (typeof flags.session === "string") {
        type SessionShown = { session: { id: string; title: string | null; ai_title: string | null; repo_name: string | null; efforts: { name: string }[] }; entries: ShownEntry[] };
        const t = await api<SessionShown>(cfg, "GET", `/timeline?${new URLSearchParams({ session: flags.session })}`);
        const s = t.session;
        const head = { name: s.title || s.ai_title || s.id, repo_name: `${s.repo_name ?? "no repo"} · session ${s.id}${s.efforts.length ? ` · efforts ${s.efforts.map((e) => e.name).join(", ")}` : ""}`, branches: null };
        const style = railStyle(flags);
        if (style) await page(railView({ name: head.name, sub: head.repo_name }, t.entries, style));
        else await out(flags.json ? JSON.stringify(t, null, 2) : showMarkdown(head, t.entries));
        return 0;
      }
      if (!words[0]) throw new CliError(2, "Usage: atlas timeline show GROUP, or show --session ID");
      const group = await findGroup(cfg, words.join(" "), flags);
      const t = await api<{ entries: ShownEntry[] }>(cfg, "GET", `/timeline?group=${group.id}`);
      const style = railStyle(flags);
      if (style) await page(railView({ name: group.name, sub: `${group.repo_name}${group.branches ? ` · branches ${group.branches}` : ""}` }, t.entries, style));
      else await out(flags.json ? JSON.stringify(t, null, 2) : showMarkdown(group, t.entries));
      return 0;
    }
    case "note": {
      const [entry, ...text] = words;
      const note = text.length === 1 && text[0] === "-" ? await textFlag("-") : text.join(" ");
      if (!entry || !note?.trim()) throw new CliError(2, 'Usage: atlas timeline note ENTRY "why it was done" [--group GROUP]');
      const group = typeof flags.group === "string" ? await findGroup(cfg, flags.group, flags) : await onlyLinkedGroup(cfg, flags);
      const file = join(effortDir(group), "timeline.md");
      writeFileSync(file, setNote(existsSync(file) ? readFileSync(file, "utf8") : "", entry, note));
      await out(`${file}: note on ${entry}`);
      if (!flags["no-sync"] && group.branches) {
        const r = await syncGroup(cfg, group, { dryRun: false, prs: true });
        await out(`${r.group}: synced`);
      }
      return 0;
    }
  }
  return 0;
}

const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

async function findGroup(cfg: Config, name: string, flags: Record<string, string | boolean>): Promise<Group> {
  const q = new URLSearchParams();
  // In a promoted repo the name is that repo's group; elsewhere any repo's, if only one has it.
  const scope = typeof flags.repo === "string" ? await scopeOf(flags) : await scopeOf(flags).catch(() => "all" as const);
  if (scope !== "all") q.set("repo", repoParam(scope));
  const groups = (await api<Group[]>(cfg, "GET", `/groups?${q}`)).filter((g) => g.name === name);
  if (groups.length > 1) throw new CliError(2, `${groups.length} repos have a group ${name}: add --repo ${groups.map((g) => g.repo_name).join(" or --repo ")}`);
  if (!groups[0]) throw new CliError(2, `No group ${name}${scope === "all" ? "" : " in this repo"}. See: atlas todo groups${scope === "all" ? " --all" : ""}`);
  return groups[0];
}

async function linkedGroups(cfg: Config, flags: Record<string, string | boolean>): Promise<Group[]> {
  const q = new URLSearchParams();
  if (!flags.all) q.set("repo", repoParam(await scopeOf(flags)));
  return (await api<Group[]>(cfg, "GET", `/groups?${q}`)).filter((g) => g.branches);
}

async function onlyLinkedGroup(cfg: Config, flags: Record<string, string | boolean>): Promise<Group> {
  const groups = await linkedGroups(cfg, flags);
  if (groups.length !== 1) throw new CliError(2, groups.length ? `This repo has ${groups.length} linked groups: add --group NAME` : "No linked group here: add --group NAME");
  return groups[0]!;
}

/** The store folder whose meta.json has this repo's id; it holds repoRoot, the checkout on this Mac. */
export function storeDir(repoId: string): { dir: string; repoRoot: string | null } {
  for (const name of existsSync(reposDir()) ? readdirSync(reposDir()) : []) {
    try {
      const meta = JSON.parse(readFileSync(join(reposDir(), name, "meta.json"), "utf8"));
      if (meta.id === repoId) return { dir: join(reposDir(), name), repoRoot: typeof meta.repoRoot === "string" ? meta.repoRoot : null };
    } catch {}
  }
  throw new CliError(2, `No store folder for ${repoId} under ${reposDir()}: run atlas ensure in the repo`);
}

/** The effort's folder: where its plan doc lives. */
export function effortDir(group: Group): string {
  const plan = group.docs.find((d) => d.label === "plan");
  if (!plan) throw new CliError(2, `Group ${group.name} has no plan doc, so it has no effort folder. Add one with --doc on the group`);
  return dirname(join(storeDir(group.repo_id).dir, plan.path));
}

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

/**
 * Everything the effort folder gives the sync. Files that do not exist are left out. An effort whose plan
 * is not `plan.html` shares its folder with other docs, such as `object-storage-plan.html` among the voice
 * docs: then only docs named like the plan belong to it, and `<prefix>spec` can be its design.
 */
export function readEffortFiles(dir: string, plan = "plan.html"): EffortFiles {
  const evidenceDir = join(dir, "evidence");
  const evidence = existsSync(evidenceDir)
    ? readdirSync(evidenceDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, day: localDay(newest(join(evidenceDir, d.name))) }))
    : [];
  const docs = effortDocs(dir, plan);
  const md = (role: string) => {
    const d = docs.find((x) => x.role === role);
    return d ? read(join(dir, d.path.replace(/\.html$/, ".md"))) : undefined;
  };
  return {
    plan: md("plan"),
    design: md("design"),
    runMd: read(join(dir, "run.md")),
    timelineMd: read(join(dir, "timeline.md")),
    evidence,
    docs,
    docPrefix: `${relative(reposDir(), dir)}/`,
  };
}

/** The effort's docs, read from each html page's meta tags, with the role its name gives it. */
export function effortDocs(dir: string, plan = "plan.html"): EffortDoc[] {
  const prefix = plan.replace(/plan\.html$/, "");
  const role = (name: string): EffortDoc["role"] =>
    name === plan ? "plan" : [`${prefix}design.html`, `${prefix}spec.html`].includes(name) ? "design" : name === `${prefix}report.html` ? "report" : /brief/i.test(name) ? "brief" : null;
  const out: EffortDoc[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!name.endsWith(".html") || name === "index.html" || !name.startsWith(prefix)) continue;
    const head = readFileSync(join(dir, name), "utf8").slice(0, 20_000);
    const meta = (k: string) => new RegExp(`<meta name="${k}" content="([^"]*)"`).exec(head)?.[1] ?? null;
    // Docs from before 2026-10-26 carry only a day, as `date`.
    out.push({ path: name, title: /<title>([^<]*)<\/title>/.exec(head)?.[1]?.trim() || name, type: meta("doc-type"), created: meta("created") ?? meta("date"), role: role(name) });
  }
  // The design is `<prefix>design.html` when both it and a spec exist.
  const designs = out.filter((d) => d.role === "design");
  if (designs.length > 1) for (const d of designs) if (d.path !== `${prefix}design.html`) d.role = null;
  return out;
}

// The day evidence was made is when its newest file was written.
function newest(dir: string): number {
  let ms = statSync(dir).mtimeMs;
  for (const e of readdirSync(dir, { withFileTypes: true })) ms = Math.max(ms, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs);
  return ms;
}

const PR_TTL_MS = 10 * 60 * 1000;

/** One `gh pr list` per repo, kept 10 minutes, so the sync after each commit stays fast. */
export async function pullRequests(repoRoot: string, repoId: string): Promise<Pr[]> {
  const cache = join(process.env.HOME!, ".cache/atlas/timeline-prs", `${repoId}.json`);
  try {
    if (Date.now() - statSync(cache).mtimeMs < PR_TTL_MS) return JSON.parse(readFileSync(cache, "utf8"));
  } catch {}
  const p = Bun.spawn(["gh", "pr", "list", "--state", "all", "--limit", "200", "--json", "number,headRefName,state,url,mergedAt"], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  const [text, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code !== 0) return [];
  const prs: Pr[] = JSON.parse(text).map((r: { number: number; headRefName: string; state: string; url: string; mergedAt: string | null }) => ({
    number: r.number,
    branch: r.headRefName,
    state: r.state,
    url: r.url,
    mergedAt: r.mergedAt,
  }));
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify(prs));
  return prs;
}

/**
 * The day entries of each session linked to the group, read back from the server and kept 10 minutes
 * like the PRs: two round trips cost about a second from Kigali, and the hook waits for the sync.
 */
export const SESSION_CACHE = join(process.env.HOME!, ".cache/atlas/timeline-sessions");
export const sessionCachePrefix = (url: string) => `${url.replace(/[^a-z0-9]+/gi, "-")}-`;

async function linkedSessions(cfg: Config, groupId: number): Promise<SessionDays[]> {
  const cache = join(SESSION_CACHE, `${sessionCachePrefix(cfg.url)}${groupId}.json`);
  try {
    if (Date.now() - statSync(cache).mtimeMs < PR_TTL_MS) return JSON.parse(readFileSync(cache, "utf8"));
  } catch {}
  const list = await api<{ efforts: { id: number; sessions: { id: string }[] }[] }>(cfg, "GET", "/timeline");
  const ids = list.efforts.find((e) => e.id === groupId)?.sessions.map((s) => s.id) ?? [];
  const sessions = await Promise.all(ids.map(async (id) => ({ id, days: (await api<{ entries: Entry[] }>(cfg, "GET", `/timeline?${new URLSearchParams({ session: id })}`)).entries })));
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify(sessions));
  return sessions;
}

/** Short hashes of the effort's commits that are on no remote branch. */
async function unpushedCommits(repoRoot: string, pattern: string): Promise<string[]> {
  const p = Bun.spawn(["git", "log", `--branches=${pattern}`, "--not", "--remotes", "--format=%h"], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  const [text, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? text.split("\n").filter(Boolean) : [];
}

export async function syncGroup(cfg: Config, group: Group, opts: { dryRun: boolean; prs: boolean }) {
  if (!group.branches) throw new CliError(2, `Group ${group.name} has no branches. Link it with: atlas timeline link "${group.name}" --branches 'v1/*'`);
  const { repoRoot } = storeDir(group.repo_id);
  if (!repoRoot || !existsSync(repoRoot)) throw new CliError(2, `The checkout of ${group.repo_name} is not on this Mac (${repoRoot ?? "no repoRoot in meta.json"})`);
  const [work, todos, prs, sessions, unpushed] = await Promise.all([
    branchWork(repoRoot, group.branches),
    api<TodoItem[]>(cfg, "GET", `/todos?${new URLSearchParams({ repo: group.repo_id, group: group.name, status: "todo,doing,done" })}`),
    opts.prs ? pullRequests(repoRoot, group.repo_id) : Promise.resolve([]),
    linkedSessions(cfg, group.id),
    unpushedCommits(repoRoot, group.branches),
  ]);
  const entries = buildEntries({ work, todos, prs, files: readEffortFiles(effortDir(group), basename(group.docs.find((d) => d.label === "plan")!.path)), sessions, unpushed });
  if (opts.dryRun) return { group: group.name, entries, counts: null };
  const counts = await api<Record<string, number>>(cfg, "POST", "/timeline", { group: group.id, entries });
  return { group: group.name, entries, counts };
}

/** Draw the rail only for a person at a terminal wide enough; pipes and --json get markdown or JSON. */
function railStyle(flags: Record<string, unknown>): Style | null {
  if (flags.json || !isatty(1)) return null;
  const width = Math.min(process.stdout.columns || 100, 120);
  return width < MIN_WIDTH ? null : { width, color: !process.env.NO_COLOR };
}

export type ShownEntry = { entry: string; state: string; title: string; note: string; note_state: string; merged: boolean; lines: { day: string | null; text: string; source: string; ref: string | null; kind: string | null }[]; started_at: string | null; ended_at: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const short = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** Where a line came from: `git abc1234`, `todo #12`, else its source. */
export const lineSource = (l: ShownEntry["lines"][number]) =>
  l.source === "git" && l.ref && !l.ref.startsWith("http") ? `git ${l.ref}` : l.source === "todo" ? `todo #${l.ref}` : l.source;

/** The rail as markdown, oldest first: one section per entry, its days as sub-lists. */
export function showMarkdown(group: Pick<Group, "name" | "repo_name" | "branches">, entries: ShownEntry[]): string {
  const out = [`# ${group.name}`, "", `${group.repo_name}${group.branches ? ` · branches ${group.branches}` : ""}`];
  for (const e of entries) {
    const span = e.started_at ? ` · ${short(e.started_at.slice(0, 10))}${e.ended_at && e.ended_at.slice(0, 10) !== e.started_at.slice(0, 10) ? ` to ${short(e.ended_at.slice(0, 10))}` : ""}` : "";
    // The entry id goes in the heading: `atlas timeline note` takes it.
    out.push("", `## ${e.title} · ${e.state}${e.merged ? " · merged" : ""}${span} · id \`${e.entry}\``);
    if (e.note_state === "written") out.push("", e.note);
    if (e.note_state === "draft") out.push("", "_note: draft_");
    // A `day` line titles its day: "8 Nov: First days in your vault".
    const titles = new Map(e.lines.filter((l) => l.kind === "day").map((l) => [l.day, l.text]));
    const lines = e.lines.every((l) => l.kind === "day") ? e.lines : e.lines.filter((l) => l.kind !== "day");
    let day: string | null | undefined;
    for (const l of lines) {
      if (l.day !== day) {
        day = l.day;
        out.push("", day ? `${short(day)}${titles.has(day) && l.kind !== "day" ? `: ${titles.get(day)}` : ""}:` : "Open:");
      }
      const src = lineSource(l);
      const who = l.kind === "waiting" ? "**You:** " : "";
      out.push(`- ${who}${l.text}${l.kind && !["waiting", "pr", "pr-merged", "day"].includes(l.kind) ? ` (${l.kind})` : ""}  \`${src}\``);
    }
  }
  return out.join("\n");
}
