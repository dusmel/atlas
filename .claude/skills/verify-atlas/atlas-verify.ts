#!/usr/bin/env bun
// Drives a throwaway Atlas instance for verification: the seeded e2e server, a CLI token, screenshots.
// Usage: bun .claude/skills/verify-atlas/atlas-verify.ts <start|doctor|cli|shot|stop> ...
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../..")
const STATE = join(ROOT, ".cache/verify-atlas/instance.json")
const PASSWORD = "e2e-only-password"

type Instance = { url: string; token: string; dataDir: string; pid: number; version: string }
const load = (): Instance => {
  if (!existsSync(STATE)) throw new Error("no instance: run `start` first")
  return JSON.parse(readFileSync(STATE, "utf8"))
}
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function start(port: string, build: boolean) {
  if (existsSync(STATE) && alive(load().pid)) throw new Error(`an instance is running: ${load().url}. Run \`stop\` first`)
  const busy = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).stdout.toString().trim()
  if (busy) throw new Error(`port ${port} is taken:\n${busy}`)
  if (build) {
    const b = Bun.spawnSync(["bun", "run", "build"], { cwd: join(ROOT, "apps/web"), stdout: "ignore", stderr: "pipe" })
    if (b.exitCode !== 0) throw new Error(`web build failed:\n${b.stderr}`)
  }
  mkdirSync(join(ROOT, ".cache/verify-atlas"), { recursive: true })
  const log = join(ROOT, ".cache/verify-atlas/server.log")
  const proc = Bun.spawn(["bun", "e2e/serve.ts"], {
    cwd: join(ROOT, "apps/web"),
    env: { ...process.env, PORT: port },
    stdout: Bun.file(log),
    stderr: Bun.file(log),
    stdin: "ignore",
  })
  proc.unref()
  const url = `http://localhost:${port}`
  let health: { ok?: boolean; version?: string; docs?: { count?: number } } = {}
  for (let i = 0; i < 300 && health.docs?.count !== 4; i++) {
    await Bun.sleep(100)
    health = await fetch(`${url}/api/health`).then((r) => r.json()).catch(() => ({}))
  }
  if (!health.ok) throw new Error(`server not healthy after 30s; see ${log}`)
  const dataDir = /e2e data in (\S+)/.exec(readFileSync(log, "utf8"))?.[1]
  if (!dataDir) throw new Error(`no data dir in ${log}`)
  const token = `atl_verify${crypto.randomUUID().replace(/-/g, "")}`
  const db = new Database(join(dataDir, "atlas.db"))
  db.run("INSERT INTO api_tokens (name, hash, created_at) VALUES (?, ?, ?)", ["verify-atlas", new Bun.CryptoHasher("sha256").update(token).digest("hex"), new Date().toISOString()])
  db.close()
  const inst: Instance = { url, token, dataDir, pid: proc.pid, version: health.version ?? "?" }
  writeFileSync(STATE, JSON.stringify(inst, null, 2))
  console.log(`ready ${url} pid ${proc.pid} data ${dataDir}`)
}

async function doctor() {
  const i = load()
  const health = await fetch(`${i.url}/api/health`).then((r) => r.json()).catch((e) => ({ error: String(e) }))
  const owner = Bun.spawnSync(["lsof", "-nP", "-t", `-iTCP:${new URL(i.url).port}`, "-sTCP:LISTEN"]).stdout.toString().trim()
  const auth = await fetch(`${i.url}/api/todos`, { headers: { authorization: `Bearer ${i.token}` } })
  const report = { url: i.url, pidAlive: alive(i.pid), portOwner: owner, ours: owner.split("\n").includes(String(i.pid)), health, tokenStatus: auth.status }
  console.log(JSON.stringify(report, null, 2))
  if (!report.pidAlive || !report.ours || !health.ok || auth.status !== 200) process.exit(1)
}

function cli(args: string[]) {
  const i = load()
  const r = Bun.spawnSync(["bun", join(ROOT, "apps/cli/index.ts"), ...args], {
    env: { ...process.env, ATLAS_URL: i.url, ATLAS_TOKEN: i.token, ATLAS_AUTHOR: "verify" },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  })
  process.exit(r.exitCode ?? 1)
}

async function shot(path: string, out: string, waitFor?: string) {
  const i = load()
  const { chromium } = await import(join(ROOT, "apps/web/node_modules/@playwright/test/index.js"))
  const browser = await chromium.launch({ channel: "chrome" })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // Playwright's request client cannot parse the login redirect under Bun, so log in with fetch.
  const res = await fetch(`${i.url}/login`, { method: "POST", body: new URLSearchParams({ password: PASSWORD }), redirect: "manual" })
  const cookies = res.headers.getSetCookie().map((c) => {
    const [name, ...v] = c.split(";")[0]!.split("=")
    return { name: name!, value: v.join("="), url: i.url }
  })
  if (!cookies.length) throw new Error(`login gave ${res.status} and no cookie`)
  await context.addCookies(cookies)
  const page = await context.newPage()
  await page.goto(`${i.url}${path}`)
  if (waitFor) await page.locator(waitFor).first().waitFor({ timeout: 15_000 })
  await page.waitForLoadState("networkidle")
  mkdirSync(join(out, ".."), { recursive: true })
  await page.screenshot({ path: out, fullPage: true })
  writeFileSync(out.replace(/\.png$/, ".aria.txt"), await page.locator("body").ariaSnapshot())
  console.log(`saved ${out} and ${out.replace(/\.png$/, ".aria.txt")}`)
  await browser.close()
}

function stop() {
  const i = load()
  if (alive(i.pid)) process.kill(i.pid, "SIGTERM")
  // Only the mkdtemp folder serve.ts made; evidence lives elsewhere.
  if (/\/atlas-e2e-[A-Za-z0-9]+$/.test(i.dataDir)) Bun.spawnSync(["rm", "-rf", i.dataDir])
  Bun.spawnSync(["rm", "-f", STATE])
  console.log(`stopped pid ${i.pid}, removed ${i.dataDir}`)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === "start") await start(rest.find((a) => /^\d+$/.test(a)) ?? "4400", !rest.includes("--no-build"))
else if (cmd === "doctor") await doctor()
else if (cmd === "cli") cli(rest[0] === "--" ? rest.slice(1) : rest)
else if (cmd === "shot") await shot(rest[0]!, rest[1]!, rest[2])
else if (cmd === "stop") stop()
else {
  console.error("usage: atlas-verify.ts start [port] [--no-build] | doctor | cli -- <atlas args> | shot <path> <out.png> [selector] | stop")
  process.exit(2)
}
