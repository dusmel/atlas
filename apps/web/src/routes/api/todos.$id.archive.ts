import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { actorOf } from "@/server/auth"
import { handle } from "@/server/http"
import { archiveTodo } from "@/server/todos"

export const Route = createFileRoute("/api/todos/$id/archive")({
  server: {
    handlers: {
      POST: ({ request, params, context }) => handle(() => archiveTodo(getDb(), actorOf(context!.auth, request), Number(params.id), true)),
    },
  },
})
