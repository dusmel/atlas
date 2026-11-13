/**
 * `atlas timeline`: link a todo group to its branches, sync its timeline from the files on this Mac,
 * show it, and write an entry's note. Design: atlas/timeline/design.html.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { branchWork, buildEntries, setNote, type EffortFiles, type Pr, type TodoItem } from "@atlas/timeline";
import { reposDir } from "./config.ts";
import { parseArgs, textFlag, type FlagSpec } from "./todo/args.ts";
import { api, CliError, loadConfig, type Config } from "./todo/client.ts";
import { repoParam, scopeOf } from "./todo/scope.ts";
import { err, out } from "./util.ts";

export const TIMELINE_COMMANDS: Record<string, { about: string; flags: FlagSpec }> = {
  sync: { about: "Sync linked efforts: sync [GROUP]", flags: { repo: "string", all: "boolean", "dry-run": "boolean", "no-prs": "boolean", json: "boolean" } },
  show: { about: "Print an effort's timeline: show GROUP", flags: { repo: "string", json: "boolean" } },
  link: { about: "Link a group to its branches: link GROUP --branches 'v1/*'", flags: { repo: "string", branches: "string" } },
  note: { about: "Write an entry's note in timeline.md: note ENTRY TEXT|-", flags: { repo: "string", group: "string", "no-sync": "boolean" } },
};

export const TIMELINE_USAGE = `atlas timeline — what an effort did, is doing and does next, from git, run.md, timeline.md and its todos.

  atlas timeline link  GROUP --branches 'v1/*'   once per effort; the repo is the group's
  atlas timeline sync  [GROUP] [--all] [--dry-run] [--no-prs] [--json]
  atlas timeline show  GROUP [--json]
  atlas timeline note  ENTRY "why it was done" [--group GROUP] [--no-sync]   TEXT - reads stdin

sync with no GROUP syncs every linked group of the current repo; --all syncs every linked group.
GROUP is a todo group name. Each command takes --repo NAME when the current directory is not the repo.`;

type Group = { id: number; name: string; repo_id: string; repo_name: string; branches: string | null; docs: { label: string; path: string }[] };

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
  const cfg = loadConfig();

  switch (sub) {
    case "link": {
      if (!words[0] || typeof flags.branches !== "string") throw new CliError(2, "Usage: atlas timeline link GROUP --branches 'v1/*'");
      const group = await findGroup(cfg, words.join(" "), flags);
      await api(cfg, "PATCH", `/groups/${group.id}`, { branches: flags.branches });
      await out(`${group.repo_name}  ${group.name}  → branches ${flags.branches}`);
      return 0;
    }
    case "sync": {
      const groups = words.length ? [await findGroup(cfg, words.join(" "), flags)] : await linkedGroups(cfg, flags);
      if (!groups.length) throw new CliError(2, "No linked groups here. Link one with: atlas timeline link GROUP --branches 'v1/*'");
      const results = [];
      for (const g of groups) results.push(await syncGroup(cfg, g, { dryRun: !!flags["dry-run"], prs: !flags["no-prs"] }));
      if (flags.json || flags["dry-run"]) await out(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
      else await out(results.map((r) => `${r.group}: ${r.entries.length} entries (${r.counts ? Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(", ") : "not sent"})`).join("\n"));
      return 0;
    }
    case "show": {
      if (!words[0]) throw new CliError(2, "Usage: atlas timeline show GROUP");
      const group = await findGroup(cfg, words.join(" "), flags);
      const t = await api<{ entries: ShownEntry[] }>(cfg, "GET", `/timeline?group=${group.id}`);
      await out(flags.json ? JSON.stringify(t, null, 2) : showMarkdown(group, t.entries));
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
function storeDir(repoId: string): { dir: string; repoRoot: string | null } {
  for (const name of existsSync(reposDir()) ? readdirSync(reposDir()) : []) {
    try {
      const meta = JSON.parse(readFileSync(join(reposDir(), name, "meta.json"), "utf8"));
      if (meta.id === repoId) return { dir: join(reposDir(), name), repoRoot: typeof meta.repoRoot === "string" ? meta.repoRoot : null };
    } catch {}
  }
  throw new CliError(2, `No store folder for ${repoId} under ${reposDir()}: run atlas ensure in the repo`);
}

/** The effort's folder: where its plan doc lives. */
function effortDir(group: Group): string {
  const plan = group.docs.find((d) => d.label === "plan");
  if (!plan) throw new CliError(2, `Group ${group.name} has no plan doc, so it has no effort folder. Add one with --doc on the group`);
  return dirname(join(storeDir(group.repo_id).dir, plan.path));
}

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

/** Everything the effort folder gives the sync. Files that do not exist are left out. */
export function readEffortFiles(dir: string): EffortFiles {
  const evidenceDir = join(dir, "evidence");
  const evidence = existsSync(evidenceDir)
    ? readdirSync(evidenceDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, day: localDay(newest(join(evidenceDir, d.name))) }))
    : [];
  const report = join(dir, "report.html");
  return {
    plan: read(join(dir, "plan.md")),
    runMd: read(join(dir, "run.md")),
    timelineMd: read(join(dir, "timeline.md")),
    evidence,
    report: existsSync(report) ? { path: "report.html", day: localDay(statSync(report).mtimeMs) } : undefined,
  };
}

// The day evidence was made is when its newest file was written.
function newest(dir: string): number {
  let ms = statSync(dir).mtimeMs;
  for (const e of readdirSync(dir, { withFileTypes: true })) ms = Math.max(ms, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs);
  return ms;
}

const PR_TTL_MS = 10 * 60 * 1000;

/** One `gh pr list` per repo, kept 10 minutes, so the sync after each commit stays fast. */
async function pullRequests(repoRoot: string, repoId: string): Promise<Pr[]> {
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

export async function syncGroup(cfg: Config, group: Group, opts: { dryRun: boolean; prs: boolean }) {
  if (!group.branches) throw new CliError(2, `Group ${group.name} has no branches. Link it with: atlas timeline link "${group.name}" --branches 'v1/*'`);
  const { repoRoot } = storeDir(group.repo_id);
  if (!repoRoot || !existsSync(repoRoot)) throw new CliError(2, `The checkout of ${group.repo_name} is not on this Mac (${repoRoot ?? "no repoRoot in meta.json"})`);
  const [work, todos, prs] = await Promise.all([
    branchWork(repoRoot, group.branches),
    api<TodoItem[]>(cfg, "GET", `/todos?${new URLSearchParams({ repo: group.repo_id, group: group.name, status: "todo,doing,done" })}`),
    opts.prs ? pullRequests(repoRoot, group.repo_id) : Promise.resolve([]),
  ]);
  const entries = buildEntries({ work, todos, prs, files: readEffortFiles(effortDir(group)) });
  if (opts.dryRun) return { group: group.name, entries, counts: null };
  const counts = await api<Record<string, number>>(cfg, "POST", "/timeline", { group: group.id, entries });
  return { group: group.name, entries, counts };
}

type ShownEntry = { entry: string; state: string; title: string; note: string; note_state: string; merged: boolean; lines: { day: string | null; text: string; source: string; ref: string | null; kind: string | null }[]; started_at: string | null; ended_at: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** The rail as markdown, oldest first: one section per entry, its days as sub-lists. */
export function showMarkdown(group: Group, entries: ShownEntry[]): string {
  const out = [`# ${group.name}`, "", `${group.repo_name}${group.branches ? ` · branches ${group.branches}` : ""}`];
  for (const e of entries) {
    const span = e.started_at ? ` · ${short(e.started_at.slice(0, 10))}${e.ended_at && e.ended_at.slice(0, 10) !== e.started_at.slice(0, 10) ? ` to ${short(e.ended_at.slice(0, 10))}` : ""}` : "";
    out.push("", `## ${e.title} · ${e.state}${e.merged ? " · merged" : ""}${span}`);
    if (e.note_state === "written") out.push("", e.note);
    if (e.note_state === "draft") out.push("", "_note: draft_");
    let day: string | null | undefined;
    for (const l of e.lines) {
      if (l.day !== day) {
        day = l.day;
        out.push("", day ? `${short(day)}:` : "Open:");
      }
      const src = l.source === "git" && l.ref && !l.ref.startsWith("http") ? `git ${l.ref}` : l.source === "todo" ? `todo #${l.ref}` : l.source;
      const who = l.kind === "waiting" ? "**You:** " : "";
      out.push(`- ${who}${l.text}${l.kind && !["waiting", "pr", "pr-merged"].includes(l.kind) ? ` (${l.kind})` : ""}  \`${src}\``);
    }
  }
  return out.join("\n");
}
