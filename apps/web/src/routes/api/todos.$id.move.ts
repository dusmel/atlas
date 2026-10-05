import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { whoOf } from "@/server/auth"
import { handle, readJson } from "@/server/http"
import { moveTodo } from "@/server/todos"

export const Route = createFileRoute("/api/todos/$id/move")({
  server: {
    handlers: {
      POST: ({ request, params, context }) => handle(async () => moveTodo(getDb(), whoOf(context!.auth, request), Number(params.id), await readJson(request))),
    },
  },
})
