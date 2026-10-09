/**
 * A small flag parser for `atlas todo`: known flags only, so a typo is a usage error.
 */

import { CliError } from "./client.ts";

export type FlagSpec = Record<string, "string" | "boolean">;
export type Parsed = { flags: Record<string, string | boolean>; rest: string[] };

export function parseArgs(args: string[], spec: FlagSpec): Parsed {
  const flags: Parsed["flags"] = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    const kind = spec[name];
    if (!kind) throw new CliError(2, `Unknown flag ${a}`);
    if (kind === "boolean") flags[name] = true;
    else {
      const value = args[++i];
      if (value === undefined) throw new CliError(2, `${a} needs a value`);
      flags[name] = value;
    }
  }
  return { flags, rest };
}

/** The positional item id, as in `atlas todo show 42` or `#42`. */
export function itemId(rest: string[], command: string): number {
  const raw = rest[0]?.replace(/^#/, "");
  if (!raw || !/^\d+$/.test(raw)) throw new CliError(2, `Usage: atlas todo ${command} <id>`);
  return Number(raw);
}

/** Every id in `atlas todo show 4 5 6`, `4,5,6` or `#4 #5`, in order, once each. */
export function itemIds(rest: string[], command: string): number[] {
  const raw = rest.flatMap((w) => w.split(",")).map((w) => w.trim().replace(/^#/, "")).filter(Boolean);
  if (!raw.length || raw.some((w) => !/^\d+$/.test(w))) throw new CliError(2, `Usage: atlas todo ${command} <id> [<id>...]`);
  return [...new Set(raw.map(Number))];
}

/** `--body -` reads stdin, so agents can pass long markdown safely. */
export async function textFlag(value: string | boolean | undefined): Promise<string | undefined> {
  if (typeof value !== "string") return undefined;
  return value === "-" ? (await Bun.stdin.text()).replace(/\n$/, "") : value;
}
