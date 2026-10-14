import { createFileRoute } from "@tanstack/react-router"
import { docsOverview } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/overview")({
  server: {
    handlers: {
      GET: () => handle(docsOverview),
    },
  },
})
