import { createFileRoute } from "@tanstack/react-router"
import { docsOverview, filterInput } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/overview")({
  server: {
    handlers: {
      GET: ({ request }) => handle(() => docsOverview(filterInput(new URL(request.url)))),
    },
  },
})
