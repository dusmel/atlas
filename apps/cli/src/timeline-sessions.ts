/**
 * `atlas timeline sync --sessions` and `--digest`: Claude Code sessions on the timeline. Reads the transcripts
 * on this Mac from the last byte offset, links each session to efforts, and posts facts and digests, never
 * prompt text. Design: atlas/timeline/design.html#sessions.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import {
  activeDays,
  bigEnough,
  dayPrompts,
  dayText,
  DIGEST_MODEL,
  digestDay,
  linkSession,
  loadState,
  remoteName,
  saveState,
  scanTranscripts,
  sessionEntries,
  type EffortRef,
  type SessionState,
  type SessionTodo,
} from "@atlas/timeline";
import { reposDir } from "./config.ts";
import { api, type Config } from "./todo/client.ts";
import { effortDir, pullRequests, SESSION_CACHE, sessionCachePrefix, storeDir, type Group } from "./timeline.ts";

const PROJECTS = join(process.env.HOME!, ".claude/projects");

type Store = { id: string; dir: string; repoRoot: string | null };
type Item = SessionTodo & { group_id: number | null };

function stores(): Store[] {
  const out: Store[] = [];
  for (const name of existsSync(reposDir()) ? readdirSync(reposDir()) : []) {
    try {
      const meta = JSON.parse(readFileSync(join(reposDir(), name, "meta.json"), "utf8"));
      out.push({ id: meta.id, dir: join(reposDir(), name), repoRoot: typeof meta.repoRoot === "string" ? meta.repoRoot : null });
    } catch {}
  }
  return out;
}

const git = (cwd: string, args: string[]) => {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : "";
};

/** Every group with branches or an effort folder, with what linkSession needs to match it. */
export async function effortRefs(groups: Group[]): Promise<EffortRef[]> {
  const linked = groups.filter((g) => g.branches);
  const out: EffortRef[] = [];
  for (const g of groups) {
    let folder: string | null = null;
    let store: { dir: string; repoRoot: string | null } | null = null;
    try {
      store = storeDir(g.repo_id);
      folder = effortDir(g);
    } catch {}
    if (!g.branches && !folder) continue;
    const root = store?.repoRoot && existsSync(store.repoRoot) ? store.repoRoot : null;
    // Agents write effort docs through the repo's `atlas/` link as often as through the store path.
    const folders = folder ? [folder, ...(root && store ? [join(root, "atlas", relative(store.dir, folder))] : [])] : [];
    out.push({
      group_id: g.id,
      remote: root ? remoteName(git(root, ["remote", "get-url", "origin"])) : null,
      branches: g.branches,
      prs: g.branches && root ? await pullRequests(root, g.repo_id) : [],
      folders,
      soloRoot: g.branches && root && linked.filter((x) => x.repo_id === g.repo_id).length === 1 ? root : null,
    });
  }
  return out;
}

/** Subjects for short hashes, looked up in each checkout until all are found. */
function commitSubjects(hashes: string[], roots: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let left = [...new Set(hashes)];
  for (const root of roots) {
    if (!left.length) break;
    if (!existsSync(root)) continue;
    for (const line of git(root, ["log", "--no-walk", "--ignore-missing", "--format=%H%x09%s", ...left]).split("\n").filter(Boolean)) {
      const [full, ...subject] = line.split("\t");
      for (const h of left) if (full!.startsWith(h)) out[h] = subject.join("\t");
    }
    left = left.filter((h) => !(h in out));
  }
  return out;
}

const under = (path: string, dir: string) => path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

/** A written .md or .html under a store folder, or a repo's `atlas/` link, as `repo/path`. */
function docLabel(path: string, all: Store[]): string | null {
  if (!/\.(md|html)$/.test(path)) return null;
  for (const s of all) {
    if (under(path, s.dir)) return relative(reposDir(), path);
    if (s.repoRoot && under(path, join(s.repoRoot, "atlas"))) return join(relative(reposDir(), s.dir), relative(join(s.repoRoot, "atlas"), path));
  }
  return null;
}

/** The Atlas repo whose checkout holds this folder, the deepest one first. */
function repoFor(cwd: string | undefined, all: Store[]): string | null {
  if (!cwd) return null;
  const hits = all.filter((s) => s.repoRoot && (cwd === s.repoRoot || under(cwd, s.repoRoot))).sort((a, b) => b.repoRoot!.length - a.repoRoot!.length);
  return hits[0]?.id ?? null;
}

type Opts = { digest: boolean; session?: string; days: number; dryRun: boolean; log: (line: string) => void };

/** Digests the days that have none or grew since. Without --session: sessions big enough and active in the last `days` days. */
async function digestSessions(sessions: [string, SessionState][], opts: Opts, save: () => Promise<void>): Promise<number> {
  const since = Date.now() - opts.days * 24 * 60 * 60 * 1000;
  let made = 0;
  for (const [id, s] of sessions) {
    const days = activeDays(s.days);
    const size = { days: days.length, prompts: days.reduce((n, d) => n + d.prompts, 0), commits: days.reduce((n, d) => n + d.commits.length, 0), todos: new Set(days.flatMap((d) => d.todos)).size };
    if (!opts.session && (!bigEnough(size) || !days.some((d) => Date.parse(d.last) >= since))) continue;
    s.digests ??= {};
    const titles: string[] = [];
    for (const d of days) {
      const old = s.digests[d.day];
      if (old && old.end >= d.end) {
        titles.push(old.digest.title);
        continue;
      }
      const text = await dayText(s.path, d.start, d.end);
      const run = await digestDay(text.text, { model: DIGEST_MODEL, earlierTitles: titles });
      s.digests[d.day] = { end: d.end, digest: run.digest };
      titles.push(run.digest.title);
      made++;
      opts.log(`digest ${id.slice(0, 8)} ${d.day}: ${(run.ms / 1000).toFixed(1)} s, ${text.dropped + run.dropped} lines dropped`);
      // Each digest is a model call: keep it even if a later one fails.
      await save();
    }
  }
  return made;
}

export async function syncSessions(cfg: Config, opts: Opts) {
  const state = await loadState();
  const scanned = await scanTranscripts(state, PROJECTS);
  const all = Object.entries(state.sessions).filter(([id]) => !opts.session || id === opts.session || id.startsWith(opts.session));
  if (opts.session && !all.length) throw new Error(`No transcript for session ${opts.session} under ${PROJECTS}`);
  const digested = opts.digest ? await digestSessions(all, opts, () => saveState(state)) : 0;

  const groups = await api<Group[]>(cfg, "GET", "/groups");
  const refs = await effortRefs(groups);
  const refsKey = Bun.hash(JSON.stringify(refs.map((r) => ({ ...r, prs: r.prs.map((p) => `${p.number}:${p.branch}`) })))).toString(36);
  const st = stores();
  const sent = ((state.sent ??= {})[new URL(cfg.url).host] ??= {});
  const results: { session: string; entries: number; links: { group_id: number; signals: string[] }[]; counts: Record<string, number> | null; payload?: unknown }[] = [];

  for (const [id, s] of all) {
    const days = activeDays(s.days);
    if (!days.length) continue;
    const digests = Object.fromEntries(Object.entries(s.digests ?? {}).map(([day, d]) => [day, d.digest]));
    // `p1:` marks keys sent with prompts, so a session sent before prompts existed sends all its days once.
    const key = `p1:${s.offset}:${days.reduce((n, d) => n + d.prompts, 0)}:${Object.values(s.digests ?? {}).map((d) => d.end).join(",")}:${refsKey}`;
    if (sent[id] === key && !opts.dryRun) continue;
    const sentTo = sent[id]?.startsWith("p1:") ? Number(sent[id]!.split(":")[1]) : -1;
    const grown = days.filter((d) => d.end > sentTo);
    const prompts = { days: grown.map((d) => d.day), items: (await Promise.all(grown.map((d) => dayPrompts(s.path, d.day, d.start, d.end)))).flat() };

    const todos = await api<Item[]>(cfg, "GET", `/todos?${new URLSearchParams({ session: id, status: "todo,doing,done", include_archived: "1" })}`);
    const links = linkSession(s.days, todos.flatMap((t) => (t.group_id ? [t.group_id] : [])), refs);
    const cwds = [...new Set(days.flatMap((d) => d.cwds))];
    const roots = [...new Set([...st.flatMap((x) => (x.repoRoot ? [x.repoRoot] : [])), ...cwds])];
    const entries = sessionEntries({
      id,
      days,
      digests,
      subjects: commitSubjects(days.flatMap((d) => d.commits), roots),
      todos,
      docLabel: (p) => docLabel(p, st),
    });
    const latest = days.map((d) => digests[d.day]?.session_title).filter(Boolean).at(-1) ?? null;
    const meta = {
      title: latest,
      ai_title: s.title,
      cwd: days[0]!.cwds[0] ?? null,
      repo_id: repoFor(days[0]!.cwds[0], st),
      started_at: days[0]!.first,
      ended_at: days.at(-1)!.last,
      days: days.length,
      prompts: days.reduce((n, d) => n + d.prompts, 0),
      commits: new Set(days.flatMap((d) => d.commits)).size,
      todos: new Set([...days.flatMap((d) => d.todos), ...todos.map((t) => t.id)]).size,
    };
    const counts = opts.dryRun ? null : await api<Record<string, number>>(cfg, "POST", "/timeline", { session: id, meta, links, entries, prompts });
    if (!opts.dryRun) sent[id] = key;
    results.push({ session: id, entries: entries.length, links, counts, ...(opts.dryRun ? { payload: { meta, entries, prompts: prompts.items.length } } : {}) });
  }
  if (!opts.dryRun) await saveState(state);
  // An effort sync caches its sessions for 10 minutes; drop that cache so a new digest shows at once.
  if (results.some((r) => r.counts)) {
    for (const f of existsSync(SESSION_CACHE) ? readdirSync(SESSION_CACHE) : []) if (f.startsWith(sessionCachePrefix(cfg.url))) rmSync(join(SESSION_CACHE, f), { force: true });
  }
  return { scanned: scanned.length, digested, sent: results };
}
