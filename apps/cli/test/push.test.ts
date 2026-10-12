import { describe, expect, test } from "bun:test";
import { CliError } from "../src/todo/client.ts";
import { formatBytes, parseRsync, push, rsyncCommand, type PushDeps } from "../src/push.ts";
import type { RunResult } from "../src/types.ts";

// openrsync 2.6.9 on macOS, recorded 2026-10-12.
const OPENRSYNC = `*deleting b/gone.md
*deleting b/
cd+++++++ a/
>f+++++++ a/big.md
>f.s..... a/x.md
Number of files: 4
Total transferred file size: 3000003 B
Total sent: 3001736 B

sent 3001736 bytes  received 70 bytes  39970785 bytes/sec`;

// GNU rsync 3.x prints thousands separators and "bytes".
const GNU = `>f..t...... plans/a.md
*deleting old.html
Total transferred file size: 1,258,291 bytes
sent 12,034 bytes  received 210 bytes  24,488.00 bytes/sec`;

type Call = [string, string, unknown?];

function fake(over: { api?: (m: string, p: string) => unknown; run?: (cmd: string[]) => Partial<RunResult> } = {}) {
  const calls: Call[] = [];
  const cmds: string[][] = [];
  const lines: string[] = [];
  const deps: PushDeps = {
    api: async <T>(method: string, path: string, body?: unknown) => {
      calls.push([method, path, body]);
      if (over.api) return over.api(method, path) as T;
      return (path === "/docs/reindex" ? { docs: 206, md: 88, html: 118, ms: 140 } : { ok: true }) as T;
    },
    run: async (cmd) => {
      cmds.push(cmd);
      return { stdout: cmd[0] === "rsync" ? OPENRSYNC : "", stderr: "", exitCode: 0, ...over.run?.(cmd) };
    },
    print: (line) => lines.push(line),
    server: "atlas.example.test",
    source: "/Users/me/MEGA/Documents/atlas/repos",
    target: { host: "atlas@box", dest: "/srv/atlas/data/docs-manual/" },
    rsync: "rsync",
  };
  return { deps, calls, cmds, lines };
}

describe("parseRsync", () => {
  test("counts files sent and deleted, not folders, from openrsync and GNU rsync", () => {
    expect(parseRsync(OPENRSYNC)).toEqual({ changed: ["a/big.md", "a/x.md"], deleted: ["b/gone.md"], bytes: 3000003 });
    expect(parseRsync(GNU)).toEqual({ changed: ["plans/a.md"], deleted: ["old.html"], bytes: 1258291 });
    expect(formatBytes(1258291)).toBe("1.2 MB");
    expect(formatBytes(900)).toBe("900 B");
  });

  test("never sends to the MEGA folder, and dry runs add -n", () => {
    const { deps } = fake();
    expect(rsyncCommand(deps, false)).toEqual(["rsync", "-az", "--delete", "--exclude", ".DS_Store", "-i", "--stats", "/Users/me/MEGA/Documents/atlas/repos/", "atlas@box:/srv/atlas/data/docs-manual/"]);
    expect(rsyncCommand(deps, true)).toContain("-n");
  });
});

describe("atlas push", () => {
  test("runs the five steps in order: check, hold, send, re-index, done", async () => {
    const { deps, calls, cmds, lines } = fake();
    expect(await push({ dryRun: false, resumeMega: false, json: false }, deps)).toBe(0);
    expect(calls.map(([m, p]) => `${m} ${p}`)).toEqual(["GET /health", "POST /docs/hold", "POST /docs/reindex"]);
    expect(cmds.map((c) => c[0])).toEqual(["ssh", "rsync"]);
    expect(cmds[0]).toEqual(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "atlas@box", "true"]);
    expect(lines).toEqual([
      "[1/5] checking atlas.example.test and Tailscale ... ok (box reachable)",
      "[2/5] switching the server to the pushed copy ... ok",
      "[3/5] sending /Users/me/MEGA/Documents/atlas/repos ... 2 changed, 1 deleted, 2.9 MB",
      "[4/5] re-indexing ... 206 docs (88 md, 118 html) in 140 ms",
      "[5/5] done. The server now serves this Mac's copy until you run:",
      "      atlas push --resume-mega",
    ]);
  });

  test("--dry-run runs rsync with -n and lists the files, without holding or re-indexing", async () => {
    const { deps, calls, cmds, lines } = fake();
    expect(await push({ dryRun: true, resumeMega: false, json: false }, deps)).toBe(0);
    expect(calls.map(([m, p]) => `${m} ${p}`)).toEqual(["GET /health"]);
    expect(cmds[1]).toContain("-n");
    expect(lines).toEqual([
      "[1/2] checking atlas.example.test and Tailscale ... ok (box reachable)",
      "[2/2] would send /Users/me/MEGA/Documents/atlas/repos ... 2 changed, 1 deleted, 2.9 MB",
      "        a/big.md",
      "        a/x.md",
      "      - b/gone.md",
    ]);
  });

  test("--resume-mega warns, lets go of the hold and re-indexes", async () => {
    const { deps, calls, cmds, lines } = fake();
    expect(await push({ dryRun: false, resumeMega: true, json: false }, deps)).toBe(0);
    expect(calls.map(([m, p]) => `${m} ${p}`)).toEqual(["GET /health", "DELETE /docs/hold", "POST /docs/reindex"]);
    expect(cmds.map((c) => c[0])).toEqual(["ssh"]);
    expect(lines[0]).toContain("Anything pushed that MEGA does not have yet disappears from the server");
    expect(lines.slice(2)).toEqual([
      "[1/3] checking atlas.example.test and Tailscale ... ok (box reachable)",
      "[2/3] switching the server back to MEGA's copy ... ok",
      "[3/3] re-indexing ... 206 docs (88 md, 118 html) in 140 ms",
    ]);
  });

  test("--json prints one object per step", async () => {
    const { deps, lines } = fake();
    await push({ dryRun: false, resumeMega: false, json: true }, deps);
    const steps = lines.map((l) => JSON.parse(l));
    expect(steps.map((s) => [s.step, s.name, s.ok])).toEqual([
      [1, "check", true],
      [2, "hold", true],
      [3, "send", true],
      [4, "reindex", true],
      [5, "done", true],
    ]);
    expect(steps[2]).toMatchObject({ changed: 2, deleted: 1, bytes: 3000003, total: 5 });
  });

  test("stops at the first failure: no ssh means no hold, a failed rsync means no re-index", async () => {
    const ssh = fake({ run: (cmd) => (cmd[0] === "ssh" ? { exitCode: 255, stderr: "Permission denied" } : {}) });
    const sshErr = await push({ dryRun: false, resumeMega: false, json: false }, ssh.deps).catch((e) => e);
    expect(sshErr).toBeInstanceOf(CliError);
    expect(sshErr.exitCode).toBe(4);
    expect(ssh.calls.map(([, p]) => p)).toEqual(["/health"]);
    expect(ssh.lines).toEqual(["[1/5] check ... failed"]);

    const rsync = fake({ run: (cmd) => (cmd[0] === "rsync" ? { exitCode: 23, stderr: "rsync: mkdir failed: Permission denied" } : {}) });
    const rsyncErr = await push({ dryRun: false, resumeMega: false, json: false }, rsync.deps).catch((e) => e);
    expect(rsyncErr.message).toBe("rsync exited 23: rsync: mkdir failed: Permission denied");
    expect(rsync.calls.map(([, p]) => p)).toEqual(["/health", "/docs/hold"]);
  });

  test("an unreachable server fails the check with the API's exit code", async () => {
    const { deps, cmds } = fake({
      api: () => {
        throw new CliError(4, "Cannot reach https://atlas.example.test");
      },
    });
    const e = await push({ dryRun: false, resumeMega: false, json: false }, deps).catch((x) => x);
    expect(e.exitCode).toBe(4);
    expect(cmds).toEqual([]);
  });
});
