/**
 * A background helper that keeps one HTTPS connection to the server open, so a command
 * costs one round trip instead of three (TCP, TLS, then the request). It holds no data:
 * every request goes to the server. It listens on a socket only this user can open, and
 * exits after 10 idle minutes. Set ATLAS_AGENT=0 to skip it.
 */

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { shortHash } from "../util.ts";

const IDLE_MS = () => Number(process.env.ATLAS_AGENT_IDLE_MS ?? 10 * 60_000);
// Traefik closes idle connections after 180 s, so a ping a minute keeps ours open.
const PING_MS = 60_000;
export const UNREACHABLE = "x-atlas-agent-unreachable";

export const agentEnabled = () => process.env.ATLAS_AGENT !== "0";

/** One socket per server URL, so a changed config never talks to the old server. */
export function socketPath(url: string): string {
  return join(process.env.HOME!, ".cache", "atlas", `agent-${shortHash(url)}.sock`);
}

/** Starts the helper in the background; this process does not wait for it. */
export function spawnAgent(url: string): void {
  const self = Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main];
  Bun.spawn([...self, "todo", "__agent", url], { stdio: ["ignore", "ignore", "ignore"] }).unref();
}

async function alive(sock: string): Promise<boolean> {
  try {
    return (await fetch("http://agent/__agent", { unix: sock, signal: AbortSignal.timeout(500) })).status === 204;
  } catch {
    return false;
  }
}

export async function serveAgent(url: string): Promise<void> {
  const sock = socketPath(url);
  mkdirSync(join(sock, ".."), { recursive: true, mode: 0o700 });
  if (await alive(sock)) return; // another helper got there first
  let last = Date.now();
  let server: ReturnType<typeof Bun.serve>;
  try {
    rmSync(sock, { force: true });
    server = Bun.serve({
      unix: sock,
      async fetch(req) {
        last = Date.now();
        const { pathname, search } = new URL(req.url);
        if (pathname === "/__agent") return new Response(null, { status: 204 });
        const headers = new Headers(req.headers);
        headers.delete("host");
        try {
          const res = await fetch(`${url}${pathname}${search}`, {
            method: req.method,
            headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
            signal: AbortSignal.timeout(15_000),
          });
          // fetch already decompressed the body, so these headers would no longer be true.
          const out = new Headers(res.headers);
          out.delete("content-encoding");
          out.delete("content-length");
          return new Response(res.body, { status: res.status, headers: out });
        } catch (e) {
          return new Response((e as Error).message, { status: 502, headers: { [UNREACHABLE]: "1" } });
        }
      },
    });
  } catch {
    return;
  }
  chmodSync(sock, 0o600);
  fetch(`${url}/api/health`).catch(() => {}); // opens the connection before the next command needs it
  const timer = setInterval(() => {
    if (Date.now() - last > IDLE_MS()) {
      clearInterval(timer);
      server.stop(true);
      rmSync(sock, { force: true });
      process.exit(0);
    }
    fetch(`${url}/api/health`).catch(() => {});
  }, Math.min(PING_MS, IDLE_MS()));
}
