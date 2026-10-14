import { realpathSync, statSync } from "node:fs"
import { extname, join, sep } from "node:path"
import { marked } from "marked"
import sanitizeHtml from "sanitize-html"
import { LOST_CHAIN_CSS, LOST_CHAIN_SVG, LOST_FOG_CSS, LOST_FOG_HTML, LOST_MAP_CSS, LOST_MAP_SVG } from "@/lib/lost-map"

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

/**
 * What `/raw` hands the browser so it keeps a doc between opens: the file's size and save time, plus `salt` for
 * what the server adds to it (the bridge, the md renderer). A doc that has not changed then costs one round trip, not a download.
 */
export function docValidators(file: string, salt: string): { etag: string; lastModified: string } {
  const { size, mtimeMs } = statSync(file)
  return { etag: `"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}-${salt}"`, lastModified: new Date(mtimeMs).toUTCString() }
}

/** True when the browser already holds this version of the doc. */
export const notModified = (request: Request, etag: string) =>
  (request.headers.get("if-none-match") ?? "").split(",").some((t) => {
    const tag = t.trim()
    return tag === "*" || tag.replace(/^W\//, "") === etag
  })

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

/** The share 404: the app's 404, the fogged map clearing itself over the broken chain, with no links, no doc names and no script. */
export function lostSharePage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Not found</title>
<style>
:root { color-scheme: light dark; --fg: #1c1c1e; --muted: #6b6b70; --line: #e4e4e7; --lost-fg: var(--fg); --lost-sea: color-mix(in oklab, #b4532f 9%, #fff); --lost-fog: #fff; --lost-dot: rgb(180 83 47 / .32); --lost-ink: #b4532f; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececee; --muted: #a1a1aa; --line: #2e2e33; --lost-sea: color-mix(in oklab, #e8906e 10%, #111113); --lost-fog: #131315; --lost-dot: rgb(232 144 110 / .38); --lost-ink: #e8906e; } body { background: #111113; } }
body { margin: 0; color: var(--fg); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { min-height: 100svh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2rem; padding: 3rem 1rem; text-align: center; }
.map { width: 100%; max-width: 36rem; aspect-ratio: 2; border: 1px solid var(--line); border-radius: 16px; }
.chain { width: 100%; max-width: 20rem; }
.big { margin: 0; font-size: clamp(6rem, 18vw, 8rem); line-height: 1; font-weight: 600; letter-spacing: -0.05em; }
h1 { margin: 0.5rem 0 0.25rem; font-size: 1.875rem; letter-spacing: -0.02em; } p { margin: 0; color: var(--muted); }
${LOST_MAP_CSS}
${LOST_FOG_CSS}
${LOST_CHAIN_CSS}
</style></head>
<body><main><div class="map lost-sea lost-auto">${LOST_MAP_SVG}
${LOST_FOG_HTML}</div>
<div class="chain">${LOST_CHAIN_SVG}</div>
<div><p class="big">404</p><h1>Nothing here.</h1><p>The link was revoked, or it never pointed to a doc.</p></div></main></body></html>`
}
