import { createFileRoute } from "@tanstack/react-router"
import { filterInput, searchDocs } from "@/server/docs"
import { handle } from "@/server/http"

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        return handle(() =>
          searchDocs({ ...filterInput(url), q: url.searchParams.get("q") ?? "", limit: url.searchParams.get("limit") ?? undefined }),
        )
      },
    },
  },
})
