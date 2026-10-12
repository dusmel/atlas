import { createFileRoute } from "@tanstack/react-router"
import { basename } from "node:path"
import { getDb } from "@/server/app-db"
import { CSP_SHARE, docFile, fileResponse, renderMarkdown, sharePage } from "@/server/doc-files"
import { getIndex } from "@/server/docs"
import { liveShare } from "@/server/shares"

const gone = () => new Response("This link was revoked or never existed.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })

// No login (spec section 8): the token is the access. Nothing here runs scripts.
export const Route = createFileRoute("/s/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const share = liveShare(getDb(), params.token)
        const file = share && docFile(getIndex().root, share.repo_id, share.path)
        if (!share || !file) return gone()
        if (!file.endsWith(".md")) return fileResponse(file, CSP_SHARE)
        const { title, html } = renderMarkdown(await Bun.file(file).text(), basename(file))
        return new Response(sharePage(title, html), {
          headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP_SHARE, "x-content-type-options": "nosniff", "cache-control": "private, no-cache", "referrer-policy": "no-referrer" },
        })
      },
    },
  },
})
