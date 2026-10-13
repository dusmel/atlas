import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { handle } from "@/server/http"
import { eventDays } from "@/server/todos"

const many = (url: URL, key: string) => url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean)

export const Route = createFileRoute("/api/events/days")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() => eventDays(getDb(), { repo: many(url, "repo"), by: many(url, "by"), tz: url.searchParams.get("tz") }))
      },
    },
  },
})
