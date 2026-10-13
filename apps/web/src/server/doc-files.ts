import { realpathSync, statSync } from "node:fs"
import { extname, join, sep } from "node:path"
import { marked } from "marked"
import sanitizeHtml from "sanitize-html"
import { LOST_MAP_CSS, LOST_MAP_SVG } from "@/lib/lost-map"

/** Logged in, an HTML doc runs its scripts in an opaque origin: no cookie, no API (spec section 8). Shares run none. */
export const CSP_DOC = "sandbox allow-scripts allow-popups"
export const CSP_SHARE = "sandbox"
/** `/raw`, the frame's iframe: the same sandbox, and only the app may frame it. */
export const CSP_RAW = `${CSP_DOC}; frame-ancestors 'self'`

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
}
export const contentType = (path: string) => TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"

/**
 * The file for `<repo>/<path>` under `root`, or null. Null for anything outside the repo folder,
 * through `..` or a symlink, and for hidden files such as `.DS_Store`.
 */
export function docFile(root: string, repo: string, path: string): string | null {
  const parts = [repo, ...path.split("/")]
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith(".") || p.includes("\\") || p.includes("\0"))) return null
  try {
    const base = realpathSync(join(root, repo))
    const file = realpathSync(join(root, ...parts))
    if (!file.startsWith(base + sep) || !statSync(file).isFile()) return null
    return file
  } catch {
    return null
  }
}

const SAFE: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2", "del", "input"],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    code: ["class"],
    th: ["align"],
    td: ["align"],
    input: ["type", "checked", "disabled"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  // Task lists: only the disabled checkbox marked writes.
  exclusiveFilter: (frame) => frame.tag === "input" && frame.attribs.type !== "checkbox",
}

/** Markdown to clean HTML, with the title from frontmatter or the first heading (as the indexer does). */
export function renderMarkdown(text: string, fallback: string): { title: string; html: string } {
  let body = text.replace(/\r\n/g, "\n")
  let title: string | undefined
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(body)
  if (front) {
    title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(front[1]!)?.[1]
    body = body.slice(front[0].length)
  }
  title ??= /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  const html = sanitizeHtml(marked.parse(body, { async: false, gfm: true }), SAFE)
  return { title: title ?? fallback, html }
}

/** A file as is, under a sandbox CSP, never sniffed into another type. */
export const fileResponse = (file: string, csp: string, status = 200) =>
  new Response(Bun.file(file), {
    status,
    headers: { "content-type": contentType(file), "content-security-policy": csp, "x-content-type-options": "nosniff", "cache-control": "private, no-cache", "referrer-policy": "no-referrer" },
  })

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

/** A shared markdown doc as a page of its own: the app's shell needs a login, and a share runs no scripts. */
export function sharePage(title: string, html: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1c1c1e; --muted: #6b6b70; --line: #e4e4e7; --code: #f4f4f5; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececee; --muted: #a1a1aa; --line: #2e2e33; --code: #1f1f23; } body { background: #111113; } }
body { margin: 0; color: var(--fg); font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; overflow-wrap: break-word; }
h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 1rem; } h2 { font-size: 1.35rem; margin-top: 2rem; } h3 { font-size: 1.1rem; }
a { color: inherit; text-underline-offset: 3px; } img { max-width: 100%; }
code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code); border-radius: 4px; padding: 0.1em 0.3em; }
pre { background: var(--code); border-radius: 6px; padding: 0.8rem; overflow-x: auto; } pre code { background: none; padding: 0; }
blockquote { margin: 0; border-left: 3px solid var(--line); padding-left: 1rem; color: var(--muted); }
table { border-collapse: collapse; display: block; overflow-x: auto; } th, td { border-bottom: 1px solid var(--line); padding: 0.4rem 0.75rem 0.4rem 0; text-align: left; }
hr { border: 0; border-top: 1px solid var(--line); }
</style></head>
<body><main>${html}</main></body></html>`
}

/** Where a shared doc's links to other pages go: a token that never exists, so the reader gets the share 404. */
export const SHARE_ELSEWHERE = "/s/elsewhere"
// Before the doc contract lands (commit 9), html-docs pages mark their navbar `.topbar` and their footer `section.related`.
const SHARE_HIDE = "<style>[data-atlas-chrome],[data-atlas-related],details.props,.topbar,section.related{display:none!important}</style>"

/** A share shows its one doc and names no other: its chrome is hidden, and any link that stays on this site leads to the share 404. */
// Read to the end here: the app server stalls when it streams the rewriter's body itself.
export async function shareView(res: Response): Promise<Response> {
  const html = await new HTMLRewriter()
    .on("a[href], area[href]", {
      element(a) {
        const href = a.getAttribute("href")!.trim()
        if (!href.startsWith("#") && !/^([a-z][a-z\d+.-]*:|\/\/)/i.test(href)) a.setAttribute("href", SHARE_ELSEWHERE)
      },
    })
    .onDocument({ end: (end) => void end.append(SHARE_HIDE, { html: true }) })
    .transform(res)
    .text()
  const headers = new Headers(res.headers)
  headers.delete("content-length")
  return new Response(html, { status: res.status, headers })
}

/**
 * The share 404: the app's map under a fog of dots that the reader wipes away, and an X that stamps "404" when found.
 * No script, since shares run none (spec section 8): CSS does it all, so no search, no doc names and no links.
 */
export function lostSharePage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Not found</title>
<style>
:root { color-scheme: light dark; --fg: #1c1c1e; --muted: #6b6b70; --line: #e4e4e7; --sea: color-mix(in oklab, #b4532f 9%, #fff); --fog: #fff; --dot: rgb(180 83 47 / .32); --brand: #b4532f; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececee; --muted: #a1a1aa; --line: #2e2e33; --sea: color-mix(in oklab, #e8906e 10%, #111113); --fog: #131315; --dot: rgb(232 144 110 / .38); --brand: #e8906e; } body { background: #111113; } }
body { margin: 0; color: var(--fg); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.25rem; margin: 1.5rem 0 0.4rem; } p { margin: 0; color: var(--muted); font-size: 0.9rem; }
.map { position: relative; aspect-ratio: 2; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--sea); color: var(--fg); }
.map > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
${LOST_MAP_CSS}
.lost-map .route, .lost-map .x { stroke: var(--brand); stroke-opacity: 1; }
.lost-map .needle { transform-box: fill-box; transform-origin: center; animation: lost-search 7s ease-in-out infinite; }
.lost-map .drift { animation: lost-drift 0.8s cubic-bezier(.2,.7,.3,1) both, lost-bob 3.2s ease-in-out 0.8s infinite alternate; }
@keyframes lost-search { 0%, 100% { rotate: 0deg; } 20% { rotate: 130deg; } 32% { rotate: 95deg; } 55% { rotate: -150deg; } 70% { rotate: -110deg; } 85% { rotate: 40deg; } }
@keyframes lost-bob { to { transform: translateY(-5px) rotate(3deg); } }
.fog { position: absolute; inset: 0; display: grid; grid-template: repeat(${FOG_ROWS}, 1fr) / repeat(${FOG_COLS}, 1fr); }
.fog i { opacity: var(--a); background: radial-gradient(circle, var(--dot) 0 2px, transparent 2.5px) var(--fog); box-shadow: 0 0 0 0.5px var(--fog); animation: lost-wipe 0.15s ease-out forwards paused; }
@keyframes lost-wipe { to { opacity: 0; } }
/* A paused animation keeps its progress when hover ends, so wiped fog stays wiped and a found X stays found. */
.fog i:hover, ${FOG_BRUSH} { animation-play-state: running; }
.stamp { pointer-events: none; opacity: 0; }
.hint { display: grid; margin-top: 1rem; font-size: 0.8rem; } .hint > * { grid-area: 1 / 1; }
.hint .found { opacity: 0; color: var(--brand); }
.stamp, .hint .found { animation: lost-show 1ms forwards paused; }
.hint .look { animation: lost-hide 1ms forwards paused; }
main:has(.dig:hover) :is(.stamp, .hint > *) { animation-play-state: running; }
@keyframes lost-show { to { opacity: 1; } }
@keyframes lost-hide { to { opacity: 0; } }
/* Fingers can't hover, so the fog burns off by itself, outward from the X. */
@media (hover: none) {
  .fog i { animation-duration: 0.6s; animation-delay: calc(0.5s + var(--d) * 60ms); animation-play-state: running; }
  .stamp, .hint > * { animation-delay: 1.2s; animation-play-state: running; }
}
@media (prefers-reduced-motion: reduce) {
  .lost-map .drift, .lost-map .needle { animation: none; }
  .fog i { animation-delay: 0s; animation-duration: 0.01s; }
  .stamp, .hint > * { animation-delay: 0s; }
}
</style></head>
<body><main><div class="map">${LOST_MAP_SVG}
<div class="fog" aria-hidden="true">${FOG}</div>
<svg class="stamp" viewBox="0 0 720 360" aria-hidden="true"><g transform="translate(470 110) rotate(-12)" fill="none" stroke="var(--brand)">
<circle r="50" stroke-width="3" fill="var(--sea)"/><circle r="42" stroke-width="1.5" stroke-dasharray="3 5"/>
<text y="9" text-anchor="middle" fill="var(--brand)" stroke="none" font-size="28" font-weight="700">404</text>
<text y="26" text-anchor="middle" fill="var(--brand)" stroke="none" font-size="9" letter-spacing="1">not here</text>
</g></svg></div>
<h1>This doc drifted off the map</h1>
<p>The link was revoked, or it never pointed to a doc.</p>
<p class="hint" aria-hidden="true"><span class="look">Wipe the fog away to look for it.</span><span class="found">Found the X. The doc isn't there any more.</span></p></main></body></html>`
}

// The fog over the share 404's map: one cell per 30 by 30 square of its 720 by 360 box.
const FOG_COLS = 24
const FOG_ROWS = 12
// The cursor wipes its cell and the four around it: the cells beside it, and the ones a row (FOG_COLS cells) above and below.
const FOG_BRUSH = [".fog i:hover + i", ".fog i:has(+ i:hover)", `.fog i:hover${" + i".repeat(FOG_COLS)}`, `.fog i:has(${"+ i ".repeat(FOG_COLS - 1)}+ i:hover)`].join(", ")
const FOG = (() => {
  // Seeded, so the fog is the same on every visit.
  let seed = 404
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let out = ""
  for (let row = 0; row < FOG_ROWS; row++)
    for (let col = 0; col < FOG_COLS; col++) {
      // The X sits at (470, 110): column 15, row 3. Its fog stays thick, and the drifting page at the right edge peeks through.
      const dig = Math.abs(col - 15) <= 1 && Math.abs(row - 3) <= 1
      const peek = !dig && ((col >= 20 && row >= 5 && row <= 9 && rand() < 0.5) || rand() < 0.06)
      const a = dig ? 1 : peek ? 0.3 + rand() * 0.25 : 0.94 + rand() * 0.06
      const d = Math.round(Math.hypot(col - 15, row - 3))
      out += `<i${dig ? ' class="dig"' : ""} style="--a:${a.toFixed(2)};--d:${d}"></i>`
    }
  return out
})()
