/**
 * HTTP client for the Atlas web API, configured from ~/.config/atlas/config.json.
 */

import { readFileSync } from "node:fs";

/** A failure with the exit code from spec section 7: 1 server, 2 usage, 3 auth, 4 network. */
export class CliError extends Error {
  constructor(
    readonly exitCode: 1 | 2 | 3 | 4,
    message: string,
  ) {
    super(message);
  }
}

export type Config = { url: string; token: string; device: string };

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
  return { url: url.replace(/\/$/, ""), token, device: device ?? "" };
}

/** Calls the API and returns its JSON, or throws a CliError with the right exit code. */
export async function api<T = unknown>(cfg: Config, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        ...(cfg.device ? { "x-atlas-device": cfg.device } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new CliError(4, `Cannot reach ${cfg.url}: ${(e as Error).message}`);
  }
  if (res.status === 401) throw new CliError(3, `Token rejected, check ${configPath()}`);
  const data = (await res.json().catch(() => null)) as (T & { error?: { message: string } }) | null;
  if (!res.ok) {
    const err = new CliError(1, data?.error?.message ?? `Server error ${res.status}`);
    Object.assign(err, { status: res.status, data });
    throw err;
  }
  return data as T;
}
