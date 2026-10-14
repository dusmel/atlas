import { createFileRoute } from "@tanstack/react-router"
import { getIndex } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/reindex")({
  server: {
    handlers: {
      POST: () =>
        handle(async () => {
          const { docs, md, html, ms } = await getIndex().rebuild()
          return { docs, md, html, ms }
        }),
    },
  },
})
