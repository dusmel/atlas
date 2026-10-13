import { renderMarkdownPage } from "@atlas/doc-render"
import { createFileRoute } from "@tanstack/react-router"
import { basename } from "node:path"
import { withBridge } from "@/server/bridge"
import { CSP_RAW, docFile, fileResponse } from "@/server/doc-files"
import { getIndex } from "@/server/docs"

const missing = (what: string) => new Response(`No doc ${what}`, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
const headers = (type: string) => ({ "content-type": type, "content-security-policy": CSP_RAW, "x-content-type-options": "nosniff", "cache-control": "private, no-cache", "referrer-policy": "no-referrer" })

// What the frame's iframe loads (spec section 6): the doc as a page, with the bridge first in <head>.
// Other files, such as images next to a doc, go out as they are.
export const Route = createFileRoute("/raw/$repo/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { root } = getIndex()
        const path = params._splat ?? ""
        const file = docFile(root, params.repo, path)
        if (new URL(request.url).searchParams.get("format") === "md") {
          const md = path.endsWith(".md") ? file : path.endsWith(".html") ? docFile(root, params.repo, `${path.slice(0, -5)}.md`) : null
          return md ? new Response(Bun.file(md), { headers: headers("text/markdown; charset=utf-8") }) : missing(`markdown for ${params.repo}/${path}`)
        }
        if (!file) return missing(`${params.repo}/${path}`)
        if (path.endsWith(".html")) return new Response(withBridge(await Bun.file(file).text()), { headers: headers("text/html; charset=utf-8") })
        if (path.endsWith(".md")) return new Response(withBridge(renderMarkdownPage(await Bun.file(file).text(), basename(path)).html), { headers: headers("text/html; charset=utf-8") })
        return fileResponse(file, CSP_RAW)
      },
    },
  },
})
