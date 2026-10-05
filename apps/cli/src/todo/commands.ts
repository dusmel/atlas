/**
 * `atlas todo <command>`: HTTP clients of the web API (spec section 7).
 */

import { isatty } from "node:tty";
import { STATUSES, type Status } from "@atlas/todos";
import { err, out } from "../util.ts";
import { itemId, parseArgs, textFlag, type FlagSpec } from "./args.ts";
import { serveAgent } from "./agent.ts";
import { api, CliError, loadConfig, type Config } from "./client.ts";
import { itemLines, showLines, type Item } from "./format.ts";
import { importTodos } from "./import.ts";
import { listView, MIN_WIDTH, showView, type Style } from "./pretty.ts";
import { repoParam, scopeOf, type Scope } from "./scope.ts";

const SCOPE: FlagSpec = { repo: "string", all: "boolean", personal: "boolean", json: "boolean" };

/** Every subcommand and its flags. The parser and `atlas __complete` both read this. */
export const TODO_COMMANDS: Record<string, { about: string; flags: FlagSpec }> = {
  list: { about: "List todos", flags: { ...SCOPE, plain: "boolean", status: "string", priority: "string", group: "string", by: "string" } },
  add: { about: "Add a todo", flags: { ...SCOPE, body: "string", priority: "string", group: "string", parent: "string", status: "string" } },
  show: { about: "Show one todo", flags: { ...SCOPE, plain: "boolean" } },
  set: { about: "Change a todo", flags: { ...SCOPE, title: "string", body: "string", priority: "string", group: "string", parent: "string", section: "string" } },
  move: { about: "Move a todo", flags: { ...SCOPE, before: "string", after: "string", top: "boolean", bottom: "boolean", priority: "string", status: "string" } },
  start: { about: "Set status to doing", flags: SCOPE },
  done: { about: "Set status to done", flags: SCOPE },
  archive: { about: "Archive a todo", flags: SCOPE },
  groups: { about: "List groups", flags: { ...SCOPE, by: "string" } },
  group: { about: "Add a group: group add NAME", flags: { ...SCOPE, doc: "string", note: "string" } },
  import: { about: "Import TODO.md files", flags: { apply: "boolean", repo: "string", json: "boolean" } },
};
const flagsOf = (command: string) => TODO_COMMANDS[command]!.flags;

export const TODO_USAGE = `atlas todo — todos on the Atlas server, for the repo in the current directory.

  atlas todo list    [--status todo,doing,done] [--priority P0|inbox] [--group NAME] [--by me|agent|NAME] [--all] [--plain] [--json]
  atlas todo add     "title" [--body TEXT|-] [--priority P1] [--group NAME] [--parent 12] [--status doing]
  atlas todo show    42 [--plain]
  atlas todo set     42 [--title T] [--body TEXT|-] [--priority P2|inbox] [--group NAME|none] [--parent 12|none]
  atlas todo move    42 (--before 17 | --after 17 | --top | --bottom) [--priority P0] [--status doing]
  atlas todo start   42        status doing
  atlas todo done    42        status done
  atlas todo archive 42
  atlas todo groups  [--by me|agent|NAME]
  atlas todo group add "name" [--doc plan.html] [--note TEXT|-]
  atlas todo import  [--apply] [--repo NAME]

Every command takes --repo NAME, --personal or --all (list only), and --json.
--body - reads the body from stdin.
--by filters on who made the item: me, agent (any agent), an agent's name, script or unknown.
Each change records who made it: ATLAS_AUTHOR if set, else the agent (Claude Code is detected),
else me at a terminal, else script.
At a terminal, list and show print a readable layout; --plain, or a pipe, gives one line per item.`;

/** The readable layout only for a person: never for --json, --plain or a pipe, which is how agents call it. */
function pretty(flags: Record<string, string | boolean>): Style | null {
  if (flags.json || flags.plain || !isatty(1)) return null;
  const width = Math.min(process.stdout.columns || 100, 120);
  return width < MIN_WIDTH ? null : { width, color: !process.env.NO_COLOR };
}

const print = (json: boolean, data: unknown, human: () => string[]) => out(json ? JSON.stringify(data, null, 2) : human().join("\n"));

/** `none` and `inbox` clear a field; the API takes null for both. */
const nullable = (v: string | boolean | undefined, word: string) => (v === undefined ? undefined : v === word ? null : v);
const idOrNull = (v: string | boolean | undefined) => {
  const x = nullable(v, "none");
  if (x === undefined || x === null) return x;
  if (typeof x !== "string" || !/^#?\d+$/.test(x)) throw new CliError(2, "--parent takes an item id or none");
  return Number(x.replace(/^#/, ""));
};

async function single(cfg: Config, method: string, path: string, body: unknown, json: boolean) {
  const item = await api<Item>(cfg, method, path, body);
  await print(json, item, () => itemLines([item], true));
}

function requireRepo(scope: Scope) {
  if (scope === "all") throw new CliError(2, "--all only works with list");
  return scope;
}

export async function cmdTodo(args: string[]): Promise<void> {
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
    console.log(TODO_USAGE);
    return sub ? 0 : 2;
  }

  if (sub === "__agent") {
    await serveAgent(rest[0]!);
    return 0;
  }

  if (sub === "import") {
    const { flags } = parseArgs(rest, flagsOf("import"));
    return importTodos(flags.apply ? loadConfig() : null, { apply: !!flags.apply, repo: flags.repo as string | undefined, json: !!flags.json });
  }

  const cfg = loadConfig();
  switch (sub) {
    case "list": {
      const { flags } = parseArgs(rest, flagsOf("list"));
      const scope = await scopeOf(flags);
      const q = new URLSearchParams();
      if (scope !== "all") q.set("repo", repoParam(scope));
      for (const k of ["priority", "group", "by"]) if (typeof flags[k] === "string") q.set(k, flags[k] as string);
      const style = pretty(flags);
      if (style) {
        // The summary counts every status, so fetch them all and leave --status to the outline.
        const want = typeof flags.status === "string" ? flags.status.split(",").map((x) => x.trim()) : ["todo", "doing"];
        const bad = want.find((x) => !STATUSES.includes(x as Status));
        if (bad) throw new CliError(2, `Status must be one of ${STATUSES.join(", ")}, not ${bad}`);
        q.set("status", STATUSES.join(","));
        const everything = await api<Item[]>(cfg, "GET", `/todos?${q}`);
        await out(listView(everything, everything.filter((i) => want.includes(i.status)), scope === "all", style).join("\n"));
        return 0;
      }
      if (typeof flags.status === "string") q.set("status", flags.status);
      const items = await api<Item[]>(cfg, "GET", `/todos?${q}`);
      await print(!!flags.json, items, () => (items.length ? itemLines(items, scope === "all") : ["No todos."]));
      return 0;
    }
    case "add": {
      const { flags, rest: words } = parseArgs(rest, flagsOf("add"));
      if (!words[0]) throw new CliError(2, 'Usage: atlas todo add "title"');
      const repo = requireRepo(await scopeOf(flags));
      const body = {
        repo,
        title: words.join(" "),
        body: await textFlag(flags.body),
        priority: nullable(flags.priority, "inbox"),
        group: flags.group,
        parent: idOrNull(flags.parent),
        status: flags.status,
      };
      await single(cfg, "POST", "/todos", body, !!flags.json);
      return 0;
    }
    case "show": {
      const { flags, rest: words } = parseArgs(rest, flagsOf("show"));
      const data = await api<Parameters<typeof showLines>[0]>(cfg, "GET", `/todos/${itemId(words, "show")}`);
      const style = pretty(flags);
      if (style) await out(showView(data, style).join("\n"));
      else await print(!!flags.json, data, () => showLines(data));
      return 0;
    }
    case "set": {
      const { flags, rest: words } = parseArgs(rest, flagsOf("set"));
      const body = {
        title: flags.title,
        body: await textFlag(flags.body),
        priority: nullable(flags.priority, "inbox"),
        group: nullable(flags.group, "none"),
        parent: idOrNull(flags.parent),
        section: nullable(flags.section, "none"),
      };
      if (Object.values(body).every((v) => v === undefined)) throw new CliError(2, "Nothing to set");
      await single(cfg, "PATCH", `/todos/${itemId(words, "set")}`, body, !!flags.json);
      return 0;
    }
    case "move": {
      const { flags, rest: words } = parseArgs(rest, flagsOf("move"));
      const id = itemId(words, "move");
      const neighbour = (v: string | boolean | undefined) => (typeof v === "string" ? itemId([v], "move") : undefined);
      const body = { before: neighbour(flags.before), after: neighbour(flags.after), top: flags.top, bottom: flags.bottom, priority: nullable(flags.priority, "inbox"), status: flags.status };
      await single(cfg, "POST", `/todos/${id}/move`, body, !!flags.json);
      return 0;
    }
    case "start":
    case "done": {
      const { flags, rest: words } = parseArgs(rest, flagsOf(sub));
      await single(cfg, "PATCH", `/todos/${itemId(words, sub)}`, { status: sub === "start" ? "doing" : "done" }, !!flags.json);
      return 0;
    }
    case "archive": {
      const { flags, rest: words } = parseArgs(rest, flagsOf(sub));
      await single(cfg, "POST", `/todos/${itemId(words, "archive")}/archive`, undefined, !!flags.json);
      return 0;
    }
    case "groups": {
      const { flags } = parseArgs(rest, flagsOf(sub));
      const scope = await scopeOf(flags);
      const q = new URLSearchParams();
      if (scope !== "all") q.set("repo", repoParam(scope));
      if (typeof flags.by === "string") q.set("by", flags.by);
      const groups = await api<{ id: number; name: string; repo_name: string; doc_path: string | null; open: number }[]>(
        cfg,
        "GET",
        `/groups?${q}`,
      );
      await print(!!flags.json, groups, () =>
        groups.length ? groups.map((g) => `${String(g.open).padStart(3)} open  ${scope === "all" ? `${g.repo_name}  ` : ""}${g.name}${g.doc_path ? `  → ${g.doc_path}` : ""}`) : ["No groups."],
      );
      return 0;
    }
    case "group": {
      const [action, ...more] = rest;
      if (action !== "add") throw new CliError(2, 'Usage: atlas todo group add "name" [--doc plan.html] [--note TEXT|-]');
      const { flags, rest: words } = parseArgs(more, flagsOf("group"));
      if (!words[0]) throw new CliError(2, 'Usage: atlas todo group add "name"');
      const repo = requireRepo(await scopeOf(flags));
      const group = await api<{ id: number; name: string }>(cfg, "POST", "/groups", { repo, name: words.join(" "), doc_path: flags.doc, note: await textFlag(flags.note) });
      await print(!!flags.json, group, () => [`Added group ${group.name}`]);
      return 0;
    }
    default:
      throw new CliError(2, `Unknown todo command: ${sub}\n\n${TODO_USAGE}`);
  }
}
