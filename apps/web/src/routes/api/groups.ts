import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle, readJson } from "@/server/http"
import { createGroup, listGroups } from "@/server/todos"

export const Route = createFileRoute("/api/groups")({
  server: {
    handlers: {
      GET: ({ request }) => handle(() => listGroups(getDb(), new URL(request.url).searchParams.get("repo") ?? undefined)),
      POST: ({ request }) => handle(async () => createGroup(getDb(), await readJson(request)), 201),
    },
  },
})
