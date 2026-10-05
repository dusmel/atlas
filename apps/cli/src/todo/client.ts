/**
 * HTTP client for the Atlas web API, configured from ~/.config/atlas/config.json.
 */

import { readFileSync } from "node:fs";
import { isatty } from "node:tty";
import { agentEnabled, socketPath, spawnAgent, UNREACHABLE } from "./agent.ts";

/** A failure with the exit code from spec section 7: 1 server, 2 usage, 3 auth, 4 network. */
export class CliError extends Error {
  constructor(
    readonly exitCode: 1 | 2 | 3 | 4,
    message: string,
  ) {
    super(message);
  }
}

export type Config = { url: string; token: string; device: string; author: string };

export const configPath = () => `${process.env.HOME}/.config/atlas/config.json`;

/** ATLAS_URL and ATLAS_TOKEN override the file, so tests need no config. */
export function loadConfig(): Config {
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {}
  const url = process.env.ATLAS_URL ?? file.url;
  const token = process.env.ATLAS_TOKEN ?? file.token;
  if (!url || !token) throw new CliError(3, `No server or token: write ${configPath()} (runbook R7)`);
  let device = file.device;
  if (!device) {
    try {
      device = readFileSync(`${process.env.HOME}/.device_name`, "utf8").trim();
    } catch {}
  }
  return { url: url.replace(/\/$/, ""), token, device: device ?? "", author: authorOf() };
}

/**
 * Who runs this command: ATLAS_AUTHOR when set, then an agent's own marker, then me at a
 * terminal. Anything else is a script, so an agent we cannot detect is never taken for me.
 */
export function authorOf(env: Record<string, string | undefined> = process.env, terminal = isatty(0) || isatty(1)): string {
  if (env.ATLAS_AUTHOR) return env.ATLAS_AUTHOR;
  // Claude Code sets AI_AGENT=claude-code_2-1-282_agent and CLAUDECODE=1.
  if (env.AI_AGENT) return env.AI_AGENT.split("_")[0]!.toLowerCase();
  if (env.CLAUDECODE === "1") return "claude-code";
  return terminal ? "me" : "script";
}

/** Through the helper when it runs; otherwise direct, starting the helper for next time. */
async function send(cfg: Config, path: string, init: RequestInit): Promise<Response> {
  if (agentEnabled()) {
    try {
      const res = await fetch(`http://agent/api${path}`, { ...init, unix: socketPath(cfg.url) });
      if (res.headers.get(UNREACHABLE)) throw new CliError(4, `Cannot reach ${cfg.url}: ${await res.text()}`);
      return res;
    } catch (e) {
      if (e instanceof CliError) throw e;
      // Only when the helper is not there: after a request reached it, a retry could add an item twice.
      const code = (e as { code?: string }).code ?? "";
      if (!["FailedToOpenSocket", "ConnectionRefused", "ECONNREFUSED", "ENOENT"].includes(code)) {
        throw new CliError(4, `Lost the connection to ${cfg.url} mid-request (${code || (e as Error).message}); check whether it went through`);
      }
      spawnAgent(cfg.url);
    }
  }
  try {
    return await fetch(`${cfg.url}/api${path}`, init);
  } catch (e) {
    throw new CliError(4, `Cannot reach ${cfg.url}: ${(e as Error).message}`);
  }
}

/** Calls the API and returns its JSON, or throws a CliError with the right exit code. */
export async function api<T = unknown>(cfg: Config, method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(cfg, path, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(cfg.device ? { "x-atlas-device": cfg.device } : {}),
      "x-atlas-author": cfg.author,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new CliError(3, `Token rejected, check ${configPath()}`);
  const data = (await res.json().catch(() => null)) as (T & { error?: { message: string } }) | null;
  if (!res.ok) {
    const err = new CliError(1, data?.error?.message ?? `Server error ${res.status}`);
    Object.assign(err, { status: res.status, data });
    throw err;
  }
  return data as T;
}
