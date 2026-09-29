import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle } from "@/server/http"
import { getImport } from "@/server/todos"

export const Route = createFileRoute("/api/imports/$id")({
  server: {
    handlers: {
      GET: ({ params }) => handle(() => getImport(getDb(), Number(params.id))),
    },
  },
})
