import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { withDocLinks } from "@/server/docs"
import { whoOf } from "@/server/auth"
import { handle, readJson } from "@/server/http"
import { getTodo, updateTodo } from "@/server/todos"

export const Route = createFileRoute("/api/todos/$id")({
  server: {
    handlers: {
      GET: ({ params }) => handle(() => withDocLinks(getTodo(getDb(), Number(params.id)))),
      PATCH: ({ request, params, context }) => handle(async () => updateTodo(getDb(), whoOf(context!.auth, request), Number(params.id), await readJson(request))),
    },
  },
})
