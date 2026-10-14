import { createFileRoute } from "@tanstack/react-router"
import { requestPull } from "@/server/docs-source"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/pull")({
  server: {
    handlers: {
      POST: () => handle(() => ({ requested: requestPull() }), 202),
    },
  },
})
