import { createFileRoute } from "@tanstack/react-router"
import { withoutRelated } from "@atlas/doc-render"
import { basename } from "node:path"
import { getDb } from "@/server/app-db"
import { CSP_SHARE, docFile, fileResponse, lostSharePage, renderMarkdown, sharePage, shareView } from "@/server/doc-files"
import { getIndex, sharePlace } from "@/server/docs"
import { liveShare } from "@/server/shares"

const headers = { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP_SHARE, "x-content-type-options": "nosniff", "cache-control": "private, no-cache", "referrer-policy": "no-referrer" }
const gone = () => new Response(lostSharePage(), { status: 404, headers })

// No login (spec section 8): the token is the access. Nothing here runs scripts.
export const Route = createFileRoute("/s/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const share = liveShare(getDb(), params.token)
        const at = share && sharePlace(share)
        const file = at && docFile(getIndex().root, at.repo, at.path)
        if (!share || !file) return gone()
        if (file.endsWith(".html")) return shareView(fileResponse(file, CSP_SHARE))
        if (!file.endsWith(".md")) return fileResponse(file, CSP_SHARE)
        const { title, html } = renderMarkdown(withoutRelated(await Bun.file(file).text()), basename(file))
        return shareView(new Response(sharePage(title, html), { headers }))
      },
    },
  },
})
