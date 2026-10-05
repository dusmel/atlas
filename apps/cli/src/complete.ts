/**
 * Tab completion. `atlas completion zsh` prints a script that calls `atlas __complete` with
 * the words typed so far; this prints the candidates for the last one, `value:description`
 * per line. A first line of `!dirs` asks zsh to complete directories instead.
 */

import { parseArgs, type FlagSpec } from "./todo/args.ts";
import { api, loadConfig, type Config } from "./todo/client.ts";
import { TODO_COMMANDS } from "./todo/commands.ts";
import type { Item } from "./todo/format.ts";
import { repoParam, scopeOf } from "./todo/scope.ts";

const REPO_PATH: FlagSpec = { repo: "string" };
const TOP: Record<string, { about: string; flags: FlagSpec }> = {
  status: { about: "Show atlas state for this repo", flags: REPO_PATH },
  open: { about: "Open an atlas HTML file", flags: REPO_PATH },
  ensure: { about: "Track the repo and link .atlas", flags: REPO_PATH },
  promote: { about: "Force-promote the repo", flags: REPO_PATH },
  observe: { about: "Score repo engagement from a command", flags: { cmd: "string", exit: "string", repo: "string" } },
  todo: { about: "Todos on the Atlas server", flags: {} },
  completion: { about: "Print the zsh completion script", flags: {} },
};
const NEEDS_ID = new Set(["show", "set", "move", "start", "done", "archive"]);
const FIXED: Record<string, string[]> = { status: ["todo", "doing", "done"], priority: ["P0", "P1", "P2", "P3", "inbox"] };

const esc = (s: string) => s.replace(/:/g, "\\:");
const line = (value: string, about = "") => (about ? `${esc(value)}:${about}` : esc(value));
const flagLines = (spec: FlagSpec, used: string[]) => Object.keys(spec).filter((f) => !used.includes(`--${f}`)).map((f) => `--${f}`);

/** Words that are not flags or flag values. */
function positionals(words: string[], spec: FlagSpec): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.startsWith("--")) {
      if (spec[w.slice(2)] === "string") i++;
    } else out.push(w);
  }
  return out;
}

// Completion runs on every tab, so a slow or unreachable server gives no candidates.
function quick<T>(p: Promise<T>): Promise<T | null> {
  let timer: Timer | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), 3000)));
  return Promise.race([p.catch(() => null), late]).finally(() => clearTimeout(timer));
}

async function scopeQuery(words: string[], spec: FlagSpec): Promise<string> {
  let flags = {};
  try {
    flags = parseArgs(words, spec).flags;
  } catch {}
  try {
    const scope = await scopeOf(flags);
    return scope === "all" ? "" : `repo=${encodeURIComponent(repoParam(scope))}`;
  } catch {
    return "";
  }
}

/** The server config, or null without one: completion then offers nothing from the server. */
function config(): Config | null {
  try {
    return loadConfig();
  } catch {
    return null;
  }
}

async function values(flag: string, sub: string, words: string[], spec: FlagSpec): Promise<string[]> {
  if (FIXED[flag]) return FIXED[flag]!;
  const cfg = config();
  if (!cfg) return [];
  if (flag === "repo") {
    const repos = await quick(api<{ name: string; open: number }[]>(cfg, "GET", "/repos"));
    return (repos ?? []).map((r) => line(r.name, `${r.open} open`));
  }
  if (flag === "by") {
    const authors = await quick(api<{ author: string; items: number }[]>(cfg, "GET", "/authors"));
    return [line("agent", "any agent"), ...(authors ?? []).map((a) => line(a.author, `${a.items} items`))];
  }
  if (flag === "group") {
    const groups = await quick(api<{ name: string; open: number }[]>(cfg, "GET", `/groups?${await scopeQuery(words, spec)}`));
    return [...(sub === "set" ? ["none"] : []), ...(groups ?? []).map((g) => line(g.name, `${g.open} open`))];
  }
  if (["before", "after", "parent"].includes(flag)) return [...(flag === "parent" ? ["none"] : []), ...(await ids(words, spec))];
  return [];
}

async function ids(words: string[], spec: FlagSpec): Promise<string[]> {
  const cfg = config();
  if (!cfg) return [];
  const items = await quick(api<Item[]>(cfg, "GET", `/todos?status=todo,doing&${await scopeQuery(words, spec)}`));
  return (items ?? []).map((i) => line(String(i.id), `${i.status === "doing" ? "◐ " : ""}${i.title.replace(/`|\*\*/g, "").slice(0, 70)}`));
}

/** Candidates for the last of `words`, which is what is being typed. */
export async function complete(words: string[]): Promise<string[]> {
  const typed = words.slice(0, -1);
  const current = words.at(-1) ?? "";
  const [cmd, ...rest] = typed;
  if (!cmd) return Object.entries(TOP).map(([name, c]) => line(name, c.about));

  if (cmd !== "todo") {
    const spec = TOP[cmd]?.flags;
    if (!spec) return [];
    const prev = rest.at(-1);
    if (prev?.startsWith("--") && spec[prev.slice(2)] === "string") return prev === "--repo" ? ["!dirs"] : [];
    return flagLines(spec, rest);
  }

  const [sub, ...more] = rest;
  if (!sub) return Object.entries(TODO_COMMANDS).map(([name, c]) => line(name, c.about));
  if (sub === "group" && !more.length) return [line("add", "Add a group")];
  const spec = TODO_COMMANDS[sub]?.flags;
  if (!spec) return [];
  const args = sub === "group" ? more.slice(1) : more;
  const prev = args.at(-1);
  if (prev?.startsWith("--") && spec[prev.slice(2)] === "string") return values(prev.slice(2), sub, args.slice(0, -1), spec);
  if (!current.startsWith("-") && NEEDS_ID.has(sub) && !positionals(args, spec).length) return ids(args, spec);
  return flagLines(spec, args);
}

export const ZSH_SCRIPT = `#compdef atlas
# zsh completion for atlas. The candidates come from \`atlas __complete\`, so they follow
# the installed binary. Install: atlas completion zsh > ~/.zsh/completions/_atlas

_atlas() {
  local -a lines
  lines=("\${(@f)$(atlas __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  if [[ $lines[1] == '!dirs' ]]; then
    _files -/
  elif [[ -n $lines[1] ]]; then
    _describe -V 'atlas' lines
  fi
}

if [[ $zsh_eval_context[-1] == loadautofunc ]]; then
  _atlas "$@"
else
  compdef _atlas atlas
fi
`;
