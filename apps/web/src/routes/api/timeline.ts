import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { withTimelineLinks } from "@/server/docs"
import { handle, readJson } from "@/server/http"
import { getTimeline, listEfforts, syncTimeline } from "@/server/timeline"

// GET with no query lists every effort for the sidebar; with group= or session= it gives one rail.
export const Route = createFileRoute("/api/timeline")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const q = new URL(request.url).searchParams
        if (!q.has("group") && !q.has("session")) return handle(() => listEfforts(getDb()))
        return handle(() => {
          const view = getTimeline(getDb(), { group: q.get("group"), repo: q.get("repo"), session: q.get("session") })
          return view.group ? withTimelineLinks({ ...view, group: view.group }) : view
        })
      },
      POST: ({ request }) => handle(async () => syncTimeline(getDb(), await readJson(request))),
    },
  },
})
