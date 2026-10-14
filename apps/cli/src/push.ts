/**
 * `atlas push`: sends this Mac's docs to the server for when MEGA is unavailable (spec section 7).
 */

import { existsSync, readFileSync } from "node:fs";
import { reposDir } from "./config.ts";
import { parseArgs, type FlagSpec } from "./todo/args.ts";
import { api, CliError, configPath, loadConfig, type Config } from "./todo/client.ts";
import type { RunResult } from "./types.ts";
import { err, run } from "./util.ts";

export const PUSH_USAGE = `atlas push — send this Mac's docs to the server and serve them, for when MEGA is unavailable.

  atlas push                 hold the server on the pushed copy, send the docs, re-index
  atlas push --dry-run       show what would change; holds and sends nothing
  atlas push --resume-mega   serve MEGA's copy again
  --json                     one JSON object per step

The host and folder come from "push" in ~/.config/atlas/config.json.`;

export const PUSH_FLAGS: FlagSpec = { "dry-run": "boolean", "resume-mega": "boolean", json: "boolean" };

export type Target = { host: string; dest: string };
type Counts = { docs: number; md: number; html: number; ms: number };
type Step = { step: number; name: string; ok: boolean; [key: string]: unknown };

export type PushDeps = {
  api: <T>(method: string, path: string, body?: unknown) => Promise<T>;
  run: (cmd: string[]) => Promise<RunResult>;
  print: (line: string) => void;
  server: string;
  source: string;
  target: Target;
  rsync: string;
};

/** What one rsync run changed: files sent, files deleted and the size of the files sent. */
export type RsyncSummary = { changed: string[]; deleted: string[]; bytes: number };

/**
 * Reads `rsync -i --stats`, from openrsync (macOS) or GNU rsync. `>f` marks a file sent and
 * `*deleting` a removal; folders end in `/` and are not counted.
 */
export function parseRsync(stdout: string): RsyncSummary {
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const line of stdout.split("\n")) {
    const sent = /^[<>]f\S*\s+(.+)$/.exec(line);
    if (sent) changed.push(sent[1]!);
    const gone = /^\*deleting\s+(.+[^/])$/.exec(line);
    if (gone) deleted.push(gone[1]!);
  }
  const size = /Total transferred file size: ([\d,]+)/.exec(stdout);
  return { changed, deleted, bytes: size ? Number(size[1]!.replace(/,/g, "")) : 0 };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export const rsyncCommand = (deps: Pick<PushDeps, "rsync" | "source" | "target">, dryRun: boolean) => [
  deps.rsync,
  "-az",
  "--delete",
  "--exclude",
  ".DS_Store",
  "-i",
  "--stats",
  ...(dryRun ? ["-n"] : []),
  `${deps.source.replace(/\/$/, "")}/`,
  `${deps.target.host}:${deps.target.dest.replace(/\/$/, "")}/`,
];

const hostName = (host: string) => host.split("@").pop()!;

/** Runs the steps and returns the exit code. Each step prints one line, or one JSON object with `json`. */
export async function push(opts: { dryRun: boolean; resumeMega: boolean; json: boolean }, deps: PushDeps): Promise<number> {
  const total = opts.dryRun ? 2 : opts.resumeMega ? 3 : 5;
  const say = (s: Step, line: string) => deps.print(opts.json ? JSON.stringify({ ...s, total }) : `[${s.step}/${total}] ${line}`);
  const more = (line: string) => opts.json || deps.print(`      ${line}`);
  const fail = (step: number, name: string, message: string, code: 1 | 2 | 3 | 4 = 1): never => {
    say({ step, name, ok: false, error: message }, `${name} ... failed`);
    throw new CliError(code, message);
  };

  const check = async () => {
    try {
      await deps.api("GET", "/health");
    } catch (e) {
      fail(1, "check", (e as Error).message, e instanceof CliError ? e.exitCode : 1);
    }
    const ssh = await deps.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", deps.target.host, "true"]);
    if (ssh.exitCode !== 0) fail(1, "check", `ssh ${deps.target.host} failed: ${ssh.stderr || `exit ${ssh.exitCode}`}. Check Tailscale (runbook R4)`, 4);
    say({ step: 1, name: "check", ok: true, server: deps.server, host: deps.target.host }, `checking ${deps.server} and Tailscale ... ok (${hostName(deps.target.host)} reachable)`);
  };

  const reindex = async (step: number) => {
    let c: Counts;
    try {
      c = await deps.api<Counts>("POST", "/docs/reindex");
    } catch (e) {
      return fail(step, "reindex", (e as Error).message);
    }
    say({ step, name: "reindex", ok: true, ...c }, `re-indexing ... ${c.docs} docs (${c.md} md, ${c.html} html) in ${c.ms} ms`);
  };

  if (opts.resumeMega) {
    // Warn before the switch: whatever was pushed but has not reached MEGA leaves the server.
    if (!opts.json) {
      deps.print("The server will show MEGA's copy again. Anything pushed that MEGA does not have yet disappears from the server.");
      deps.print("This Mac's copy is not touched.");
    }
    await check();
    try {
      await deps.api("DELETE", "/docs/hold");
    } catch (e) {
      fail(2, "resume", (e as Error).message);
    }
    say({ step: 2, name: "resume", ok: true, source: "mega" }, "switching the server back to MEGA's copy ... ok");
    await reindex(3);
    return 0;
  }

  await check();
  const step = opts.dryRun ? 2 : 3;
  if (!opts.dryRun) {
    try {
      await deps.api("POST", "/docs/hold");
    } catch (e) {
      fail(2, "hold", (e as Error).message);
    }
    say({ step: 2, name: "hold", ok: true, source: "manual" }, "switching the server to the pushed copy ... ok");
  }

  const sync = await deps.run(rsyncCommand(deps, opts.dryRun));
  if (sync.exitCode !== 0) fail(step, "send", `rsync exited ${sync.exitCode}: ${sync.stderr.split("\n").slice(-3).join(" ")}`);
  const r = parseRsync(sync.stdout);
  const summary = `${r.changed.length} changed, ${r.deleted.length} deleted, ${formatBytes(r.bytes)}`;
  say(
    { step, name: "send", ok: true, dry_run: opts.dryRun, changed: r.changed.length, deleted: r.deleted.length, bytes: r.bytes, ...(opts.dryRun ? { files: r.changed, deletions: r.deleted } : {}) },
    `${opts.dryRun ? "would send" : "sending"} ${deps.source} ... ${summary}`,
  );
  if (opts.dryRun) {
    for (const f of r.changed.slice(0, 50)) more(`  ${f}`);
    for (const f of r.deleted.slice(0, 50)) more(`- ${f}`);
    const hidden = Math.max(0, r.changed.length - 50) + Math.max(0, r.deleted.length - 50);
    if (hidden) more(`... and ${hidden} more`);
    return 0;
  }

  await reindex(4);
  say({ step: 5, name: "done", ok: true }, "done. The server now serves this Mac's copy until you run:");
  more("atlas push --resume-mega");
  return 0;
}

/** The push host and folder from the config's "push" key, with the runbook's defaults. */
export function pushTarget(): Target {
  let file: { push?: Partial<Target> } = {};
  try {
    file = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {}
  return { host: file.push?.host ?? "atlas@hetzner-box", dest: file.push?.dest ?? "/srv/atlas/data/docs-manual/" };
}

export async function cmdPush(args: string[]): Promise<void> {
  try {
    const { flags, rest } = parseArgs(args, { ...PUSH_FLAGS, help: "boolean" });
    if (flags.help) return console.log(PUSH_USAGE);
    if (rest.length || (flags["dry-run"] && flags["resume-mega"])) throw new CliError(2, PUSH_USAGE);
    const cfg: Config = loadConfig();
    const source = reposDir();
    if (!existsSync(source)) throw new CliError(2, `${source} is missing: nothing to push`);
    process.exitCode = await push(
      { dryRun: !!flags["dry-run"], resumeMega: !!flags["resume-mega"], json: !!flags.json },
      {
        api: (method, path, body) => api(cfg, method, path, body),
        run: (cmd) => run(cmd),
        print: (line) => console.log(line),
        server: new URL(cfg.url).host,
        source,
        target: pushTarget(),
        // macOS ships openrsync; Homebrew's GNU rsync is faster and is used when installed.
        rsync: existsSync("/opt/homebrew/bin/rsync") ? "/opt/homebrew/bin/rsync" : "rsync",
      },
    );
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    err(e.message);
    process.exitCode = e.exitCode;
  }
}
