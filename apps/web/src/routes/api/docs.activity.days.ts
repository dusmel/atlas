import { createFileRoute } from "@tanstack/react-router"
import { getDb } from "@/server/app-db"
import { docEventDays } from "@/server/doc-activity"
import { handle } from "@/server/http"

const many = (url: URL, key: string) => url.searchParams.getAll(key).flatMap((v) => v.split(",")).filter(Boolean)

export const Route = createFileRoute("/api/docs/activity/days")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() => docEventDays(getDb(), { repo: many(url, "repo"), folder: many(url, "folder"), tz: url.searchParams.get("tz") }))
      },
    },
  },
})
