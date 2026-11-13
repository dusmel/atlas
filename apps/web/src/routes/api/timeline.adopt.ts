import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle, readJson } from "@/server/http"
import { adoptSession } from "@/server/timeline"

export const Route = createFileRoute("/api/timeline/adopt")({
  server: {
    handlers: {
      POST: ({ request }) => handle(async () => adoptSession(getDb(), await readJson(request))),
    },
  },
})
