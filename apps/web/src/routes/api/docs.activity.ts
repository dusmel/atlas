import { createFileRoute } from "@tanstack/react-router"
import { docsActivity, filterInput } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/activity")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() => docsActivity(filterInput(url)))
      },
    },
  },
})
