import { createFileRoute } from "@tanstack/react-router"
import { docsSummary } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs")({
  server: {
    handlers: {
      GET: () => handle(docsSummary),
    },
  },
})
