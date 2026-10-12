import { createFileRoute } from "@tanstack/react-router"
import { docsStatus } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/status")({
  server: {
    handlers: {
      GET: () => handle(docsStatus),
    },
  },
})
