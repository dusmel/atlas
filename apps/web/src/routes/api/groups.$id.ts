import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle, readJson } from "@/server/http"
import { updateGroup } from "@/server/todos"

export const Route = createFileRoute("/api/groups/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handle(async () => updateGroup(getDb(), Number(params.id), await readJson(request))),
    },
  },
})
