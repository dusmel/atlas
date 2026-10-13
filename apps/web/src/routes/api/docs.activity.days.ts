import { createFileRoute } from "@tanstack/react-router"
import { docsActivityDays, filterInput } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/docs/activity/days")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() => docsActivityDays(filterInput(url), url.searchParams.get("tz")))
      },
    },
  },
})
