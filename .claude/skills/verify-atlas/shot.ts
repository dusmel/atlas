#!/usr/bin/env bun
// Logged-in screenshot through Chrome's DevTools protocol, since headless Chrome has no cookie flag.
// Usage: bun shot.ts <base-url> <path> <session-id> <out.png> [width]
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const [base, path, sid, out, width = "1280"] = process.argv.slice(2)
if (!base || !path || !sid || !out) {
  console.error("usage: bun shot.ts <base-url> <path> <session-id> <out.png> [width]")
  process.exit(2)
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const profile = mkdtempSync(join(tmpdir(), "verify-atlas-chrome-"))
const chrome = Bun.spawn(
  [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"],
  { stderr: "pipe" },
)

try {
  // Chrome prints the DevTools URL on stderr once it is listening.
  let wsUrl = ""
  const reader = chrome.stderr.getReader()
  let buf = ""
  while (!wsUrl) {
    const { value, done } = await reader.read()
    if (done) throw new Error("chrome exited before printing its DevTools URL")
    buf += new TextDecoder().decode(value)
    wsUrl = buf.match(/DevTools listening on (ws:\S+)/)?.[1] ?? ""
  }
  const port = new URL(wsUrl).port
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
  const page = targets.find((t) => t.type === "page")
  if (!page) throw new Error("no page target")

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let next = 0
  const waiting = new Map<number, (v: any) => void>()
  const loaded: (() => void)[] = []
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data))
    if (msg.id && waiting.has(msg.id)) waiting.get(msg.id)!(msg.result ?? msg.error)
    if (msg.method === "Page.loadEventFired") loaded.splice(0).forEach((f) => f())
  }
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => {
      const id = ++next
      waiting.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const w = Number(width)
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 })
  await send("Network.enable")
  await send("Network.setCookie", { name: "atlas_session", value: sid, url: base, httpOnly: true })
  const load = new Promise<void>((r) => loaded.push(r))
  await send("Page.navigate", { url: base + path })
  await load
  await Bun.sleep(300)
  const { value: finalUrl } = (await send("Runtime.evaluate", { expression: "location.href", returnByValue: true })).result
  const { value: scrollWidth } = (await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth", returnByValue: true })).result
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
  writeFileSync(out, Buffer.from(shot.data, "base64"))
  console.log(JSON.stringify({ out, url: finalUrl, width: w, scrollWidth }))
  ws.close()
} finally {
  chrome.kill()
  await chrome.exited
  rmSync(profile, { recursive: true, force: true })
}
