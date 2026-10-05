import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { whoOf } from "@/server/auth"
import { handle, readJson } from "@/server/http"
import { createTodo, listTodos } from "@/server/todos"

// Repeated params and comma lists both work: ?status=todo&status=doing or ?status=todo,doing.
const many = (url: URL, key: string) => url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean)

export const Route = createFileRoute("/api/todos")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const one = (key: string) => url.searchParams.get(key) ?? undefined
        return handle(() =>
          listTodos(getDb(), {
            repo: many(url, "repo"),
            status: many(url, "status"),
            priority: many(url, "priority"),
            by: many(url, "by"),
            group: one("group"),
            parent: one("parent"),
            q: one("q"),
            include_archived: url.searchParams.get("include_archived") === "1",
          }),
        )
      },
      POST: ({ request, context }) => handle(async () => createTodo(getDb(), whoOf(context!.auth, request), await readJson(request)), 201),
    },
  },
})
