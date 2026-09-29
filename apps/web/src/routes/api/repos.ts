import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle } from "@/server/http"
import { listRepos } from "@/server/todos"

export const Route = createFileRoute("/api/repos")({
  server: {
    handlers: {
      GET: () => handle(() => listRepos(getDb())),
    },
  },
})
