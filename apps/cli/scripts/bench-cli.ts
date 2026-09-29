/**
 * p95 time per `atlas todo` command against the server in ~/.config/atlas/config.json
 * (spec section 7: under 600 ms). Uses a freshly compiled CLI, one process per command,
 * so TLS and startup count. Bench items go to `personal` and are archived straight away.
 *
 *   bun apps/cli/scripts/bench-cli.ts [--runs 20]
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUDGET_MS = 600;
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > -1 ? Number(process.argv[runsArg + 1]) : 20;

const dir = mkdtempSync(join(tmpdir(), "atlas-bench-"));
const bin = join(dir, "atlas");
const build = Bun.spawnSync(["bun", "build", "--compile", join(import.meta.dir, "../index.ts"), "--outfile", bin], { stdout: "ignore", stderr: "pipe" });
if (build.exitCode !== 0) throw new Error(`compile failed: ${build.stderr}`);

function timed(args: string[]): { ms: number; out: string } {
  const start = performance.now();
  const p = Bun.spawnSync([bin, "todo", ...args], { stdout: "pipe", stderr: "pipe" });
  const ms = performance.now() - start;
  if (p.exitCode !== 0) throw new Error(`atlas todo ${args.join(" ")} exited ${p.exitCode}: ${p.stderr}`);
  return { ms, out: p.stdout.toString() };
}

const times: Record<string, number[]> = { list: [], add: [], archive: [] };
try {
  timed(["list", "--personal"]); // warm-up, not counted
  for (let i = 0; i < RUNS; i++) {
    times.list!.push(timed(["list", "--personal"]).ms);
    const add = timed(["add", `bench ${new Date().toISOString()}`, "--personal", "--json"]);
    times.add!.push(add.ms);
    times.archive!.push(timed(["archive", String(JSON.parse(add.out).id)]).ms);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;
let ok = true;
console.log(`${RUNS} runs each, budget p95 < ${BUDGET_MS} ms\n`);
console.log("command   p50     p95     max");
for (const [name, xs] of Object.entries(times)) {
  const p95 = pct(xs, 95);
  ok &&= p95 < BUDGET_MS;
  console.log(`${name.padEnd(8)}  ${pct(xs, 50).toFixed(0).padStart(4)} ms ${p95.toFixed(0).padStart(4)} ms ${Math.max(...xs).toFixed(0).padStart(4)} ms  ${p95 < BUDGET_MS ? "PASS" : "FAIL"}`);
}
process.exitCode = ok ? 0 : 1;
