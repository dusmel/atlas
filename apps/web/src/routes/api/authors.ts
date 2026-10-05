import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle } from "@/server/http"
import { listAuthors } from "@/server/todos"

export const Route = createFileRoute("/api/authors")({
  server: {
    handlers: {
      GET: () => handle(() => listAuthors(getDb())),
    },
  },
})
