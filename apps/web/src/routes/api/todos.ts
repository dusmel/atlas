import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"

// Phase 1 only lists; filters and writes come in Phase 2 (spec section 6).
export const Route = createFileRoute("/api/todos")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          getDb()
            .query(
              `SELECT * FROM items WHERE archived_at IS NULL AND status IN ('todo', 'doing')
               ORDER BY priority IS NOT NULL, priority, status, rank`,
            )
            .all(),
        ),
    },
  },
})
