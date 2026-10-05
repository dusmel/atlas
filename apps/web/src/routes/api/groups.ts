import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle, readJson } from "@/server/http"
import { createGroup, listGroups } from "@/server/todos"

export const Route = createFileRoute("/api/groups")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const by = url.searchParams.getAll("by").flatMap((v) => v.split(",")).filter(Boolean)
        return handle(() => listGroups(getDb(), url.searchParams.get("repo") ?? undefined, by))
      },
      POST: ({ request }) => handle(async () => createGroup(getDb(), await readJson(request)), 201),
    },
  },
})
