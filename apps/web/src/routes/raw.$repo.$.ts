import { renderMarkdownPage } from "@atlas/doc-render"
import { createFileRoute } from "@tanstack/react-router"
import { basename } from "node:path"
import { BRIDGE_VERSION, withBridge } from "@/server/bridge"
import { CSP_RAW, docValidators, fileResponse, notModified } from "@/server/doc-files"
import { docMarkdown, servedFile } from "@/server/docs"

const missing = (what: string) => new Response(`No doc ${what}`, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
const headers = (type: string) => ({ "content-type": type, "content-security-policy": CSP_RAW, "x-content-type-options": "nosniff", "cache-control": "private, no-cache", "referrer-policy": "no-referrer" })

// What the frame's iframe loads (spec section 6): the doc as a page, with the bridge first in <head>.
// Other files, such as images next to a doc, go out as they are.
export const Route = createFileRoute("/raw/$repo/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const path = params._splat ?? ""
        const file = servedFile(params.repo, path)
        if (new URL(request.url).searchParams.get("format") === "md") {
          const md = await docMarkdown(params.repo, path)
          return md === null ? missing(`markdown for ${params.repo}/${path}`) : new Response(md, { headers: headers("text/markdown; charset=utf-8") })
        }
        if (!file) return missing(`${params.repo}/${path}`)
        if (!/\.(html|md)$/.test(path)) return fileResponse(file, CSP_RAW)
        // The doc stays in the browser between opens; a new deploy can change the bridge or the md renderer, hence the version.
        const { etag, lastModified } = docValidators(file, `${__ATLAS_VERSION__}.${BRIDGE_VERSION}`)
        const page = { ...headers("text/html; charset=utf-8"), etag, "last-modified": lastModified }
        if (notModified(request, etag)) return new Response(null, { status: 304, headers: page })
        const text = await Bun.file(file).text()
        return new Response(withBridge(path.endsWith(".md") ? renderMarkdownPage(text, basename(path)).html : text), { headers: page })
      },
    },
  },
})
